"""AI generation of learning materials (flashcards, MCQs/quizzes, study guides)
from a single knowledge-graph concept - the Content Generation module. Reuses the
same OpenRouter/Kimi client as concept extraction and assignment grading (see
app/content_processing/kimi_service.py) rather than a third AI integration.

Correctness strategy: every generated item is validated against a strict Pydantic
schema (see schemas.py - e.g. an MCQ must have 2-5 options and a correct_index that
actually points at one of them) immediately after parsing. A structurally invalid response
is retried, never silently passed through - this is what "the result generated is
always correct" can actually mean for an LLM call: correct *shape*, guaranteed by
code, not by asking nicely. Factual/pedagogical correctness of content is then the
teacher's review-and-approve gate (GeneratedContent.status), the same safety net
already used for the concept graph and assignment grades.

GROUNDING
---------
Generation is grounded in the course's own uploaded material via RAG. Previously
these calls received nothing but a concept name and a one-line graph description,
so the model wrote from its own general knowledge - which is why generated content
could drift from what the course actually taught, use unfamiliar notation, or cover
material the course never introduced. Retrieved excerpts are now passed in and the
prompt instructs the model to prefer the course's own definitions, terminology and
notation. Retrieval failing or returning nothing is NOT fatal: generation degrades
to ungrounded rather than erroring, since a course may legitimately have no uploaded
material yet.

DIFFICULTY
----------
Difficulty is a real instruction, not a label. Each level changes what the model is
asked to produce - recall vs application vs synthesis - because tagging identical
content "Hard" would be worse than useless to a student.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message
from app.content_generation.schemas import QUESTION_STYLES, FlashcardOut, MCQOut, StudyGuideOut, AssignmentDraftOut
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.content_generation")

VALID_DIFFICULTIES = ("Easy", "Medium", "Hard")

# What each level actually asks for, expressed in terms of the cognitive demand on
# the student rather than a vague "make it harder".
_DIFFICULTY_GUIDANCE = {
    "Easy": (
        "TARGET DIFFICULTY: EASY. Test recall and recognition of the core definition. "
        "Use the concept's own vocabulary, keep each item to a single step, and make "
        "the correct answer clearly correct to a student who has read the material "
        "once. Distractors should be plainly wrong on inspection, not subtle."
    ),
    "Medium": (
        "TARGET DIFFICULTY: MEDIUM. Test understanding and direct application. Items "
        "should require applying the concept to a concrete situation or relating it to "
        "a neighbouring idea, not just restating a definition. Distractors should "
        "reflect genuine, common misunderstandings."
    ),
    "Hard": (
        "TARGET DIFFICULTY: HARD. Test analysis, synthesis and edge cases. Items should "
        "require multi-step reasoning, comparing competing approaches, or recognising "
        "when the concept does NOT apply. Distractors must be genuinely tempting - each "
        "should be what a student holding a specific, plausible misconception would pick. "
        "Do not achieve difficulty by being vague, tricky about wording, or obscure."
    ),
}

_SYSTEM_PROMPTS = {
    "flashcard": """You are an expert instructional designer creating flashcards for one specific
concept in a university course. Each flashcard's "front" is a short, unambiguous
question/prompt and "back" is a precise, correct answer (1-3 sentences) - a student
should be able to self-test with these, not just re-read notes.

Respond ONLY with JSON: {"cards": [{"front": "...", "back": "..."}, ...]}""",

    "mcq": """You are an expert exam writer creating multiple-choice questions for one
specific concept in a university course. Each question must:
- Have EXACTLY 4 options, one and only one of which is correct, unless a QUESTION
  STYLES section below overrides that for a particular style.
- Have distractors (wrong options) that are plausible, not obviously silly - each
  should represent a real, common misconception about this concept.
- Include a short explanation of why the correct answer is correct, referencing
  the concept directly - this is shown to students after they answer, so it should
  teach, not just confirm.
- correct_index is the 0-based index of the right option in the "options" array.

Respond ONLY with JSON:
{"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correct_index": 0, "explanation": "..."}, ...]}""",

    "study_guide": """You are an expert tutor writing a study guide a student will actually revise from
the night before an assessment. Write for someone who attended the lecture and did
not follow all of it.

REQUIRED:
- "summary": 2-4 sentences explaining the concept in plain language. Lead with what it
  IS and what it is FOR. No preamble, no "in this section we will".
