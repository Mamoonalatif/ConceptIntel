"""AI-drafted grading rubric for an assignment. Reuses the same RAG retrieval
(app/rag/retrieval.py) and Kimi client (app/content_processing/kimi_service.py)
already wired into grading_service.py, so a rubric is grounded in what the course
actually taught rather than the model's generic idea of the assignment's subject.

One Rubric row per Assignment (see Rubric/RubricCriterion in
app/database/models.py) - the same rubric is used to grade every student's
submission in that class, never one per student.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.rubric")

SYSTEM_PROMPT = """You are an experienced university instructor writing a grading
rubric for an assignment, before any student has submitted work.

You are given the assignment's title and instructions, the point value it is worth,
a list of course concepts (from the course's concept graph) it may draw on, this
course's own Course Learning Outcomes (CLOs), and (when available) excerpts of the
course's own teaching material.

Write 3 to 6 grading criteria that together cover the assignment fully and sum to
the assignment's total points. Each criterion needs a short title, a one-sentence
description of what earns full marks, a point value, and - ONLY when the criterion
genuinely assesses one of the listed CLOs - that CLO's exact code (e.g. "CLO1").
Leave clo_code null when no listed CLO fits; do not force a match.

Respond ONLY with valid JSON in this exact format:
{
  "criteria": [
    {"title": "Correct application of Newton's Second Law", "description": "F=ma is applied correctly with consistent units throughout.", "max_points": 30, "clo_code": "CLO2"},
    {"title": "Clarity of free-body diagrams", "description": "Diagrams show all relevant forces, clearly labeled.", "max_points": 20, "clo_code": null}
  ]
}"""


def _clo_block(clos: List[Dict[str, str]]) -> str:
    if not clos:
        return "(This course has no defined Course Learning Outcomes yet - omit clo_code from every criterion.)"
    return "\n".join(f"- {c['code']}: {c['title']}" for c in clos)


@trace_ai_call("rubric-generation")
def generate_rubric_draft(
    assignment_title: str,
    assignment_description: Optional[str],
    total_points: float,
    concepts: List[Dict[str, str]],
    clos: List[Dict[str, str]],
    course_material: str = "",
) -> Dict[str, Any]:
    """concepts: [{"name", "description"}, ...]. clos: [{"code", "title"}, ...].
    Returns {"criteria": [{"title", "description", "max_points", "clo_code"}, ...]}."""
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to enable "
            "AI rubric generation. See https://openrouter.ai/keys."
        )

    concept_list = (
        "\n".join(f"- {c['name']}: {c['description']}" for c in concepts)
        if concepts
        else "(This course has no knowledge-graph concepts yet - write the rubric against the assignment brief alone.)"
    )

    material_block = ""
    if course_material.strip():
        material_block = f"\nExcerpts from this course's own teaching material:\n{course_material}\n"

    user_content = f"""Assignment: {assignment_title}
Instructions: {assignment_description or 'No additional instructions provided.'}
Total points: {total_points}

Course concepts this assignment may draw on:
{concept_list}

Course Learning Outcomes (CLOs) available to tag criteria against:
{_clo_block(clos)}
{material_block}"""

    last_error = None
    for attempt in range(3):
        try:
            started = time.monotonic()
            logger.info("Rubric generation starting (attempt %d/3, model=%s)", attempt + 1, settings.KIMI_MODEL)
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2000,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            logger.info("Rubric generation finished in %.1fs", time.monotonic() - started)
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(
                    f"Model returned empty content (finish_reason={response.choices[0].finish_reason})."
                )
            data = json.loads(raw_content)
            criteria = data.get("criteria") or []
            if not criteria:
                raise ValueError("Model returned no rubric criteria.")
            for c in criteria:
                c["max_points"] = max(0.0, float(c.get("max_points", 0)))
                c["clo_code"] = (c.get("clo_code") or None)
            return {"criteria": criteria}
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Rubric generation returned malformed JSON on attempt %d/3: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Rubric generation failed on attempt %d/3: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Rubric generation failed after 3 attempts: {last_error}")
