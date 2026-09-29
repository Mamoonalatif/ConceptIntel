"""AI generation of bank questions in each of the five supported types.

Separate from app/content_generation/service.py because the output contract is
different: that module produces a whole *set* as one payload for a student to study,
whereas this produces individual, independently-reusable questions in five different
answer-key shapes. Sharing one prompt across both would mean one of them always
getting a prompt written for the other.

Every generated question is pushed through question_bank.service.validate_payload
before it is returned, so a malformed answer key is discarded and retried rather than
being stored and only failing later when a student sits the exam.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message, _reasoning_extra_body
from app.observability import trace_ai_call
from app.question_bank import service as qb

logger = logging.getLogger("conceptintel.question_bank.generation")

_SHARED_RULES = """You are an expert university exam writer producing questions on ONE concept.

Rules that apply to every question:
- Test understanding of the concept, never trivia about the wording of the material.
- Keep the prompt self-contained: a student must be able to answer it without seeing
  any other question.
- Write an `explanation` that teaches why the answer is right; it is shown after
  answering, so it should be worth reading even by a student who got it correct.
- Never refer to "the text", "the excerpt" or "the passage" - the student cannot see them.
"""

_TYPE_PROMPTS = {
    "single_choice": """Produce multiple-choice questions with EXACTLY 4 options and exactly one correct
answer. Each wrong option must be a specific, plausible misconception a real student
holds - never filler, never obviously absurd, never "none of the above".

Respond ONLY with JSON:
{"questions": [{"prompt": "...", "options": ["...","...","...","..."], "correct_index": 0, "explanation": "..."}]}""",

    "multi_select": """Produce questions where MORE THAN ONE option is correct, with 4-6 options total.
At least two options must be correct and at least one must be wrong. Make the wrong
options plausible; the difficulty should come from having to judge each option on its
own merits, not from ambiguity about what is being asked.

Respond ONLY with JSON:
{"questions": [{"prompt": "...", "options": ["...","...","...","..."], "correct_indices": [0,2], "explanation": "..."}]}""",

    "true_false": """Produce true/false statements. Each must be unambiguously one or the other to
someone who understands the concept - avoid statements that are "mostly true" or that
hinge on an unstated assumption. Mix true and false roughly evenly; do not make every
statement false.

Respond ONLY with JSON:
{"questions": [{"prompt": "...", "correct": true, "explanation": "..."}]}""",

    "fill_blank": """Produce short-answer questions whose answer is a single term or a very short phrase
(at most a few words) - these are graded by exact text match, so anything longer is
unfair. List every reasonable spelling, abbreviation and word order in `accepted`
(e.g. both "Bernoulli's Principle" and "Bernoulli Principle"). Case and extra spaces
are already ignored by the grader, so do not list case variants.

Respond ONLY with JSON:
{"questions": [{"prompt": "...", "accepted": ["...","..."], "explanation": "..."}]}""",

    "matching": """Produce matching questions with 3-5 pairs each. Every left item must match exactly
one right item, and no two right items may be interchangeable - if two definitions
could both plausibly attach to the same term, the question is broken. Keep both sides
short.

Respond ONLY with JSON:
{"questions": [{"prompt": "Match each term to its definition.", "pairs": [{"left": "...", "right": "..."}], "explanation": "..."}]}""",
}

_DIFFICULTY_GUIDANCE = {
    "Easy": "TARGET DIFFICULTY: EASY - recall and recognition of the core definition, one step, no traps.",
    "Medium": "TARGET DIFFICULTY: MEDIUM - apply the concept to a concrete situation or relate it to a neighbouring idea.",
    "Hard": "TARGET DIFFICULTY: HARD - multi-step reasoning, edge cases, and recognising when the concept does NOT apply.",
}


def _to_payload(question_type: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    """Maps the model's flat JSON onto the payload shape the bank stores."""
    if question_type in ("single_choice", "multi_select"):
        key = "correct_index" if question_type == "single_choice" else "correct_indices"
        return {"options": raw.get("options") or [], key: raw.get(key)}
    if question_type == "true_false":
        return {"correct": raw.get("correct")}
    if question_type == "fill_blank":
        return {"accepted": raw.get("accepted") or [], "case_sensitive": False}
    return {"pairs": raw.get("pairs") or []}


@trace_ai_call("question-bank-generation")
def generate_questions(
    concept_name: str,
    concept_description: str,
    question_type: str,
    count: int,
    difficulty: str = "Medium",
    rag_context: str = "",
) -> List[Dict[str, Any]]:
    """Returns validated question dicts ready to persist: {prompt, payload, explanation}.

    Retries the whole call up to 3 times, matching the convention in
    content_processing/kimi_service.py. Individual questions that fail validation are
    dropped rather than failing the batch - one malformed answer key out of eight is
    not a reason to give the teacher nothing.
    """
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to generate questions."
        )

    system_prompt = "\n\n".join([
        _SHARED_RULES,
        _TYPE_PROMPTS[question_type],
        _DIFFICULTY_GUIDANCE.get(difficulty, _DIFFICULTY_GUIDANCE["Medium"]),
    ])
    if rag_context:
        system_prompt += (
            "\n\nGROUNDING: excerpts from this course's own material follow the concept. "
            "Prefer their definitions, notation and terminology over the standard textbook "
            "phrasing - they are what this course actually teaches and assesses."
        )

    user_parts = [f"Concept: {concept_name}"]
    if concept_description:
        user_parts.append(f"Description: {concept_description}")
    if rag_context:
        user_parts.append(f"\nCourse material excerpts:\n\n{rag_context}")
    user_parts.append(f"\nWrite {count} question(s) of the required type for this concept.")
    user_content = "\n".join(user_parts)

    last_error = None
    for attempt in range(3):
        try:
            started = time.monotonic()
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=4000,
                timeout=60.0,
                extra_body=_reasoning_extra_body(),
            )
            logger.info(
                "Question generation (%s x%d) finished in %.1fs (attempt %d/3)",
                question_type, count, time.monotonic() - started, attempt + 1,
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(
                    f"Model returned empty content (finish_reason={response.choices[0].finish_reason})."
                )
            data = json.loads(raw_content)
            raw_questions = data.get("questions") or []
            if not raw_questions:
                raise ValueError("Model response had no 'questions'.")

            out: List[Dict[str, Any]] = []
            for rq in raw_questions:
                prompt = (rq.get("prompt") or "").strip()
                if not prompt:
                    continue
                try:
                    payload = qb.validate_payload(question_type, _to_payload(question_type, rq))
                except ValueError as e:
                    logger.warning("Dropping invalid generated %s question: %s", question_type, e)
                    continue
                out.append({
                    "prompt": prompt,
                    "payload": payload,
                    "explanation": (rq.get("explanation") or "").strip(),
                })

            if not out:
                raise ValueError("Every generated question failed validation.")
            return out

        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Question generation attempt %d/3 failed validation: %s", attempt + 1, e)
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning(
                "Question generation attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, e
            )

    raise RuntimeError(f"Question generation failed after 3 attempts: {last_error}")