- "key_points": 4-8 bullets. Each must be a complete, standalone, checkable fact -
  something that could be marked right or wrong. "Understand the definition" is not a
  key point; "The limit of f(x) at a exists only if the left and right limits agree"
  is.

INCLUDE WHERE THE CONCEPT GENUINELY HAS THEM - omit the field entirely otherwise, and
never invent one to fill the space:
- "key_terms": the specific vocabulary a student must be able to define, each with a
  one-line definition. Only terms that belong to THIS concept.
- "formulae": the expressions worth memorising, written in plain text (x^2, sqrt(x),
  integral from a to b). One per entry, no prose.
- "worked_example": ONE fully worked problem, written as numbered steps, each step
  saying what is being done AND why. This is the single most useful part of a guide -
  include it for anything procedural or computational. Skip it only for a purely
  definitional concept.
- "common_mistakes": the specific errors students actually make here - the wrong
  assumption, the dropped condition, the confused pair of terms. Not generic advice
  like "revise carefully". Phrase each as the mistake itself.
- "connections": 1-2 sentences on what this builds on and what builds on it, so the
  concept sits in the course rather than floating.

Respond ONLY with JSON:
{"summary": "...", "key_points": ["...", "..."],
 "key_terms": [{"term": "...", "definition": "..."}],
 "formulae": ["..."], "worked_example": "1. ...\\n2. ...",
 "common_mistakes": ["..."], "connections": "..."}""",

    "material": """You are a subject-matter expert writing the full, detailed teaching material for
one specific concept in a university course - the definitive explanation a student
reads to actually LEARN the concept, not a short summary or a study-guide crib sheet.

Write several well-organized paragraphs (using markdown headings/subheadings where they
help) that:
- Explain the concept thoroughly and precisely: what it is, why it matters, how it
  works, and how it connects to the rest of the course.
- Walk through at least one worked example or concrete illustration in full detail,
  not just a summary of one.
- Use the course's own terminology, notation and examples wherever the supplied
  excerpts provide them, rather than generic textbook phrasing.
- Read as professionally written, publication-quality course material - correct,
  well-structured and complete, not a rough draft.

Respond ONLY with JSON: {"material": "... full markdown text ..."}""",

    "assignment": """You are an experienced university instructor designing a graded assignment
for one specific concept in a course - both the student-facing brief AND the
grading rubric a teacher will use on every submission, together as one draft.

Write:
- "title": a short, specific assignment title (not just the concept name).
- "instructions": the full student-facing brief (2-5 sentences or a short numbered
  list) - what to do, and what a strong submission demonstrates about this concept.
