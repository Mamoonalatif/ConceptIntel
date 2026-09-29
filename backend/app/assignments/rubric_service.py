"""AI-drafted grading rubric for an assignment. Reuses the same RAG retrieval
(app/rag/retrieval.py) and Kimi client (app/content_processing/kimi_service.py)
already wired into grading_service.py, so a rubric is grounded in what the course
actually taught rather than the model's generic idea of the assignment's subject.

One Rubric row per Assignment (see Rubric/RubricCriterion in
app/database/models.py) - the same rubric is used to grade every student's
submission in that class, never one per student.

ANALYTIC RUBRIC LEVELS
----------------------
Each criterion also gets a small performance-level grid (Excellent/Good/Fair/
Poor, or similar) instead of being a single free-form point count - the
standard analytic-rubric format, and what lets grading (see grading_service.py)
pick a level rather than inventing a point value. `_balance_to_total` below is
what makes "criteria sum to the assignment's total points" actually true by
construction rather than just something the prompt asks nicely for - an LLM
asked to make N numbers sum to a target routinely misses by a few points.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message, _reasoning_extra_body
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.rubric")

SYSTEM_PROMPT = """You are an experienced university instructor writing a grading
rubric for an assignment, before any student has submitted work.

You are given the assignment's title and instructions, the point value it is worth,
a list of course concepts (from the course's concept graph) it may draw on, this
course's own Course Learning Outcomes (CLOs), and (when available) excerpts of the
course's own teaching material.

Write 3 to 6 grading criteria that together cover the assignment fully and sum to
the assignment's total points. Each criterion needs:
- A short title and a one-sentence description of what earns full marks.
- A point value.
- A CLO code (e.g. "CLO2") ONLY when the criterion genuinely assesses one of the
  listed CLOs - leave it null when no listed CLO fits, do not force a match.
- A "levels" array: 3 to 4 performance levels ordered BEST to WORST (e.g.
  Excellent/Good/Fair/Poor, or Exemplary/Proficient/Developing/Beginning - pick
  labels that fit this specific criterion rather than reusing the same four
  words everywhere). The highest level's points must equal the criterion's own
  max_points; the lowest level's points must be 0. Each level needs a one-
  sentence description of what a submission at that level actually does -
  concrete and checkable, not "somewhat meets expectations".

Respond ONLY with valid JSON in this exact format:
{
  "criteria": [
    {
      "title": "Correct application of Newton's Second Law",
      "description": "F=ma is applied correctly with consistent units throughout.",
      "max_points": 30,
      "clo_code": "CLO2",
      "levels": [
        {"label": "Excellent", "points": 30, "description": "F=ma applied correctly in every case, units consistent and shown."},
        {"label": "Good", "points": 22, "description": "F=ma applied correctly overall, with a minor unit or arithmetic slip."},
        {"label": "Fair", "points": 15, "description": "F=ma attempted but misapplied in at least one case, or units inconsistent."},
        {"label": "Poor", "points": 0, "description": "F=ma not applied, or applied incorrectly throughout."}
      ]
    }
  ]
}"""


def _clo_block(clos: List[Dict[str, str]]) -> str:
    if not clos:
        return "(This course has no defined Course Learning Outcomes yet - omit clo_code from every criterion.)"
    return "\n".join(f"- {c['code']}: {c['title']}" for c in clos)


def _normalize_criterion(c: Dict[str, Any]) -> Dict[str, Any]:
    """Clamps/validates one criterion's shape - max_points non-negative, levels
    sorted best-to-worst with points clamped into [0, max_points]. A criterion
    with no usable levels (the model omitted them, or returned garbage) gets a
    minimal 2-level Full/No-credit fallback rather than being left level-less -
    grading still works either way (see grading_service.py), but a criterion
    that's *supposed* to have levels shouldn't silently lose them to a parsing
    hiccup."""
    max_points = max(0.0, float(c.get("max_points", 0)))
    c["max_points"] = max_points
    c["clo_code"] = c.get("clo_code") or None

    raw_levels = c.get("levels") or []
    levels: List[Dict[str, Any]] = []
    for lv in raw_levels:
        if not isinstance(lv, dict) or not (lv.get("label") or "").strip():
            continue
        levels.append({
            "label": lv["label"].strip(),
            "points": max(0.0, min(max_points, float(lv.get("points", 0)))),
            "description": (lv.get("description") or "").strip() or None,
        })
    levels.sort(key=lambda lv: lv["points"], reverse=True)
    if not levels:
        levels = [
            {"label": "Full credit", "points": max_points, "description": None},
            {"label": "No credit", "points": 0.0, "description": None},
        ]
    else:
        # The prompt requires the top level to equal max_points exactly - enforce
        # it rather than trust the model's arithmetic, since _balance_to_total
        # below also depends on this invariant holding.
        levels[0]["points"] = max_points
        if levels[-1]["points"] != 0.0:
            levels[-1]["points"] = 0.0
    c["levels"] = levels
    return c


def _balance_to_total(criteria: List[Dict[str, Any]], total_points: float) -> List[Dict[str, Any]]:
    """Rescales every criterion's max_points (and its levels' points) so they sum
    to EXACTLY total_points, rather than however close the model's own arithmetic
    happened to land - an LLM asked to make several numbers sum to a target
    routinely misses by a few points. No-ops if total_points isn't a positive
    number (e.g. the assignment has no point value set) or the draft is already
    exact."""
    current_total = sum(c["max_points"] for c in criteria)
    if total_points <= 0 or current_total <= 0 or abs(current_total - total_points) < 0.01:
        return criteria

    scale = total_points / current_total
    running_total = 0.0
    for i, c in enumerate(criteria):
        is_last = i == len(criteria) - 1
        # The last criterion absorbs whatever rounding remainder is left, so the
        # sum is exact rather than merely close - simple rounding per-criterion
        # can still land a fraction of a point off the target.
        new_max = round(total_points - running_total, 1) if is_last else round(c["max_points"] * scale, 1)
        new_max = max(0.0, new_max)
        level_scale = (new_max / c["max_points"]) if c["max_points"] else 0.0
        for lv in c["levels"]:
            lv["points"] = round(lv["points"] * level_scale, 1)
        if c["levels"]:
            c["levels"][0]["points"] = new_max  # keep the "top level == max_points" invariant exact
        c["max_points"] = new_max
        running_total += new_max
    return criteria


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
    Returns {"criteria": [{"title", "description", "max_points", "clo_code",
    "levels": [{"label", "points", "description"}, ...]}, ...]}, with max_points
    guaranteed to sum to total_points (see _balance_to_total)."""
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
                # Raised from 2000: each criterion now carries 3-4 levels with their
                # own descriptions, several times the previous payload size.
                max_tokens=4000,
                timeout=60.0,
                extra_body=_reasoning_extra_body(),
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
            criteria = [_normalize_criterion(c) for c in criteria]
            criteria = _balance_to_total(criteria, total_points)
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