- "points": total points the assignment is worth (a normal whole-course value,
  typically 20-100 - use your judgement from the concept's weight/difficulty).
- "criteria": 3-6 grading criteria that together sum to "points". Each needs a
  short title, a one-sentence description of what earns full marks, a point
  value, and - ONLY when it genuinely assesses one of the listed CLOs below -
  that CLO's exact code. Leave clo_code null when no listed CLO fits.

Respond ONLY with JSON:
{"title": "...", "instructions": "...", "points": 50,
 "criteria": [{"title": "...", "description": "...", "max_points": 30, "clo_code": "CLO1"},
              {"title": "...", "description": "...", "max_points": 20, "clo_code": null}]}""",
}

def _language_instruction(language: str) -> str:
    """Instruction for writing the material in a language other than English.

    Written to survive the language-teaching case, which is the one that breaks naive
    "translate everything" prompts: for a Spanish course the concept name, the course
    material and the teacher's own notes are usually in English, while the cards must
    be in Spanish - except the explanations, which are only useful to a learner in the
    language they already speak.
    """
    return (
        f"\n\nLANGUAGE:\n"
        f"Write the learner-facing content in {language}. The concept name, the course "
        f"outline and the retrieved excerpts may be in a different language - that is "
        f"expected, and you should still produce {language} output from them. Keep "
        f"technical terms, proper nouns, code, symbols and formulae exactly as they "
        f"are; do not translate them. Where the material teaches {language} ITSELF, "
        f"the item being tested must be in {language} while the explanation of WHY an "
        f"answer is right should stay in English, since that is what the learner "
        f"already reads."
    )


_SOURCE_TEXT_INSTRUCTION = (
    "\n\nSUPPLIED SOURCE:\n"
    "The teacher supplied the document below specifically for this generation. Treat "
    "it as the primary source: base the material on what it actually says, and use its "
    "wording, notation and examples. It replaces the course's own retrieved material "
    "for this request, so do not assume anything beyond it except standard background "
    "knowledge needed to make an item answerable."
)


_IMPORT_INSTRUCTION = (
    "\n\nTHE SOURCE ALREADY CONTAINS QUESTIONS:\n"
    "The teacher says the document below is an existing quiz or exam paper. Transcribe "
    "its questions rather than writing new ones: keep each question's wording, its "
    "options and its intended answer. Do not add questions it does not contain, and do "
    "not drop ones it does. Three things you must still supply, because a paper "
    "usually will not have them:\n"
    "- If the answer is not marked, work it out and set correct_index accordingly.\n"
    "- If a question has no explanation, write one.\n"
    "- If a question is not multiple-choice in the source (short answer, essay, "
    "numeric), turn it into one: keep the original question text and write plausible "
    "distractors around the real answer. If it cannot honestly be made into a "
    "multiple-choice question, leave it out rather than mangling it.\n"
    "Requests for a specific number of questions are a cap, not a target - never "
    "invent questions to reach a count."
)


def _question_style_instruction(styles: List[str]) -> str:
    """Turns the teacher's ticked styles into a mixing instruction.

    Spelling out "spread them roughly evenly" matters: asked for three styles the
    model will otherwise write nine recall questions and one of each of the others,
    because recall is the easiest thing to write.
    """
    lines = "\n".join(f"- {QUESTION_STYLES[s]}" for s in styles if s in QUESTION_STYLES)
    return (
        "\n\nQUESTION STYLES:\n"
        "Use ONLY these styles, spread roughly evenly across the set rather than "
        "clustering at whichever is easiest to write:\n"
        f"{lines}\n"
        "Where a style states its own number of options, that number wins over the "
        "4-option rule above. Every question still uses the same JSON shape."
    )


_OUTLINE_INSTRUCTION = (
    "\n\nCOURSE SCOPE:\n"
    "The course outline follows. It is the syllabus - the authoritative statement of "
    "what this course covers, in what order, and to what depth. Use it to stay in "
    "scope: do not produce material on aspects of the concept the course never "
    "reaches, and pitch the depth to where this topic sits in the course. It is an "
    "administrative document, so ignore its credit hours, assessment weightings and "
    "book lists entirely - only its topic coverage matters here."
)

_GROUNDING_INSTRUCTION = (
    "\n\nGROUNDING - IMPORTANT:\n"
    "Excerpts from this course's own uploaded material are provided below. Base your "
    "output on them: use the course's own definitions, terminology, notation and "
    "worked examples in preference to the standard textbook phrasing you already know. "
    "Where the excerpts and your general knowledge disagree about emphasis or notation, "
    "follow the excerpts - they are what this course actually teaches and what students "
    "will be assessed on. Do not introduce methods or notation the excerpts never use. "
    "If the excerpts do not cover part of the concept, fall back to standard knowledge "
    "for that part rather than inventing course-specific detail."
)


def normalize_difficulty(value: Optional[str]) -> str:
    """Accepts any casing, falls back to Medium. Kept permissive because the value
    can arrive from a client, from a Neo4j concept property, or be absent entirely."""
    if not value:
        return "Medium"
    cleaned = str(value).strip().capitalize()
    return cleaned if cleaned in VALID_DIFFICULTIES else "Medium"


def _client_or_raise():
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to enable "
            "content generation. See https://openrouter.ai/keys."
        )
    return client


def _compose_system_prompt(
    kind: str, difficulty: str, has_context: bool, has_outline: bool = False,
    language: str = "English", has_source_text: bool = False,
    question_styles: Optional[List[str]] = None, import_existing: bool = False,
) -> str:
    """Assembles the system turn.

    Order matters: task, then difficulty, then STYLES, then SCOPE (the outline), then
    SOURCE, then LANGUAGE. Difficulty and styles sit together because both shape the
    item itself. Scope before source because the outline decides whether a topic
    belongs at all, while the material only decides how it should be phrased - a
    retrieved passage must never pull the material outside the syllabus. Language goes
    last so it applies to everything above it.
    """
    parts = [_SYSTEM_PROMPTS[kind], "\n\n", _DIFFICULTY_GUIDANCE[normalize_difficulty(difficulty)]]
    # Only questions have styles; asking for "fill in the blank flashcards" would just
    # confuse the flashcard prompt, so the client's choice is ignored for other kinds.
    if question_styles and kind in ("mcq", "quiz"):
        parts.append(_question_style_instruction(question_styles))
    if has_outline:
        parts.append(_OUTLINE_INSTRUCTION)
    # A teacher-supplied document outranks the course's own retrieved material, so its
    # instruction REPLACES the grounding one rather than stacking with it - two
    # competing "prefer this source" rules would just muddy both.
    if has_source_text:
        parts.append(_SOURCE_TEXT_INSTRUCTION)
        # Transcribing an existing paper is a different job from writing from a
        # source, so it only applies when there is a source to transcribe.
        if import_existing and kind in ("mcq", "quiz"):
            parts.append(_IMPORT_INSTRUCTION)
    elif has_context:
        parts.append(_GROUNDING_INSTRUCTION)
    if language and language.strip().lower() != "english":
        parts.append(_language_instruction(language.strip()))
    return "".join(parts)


def _compose_user_content(
    concept_name: str,
    concept_description: str,
    task_line: str,
    rag_context: str = "",
    parent_concept: Optional[str] = None,
    parent_description: str = "",
    combine_with_parent: bool = False,
    course_outline: str = "",
) -> str:
    """Builds the user turn.

    parent_concept serves two very different purposes depending on combine_with_parent:

      False - ORIENTATION. The parent is named so the model knows what it may assume
              the student already has, but the material is about the concept alone.
              Without this note the model drifts into re-teaching the prerequisite.
      True  - SUBJECT. The material must cover both, integrated - the prerequisite as
              the foundation and the concept built on top, including items that only
              make sense if you hold both. This is the case a teacher wants when
              students are failing a topic because the thing underneath it never
              landed, and drilling either one alone would not fix it.
    """
    if combine_with_parent and parent_concept:
        blocks = [
            "This material must cover TWO linked concepts TOGETHER, as one integrated set:",
            f"  1. \"{parent_concept}\" - the prerequisite, i.e. the foundation.",
            (f"     Description: {parent_description}" if parent_description else ""),
            f"  2. \"{concept_name}\" - what builds on that foundation.",
            (f"     Description: {concept_description}" if concept_description else ""),
            "",
            "Integrate them; do not produce two separate topics bolted together:",
            f"- Establish \"{parent_concept}\" first, then show how \"{concept_name}\" depends on it.",
            f"- Roughly a third of the items should test \"{parent_concept}\" on its own, so a "
            f"student who is actually stuck on the foundation finds that out.",
            f"- At least one item must require CONNECTING the two - answerable only by someone "
            f"who holds both, not by someone who has memorised either in isolation.",
            "- Use consistent notation and terminology across both.",
        ]
        blocks = [b for b in blocks if b != ""]
    else:
        blocks = [f"Concept: {concept_name}"]
        if concept_description:
            blocks.append(f"Description: {concept_description}")
        if parent_concept:
            blocks.append(
                f"This concept builds on the prerequisite concept \"{parent_concept}\". "
                f"You may assume familiarity with it and may reference it, but the material "
                f"you produce must be about \"{concept_name}\", not about \"{parent_concept}\"."
            )

    # Scope before source, matching the system prompt's ordering: the outline decides
    # whether a topic belongs in this course at all, the excerpts only decide how it
    # should be worded.
    if course_outline:
        blocks.append(f"\nCourse outline (scope reference, not source material):\n\n{course_outline}")
    if rag_context:
        blocks.append(f"\nExcerpts from this course's uploaded material:\n\n{rag_context}")
    blocks.append(f"\n{task_line}")
    return "\n".join(blocks)


def _call_and_validate(
    system_prompt: str, user_content: str, list_key: str, item_cls, max_tokens: int = 4000,
) -> List[Dict[str, Any]]:
    """Calls the model, parses JSON, and validates every item in the list against
    item_cls (pydantic). Retries the whole call (not just re-parsing) up to 3 times
    if the response is malformed JSON OR fails schema validation - a repeat call
    with the same prompt frequently produces a well-formed response even when the
    first didn't, same pattern as kimi_service.clean_and_structure_chunk."""
    client = _client_or_raise()
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
                # kimi-k2.5 is a reasoning model - excluded here so it answers
                # directly instead of spending the token budget on internal
                # "thinking" first (which could exhaust max_tokens before ever
                # emitting content, leaving message.content=None).
                max_tokens=max_tokens,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            logger.info("Content generation call finished in %.1fs (attempt %d/3)", time.monotonic() - started, attempt + 1)
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            items = data.get(list_key, [])
            if not items:
                raise ValueError(f"Model response had no '{list_key}' items")
            validated = [item_cls.model_validate(item) for item in items]
            return [v.model_dump() for v in validated]
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_error = e
            logger.warning("Content generation attempt %d/3 failed validation: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Content generation attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Content generation failed after 3 attempts: {last_error}")


@trace_ai_call("content-generation-flashcards")
def generate_flashcards(
    concept_name: str,
    concept_description: str,
    count: int,
    difficulty: str = "Medium",
    rag_context: str = "",
    parent_concept: Optional[str] = None,
    parent_description: str = "",
    combine_with_parent: bool = False,
    course_outline: str = "",
    language: str = "English",
    source_text: str = "",
    clo: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    system_prompt = _compose_system_prompt("flashcard", difficulty, bool(rag_context), bool(course_outline), language, bool(source_text))
    system_prompt += _target_clo_instruction(clo)
    user_content = _compose_user_content(
        concept_name, concept_description,
        f"Generate {count} flashcards covering the above.",
        source_text or rag_context, parent_concept, parent_description, combine_with_parent, course_outline,
    )
    cards = _call_and_validate(system_prompt, user_content, "cards", FlashcardOut)
    return {"cards": cards}


@trace_ai_call("content-generation-mcq")
def generate_mcq(
    concept_name: str,
    concept_description: str,
    count: int,
    difficulty: str = "Medium",
    rag_context: str = "",
    parent_concept: Optional[str] = None,
    parent_description: str = "",
    combine_with_parent: bool = False,
    course_outline: str = "",
    language: str = "English",
    source_text: str = "",
    question_styles: Optional[List[str]] = None,
    import_existing: bool = False,
    clo: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    system_prompt = _compose_system_prompt(
        "mcq", difficulty, bool(rag_context), bool(course_outline), language,
        bool(source_text), question_styles, import_existing,
    )
    system_prompt += _target_clo_instruction(clo)
    # Transcribing turns the count into a ceiling: a paper with six questions must
    # come back with six, not padded out to whatever number the composer defaulted to.
    task_line = (
        f"Transcribe the questions in the supplied source, up to {count} of them."
        if import_existing and source_text
        else f"Generate {count} multiple-choice questions covering the above."
    )
    user_content = _compose_user_content(
        concept_name, concept_description, task_line,
        source_text or rag_context, parent_concept, parent_description, combine_with_parent, course_outline,
    )
    questions = _call_and_validate(system_prompt, user_content, "questions", MCQOut)
    return {"questions": questions}


@trace_ai_call("content-generation-study-guide")
def generate_study_guide(
    concept_name: str,
    concept_description: str,
    difficulty: str = "Medium",
    rag_context: str = "",
    parent_concept: Optional[str] = None,
    parent_description: str = "",
    combine_with_parent: bool = False,
    course_outline: str = "",
    language: str = "English",
    source_text: str = "",
    clo: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    system_prompt = _compose_system_prompt("study_guide", difficulty, bool(rag_context), bool(course_outline), language, bool(source_text))
    system_prompt += _target_clo_instruction(clo)
    user_content = _compose_user_content(
        concept_name, concept_description,
        "Write a study guide covering the above.",
        source_text or rag_context, parent_concept, parent_description, combine_with_parent, course_outline,
    )
    client = _client_or_raise()
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.4,
                # Raised from 2000: a guide now carries key terms, formulae, a
                # step-by-step worked example and common mistakes, and 2000 truncated
                # mid-JSON often enough to burn all three retries.
                max_tokens=3500,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            validated = StudyGuideOut.model_validate(data)
            return validated.model_dump()
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_error = e
            logger.warning("Study guide generation attempt %d/3 failed validation: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Study guide generation attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Study guide generation failed after 3 attempts: {last_error}")


def _clo_block(clos: List[Dict[str, str]]) -> str:
    if not clos:
        return "(This course has no defined Course Learning Outcomes yet - leave clo_code null on every criterion.)"
    return "\n".join(f"- {c['code']}: {c['title']}" for c in clos)


def _clo_line(clo: Dict[str, str]) -> str:
    desc = f" - {clo['description']}" if clo.get("description") else ""
    return f"\"{clo['code']}: {clo['title']}\"{desc}"


def _target_clo_instruction(clo: Optional[Dict[str, str]]) -> str:
    """A single Course Learning Outcome the teacher explicitly picked for THIS item
    (flashcard set / quiz / study guide), e.g. via the "Link to CLO" dropdown. Kept
    separate from _clo_block (assignment's per-criterion tagging against the whole
    CLO list) because these generators produce one item meant to serve one chosen
    outcome, not several criteria each tagged independently."""
    if not clo:
        return ""
    return (
        "\n\nLEARNING OUTCOME TO TARGET:\n"
        f"This item is meant to help students meet the Course Learning Outcome "
        f"{_clo_line(clo)}. Write it so that answering or studying it correctly "
        "demonstrates progress toward THIS outcome specifically - not just general "
        "familiarity with the concept."
    )


def _concept_clos_instruction(clos: List[Dict[str, str]]) -> str:
    """The Course Learning Outcomes already linked to this concept in the graph
    (ConceptCLOMap, see app/outcomes/services.py) - informational context for
    concept-material generation, not a single teacher-picked target like above."""
    if not clos:
        return ""
    lines = "\n".join(f"- {_clo_line(c)}" for c in clos)
    return (
        "\n\nCOURSE LEARNING OUTCOMES THIS CONCEPT ADDRESSES:\n"
        f"{lines}\n"
        "Make sure the material actually equips a student to meet these outcomes - "
        "cover what they require, don't just mention them in passing."
    )


@trace_ai_call("content-generation-assignment")
def generate_assignment(
    concept_name: str,
    concept_description: str,
    difficulty: str = "Medium",
    rag_context: str = "",
    parent_concept: Optional[str] = None,
    parent_description: str = "",
    combine_with_parent: bool = False,
    course_outline: str = "",
    language: str = "English",
    source_text: str = "",
    clos: Optional[List[Dict[str, str]]] = None,
    criteria_count: Optional[int] = None,
) -> Dict[str, Any]:
    """Drafts a full assignment - brief + grading rubric together - for one
    concept, the same RAG-grounded, teacher-reviewed pattern as every other
    content type here. Returns an AssignmentDraftOut-shaped dict; nothing is a
    real Assignment/Rubric row until the teacher approves it via the
    "create assignment" action (see content_generation/routes.py)."""
    system_prompt = _compose_system_prompt("assignment", difficulty, bool(rag_context), bool(course_outline), language, bool(source_text))
    system_prompt += f"\n\nCourse Learning Outcomes (CLOs) available to tag criteria against:\n{_clo_block(clos or [])}"
    if criteria_count:
        system_prompt += (
            f"\n\nCRITERION COUNT: The teacher asked for exactly {max(1, int(criteria_count))} "
            f"grading criteria - override the '3-6' guidance above and produce exactly that many."
        )
    user_content = _compose_user_content(
        concept_name, concept_description,
        "Design the assignment brief and grading rubric covering the above.",
        source_text or rag_context, parent_concept, parent_description, combine_with_parent, course_outline,
    )
    client = _client_or_raise()
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.35,
                max_tokens=2500,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            validated = AssignmentDraftOut.model_validate(data)
            return validated.model_dump()
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_error = e
            logger.warning("Assignment draft generation attempt %d/3 failed validation: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Assignment draft generation attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Assignment draft generation failed after 3 attempts: {last_error}")


@trace_ai_call("content-generation-concept-material")
def generate_concept_material(
    concept_name: str,
    concept_description: str,
    rag_context: str = "",
    course_outline: str = "",
    instruction: Optional[str] = None,
    clos: Optional[List[Dict[str, str]]] = None,
) -> str:
    """Generates the full, detailed teaching material for one concept node - the long-
    form field shown in the knowledge graph node detail panel, distinct from the
    short `description` field. Strictly grounded in `rag_context` (the course's own
    uploaded material, via app/rag/retrieval.py's retrieve_for_concept) using the same
    "answer only from provided context" discipline as GROUNDED_ANSWER_SYSTEM_PROMPT -
    hallucinated detailed material is a worse failure mode here than for flashcards,
    since a teacher may publish it near-verbatim. Result is a proposal only: the
    caller (knowledge_graph/routes.py) submits it through the same GraphEditProposal
    coordinator-approval flow as any other node edit."""
    system_prompt = _compose_system_prompt("material", "Medium", bool(rag_context), bool(course_outline))
    if not rag_context:
        system_prompt += (
            "\n\nNo course material excerpts were found for this concept. Say so is not "
            "an option here - write the material from your own subject-matter expertise "
            "instead, but keep it as accurate and standard as possible for the field."
        )
    else:
        system_prompt += (
            "\n\nGROUNDING: Base the material primarily on the excerpts below. You may "
            "supplement with standard subject-matter knowledge to make the explanation "
            "complete, but never contradict the excerpts, and prefer their terminology, "
            "notation and examples over generic ones."
        )
    system_prompt += _concept_clos_instruction(clos or [])
    task_line = "Write the full detailed teaching material covering the above."
    if instruction and instruction.strip():
        task_line += f" Additional instruction from the teacher: {instruction.strip()}"
    user_content = _compose_user_content(
        concept_name, concept_description, task_line, rag_context, course_outline=course_outline,
    )

    client = _client_or_raise()
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.35,
                max_tokens=6000,
                timeout=90.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            material = (data.get("material") or "").strip()
            if not material:
                raise ValueError("Model response had no 'material' text")
            return material
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Concept material generation attempt %d/3 failed: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Concept material generation attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Concept material generation failed after 3 attempts: {last_error}")


@trace_ai_call("content-generation-concept-material-edit")
def edit_concept_material(current_material: str, instruction: str) -> str:
    """Applies one targeted refinement to existing concept material text - a small
    edit, not a regeneration. Deliberately does NOT re-run RAG retrieval: the teacher
    is asking for a specific change to what's already there (e.g. "add a diagram
    description", "simplify the second paragraph"), not a fresh grounded rewrite."""
    system_prompt = (
        "You are editing an existing piece of university course material based on a "
        "specific instruction from the teacher. Preserve everything that the "
        "instruction does not target - do not rewrite, reorganize, or shorten "
        "unrelated parts. Make only the requested change, then return the FULL "
        "resulting text (not just the changed portion).\n\n"
        "Respond ONLY with JSON: {\"material\": \"... full updated markdown text ...\"}"
    )
    user_content = (
        f"Current material:\n\n{current_material}\n\n"
        f"Instruction: {instruction.strip()}"
    )

    client = _client_or_raise()
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=6000,
                timeout=90.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            material = (data.get("material") or "").strip()
            if not material:
                raise ValueError("Model response had no 'material' text")
            return material
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Concept material edit attempt %d/3 failed: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Concept material edit attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Concept material edit failed after 3 attempts: {last_error}")


@trace_ai_call("content-generation-assignment-refine")
def refine_assignment_draft(current_draft: Dict[str, Any], instruction: str) -> Dict[str, Any]:
    """Applies one targeted refinement instruction to an existing AI-drafted
    assignment (title/instructions/points/criteria) before it's approved into a
    real Assignment - e.g. "add a criterion for citations", "make the brief
    shorter". A small, targeted edit, not a regeneration: does not re-run RAG
    retrieval, and is told to preserve everything the instruction doesn't target.
    Returns a dict re-validated by the caller against AssignmentDraftOut."""
    system_prompt = (
        "You are editing an existing AI-drafted university assignment (brief + "
        "grading rubric) based on a specific instruction from the teacher. "
        "Preserve every field and every criterion the instruction does not "
        "target - do not rewrite, reorder, or drop anything unrelated. Make only "
        "the requested change, then return the FULL resulting draft in the same "
        "shape as the input.\n\n"
        "Respond ONLY with JSON in this exact format:\n"
        '{"title": "...", "instructions": "...", "points": 50,\n'
        ' "criteria": [{"title": "...", "description": "...", "max_points": 30, "clo_code": null}]}'
    )
    user_content = (
        f"Current draft:\n{json.dumps(current_draft, indent=2)}\n\n"
        f"Instruction: {instruction.strip()}"
    )

    client = _client_or_raise()
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2500,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            validated = AssignmentDraftOut.model_validate(data)
            return validated.model_dump()
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_error = e
            logger.warning("Assignment draft refine attempt %d/3 failed validation: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Assignment draft refine attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Assignment draft refine failed after 3 attempts: {last_error}")
