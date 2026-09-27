"""AI-assisted concept-level grading for assignment submissions. Extracts text from
the submitted file, compares it against the course's knowledge-graph concepts, and
produces a per-concept score plus explainable feedback - the missing half of the
Assignment Evaluation module (see AssignmentSubmission.grade/feedback in
app/database/models.py, previously never written to anywhere).

Reuses the same OpenRouter/Kimi client already configured for the content
processing pipeline (see app/content_processing/kimi_service.py) rather than
introducing a second AI integration just for grading.
"""
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message
from app.observability import trace_ai_call
from app.upload.services import extract_text_from_file

logger = logging.getLogger("conceptintel.grading")

SYSTEM_PROMPT = """You are an experienced, fair teaching assistant grading one student's
assignment submission for a university course.

You are given:
1. The assignment title and instructions.
2. A list of course concepts (from the course's concept graph) this assignment may
   draw on - not every concept necessarily applies to every assignment.
3. The student's submission, extracted as plain text (it may contain OCR noise or
   formatting artifacts from PDF/Word conversion - read past that, judge the
   substance).

Grade generously but honestly: reward genuine understanding even if phrasing is
imperfect, but do not award credit for content that is missing, wrong, or
off-topic. For EACH concept in the provided list that is actually relevant to this
assignment, decide how well the submission demonstrates understanding of it
(0-100), and write ONE short, specific, actionable sentence of feedback tied to
that concept - this is what makes the feedback "explainable" rather than just a
number. If a listed concept genuinely isn't touched by this assignment, omit it
from concept_scores entirely rather than guessing.

Also give one overall_grade (0-100) for the submission as a whole, and one
overall_feedback paragraph (2-4 sentences) summarizing strengths and the most
important gap to address next.

Respond ONLY with valid JSON in this exact format:
{
  "overall_grade": 82,
  "overall_feedback": "Overall summary...",
  "concept_scores": [
    {"concept_name": "Newton's Second Law", "score": 90, "feedback": "Correctly applied F=ma throughout, with correct unit handling."},
    {"concept_name": "Free Body Diagrams", "score": 60, "feedback": "Diagram is present but omits the normal force on the incline - review how to resolve forces on angled surfaces."}
  ]
}"""

RUBRIC_SYSTEM_PROMPT_SUFFIX = """

You are ALSO given this assignment's grading rubric - a fixed list of criteria the
teacher defined for every student's submission in this class. For EACH criterion,
award a points_earned value (0 up to that criterion's max_points) and one short,
specific sentence of feedback tied to that criterion. overall_grade must be the
sum of every criterion's points_earned, rescaled to a 0-100 scale against the
rubric's total possible points.

Respond ONLY with valid JSON in this exact format:
{
  "overall_grade": 82,
  "overall_feedback": "Overall summary...",
  "concept_scores": [
    {"concept_name": "Newton's Second Law", "score": 90, "feedback": "..."}
  ],
  "criterion_scores": [
    {"criterion_id": 1, "points_earned": 27, "feedback": "Correctly applied F=ma with consistent units throughout."}
  ]
}"""


def _extract_submission_text(file_bytes: bytes, extension: str) -> str:
    """extract_text_from_file needs a real filepath (it dispatches on extension and,
    for PDFs/images, shells out to PyMuPDF/EasyOCR) - write to a temp file rather
    than duplicating that logic for in-memory bytes."""
    file_type = extension.lstrip(".").lower()
    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    try:
        text, _used_ocr = extract_text_from_file(tmp_path, file_type)
        return text
    finally:
        tmp_path.unlink(missing_ok=True)


@trace_ai_call("assignment-grading")
def grade_submission_text(
    assignment_title: str,
    assignment_description: Optional[str],
    submission_text: str,
    concepts: List[Dict[str, str]],
    course_material: str = "",
    rubric_criteria: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """concepts: [{"name": ..., "description": ...}, ...] from the course's
    concept graph (empty list is fine - grades generally against the brief).

    course_material: retrieved excerpts from what this course actually taught, via
    app/rag/retrieval.py. Optional, and empty is fine. It matters because grading
    without it judges a student against the model's own idea of the subject rather
    than against their course - marking down a correct answer that uses the
    lecturer's notation, or accepting an approach the course never taught.

    rubric_criteria: [{"id": ..., "title": ..., "description": ..., "max_points": ...}, ...],
    the assignment's Rubric (see app/database/models.py Rubric/RubricCriterion) -
    the SAME rubric used for every student's submission in this class. When
    provided, the response additionally scores each criterion out of its
    max_points (see RUBRIC_SYSTEM_PROMPT_SUFFIX) and overall_grade is derived from
    those points rather than a free-floating 0-100 judgment.
    """
    if not submission_text.strip():
        raise ValueError("Submission contains no extractable text - cannot grade an empty document.")

    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to enable "
            "assignment grading. See https://openrouter.ai/keys."
        )

    concept_list = (
        "\n".join(f"- {c['name']}: {c['description']}" for c in concepts)
        if concepts
        else "(This course has no knowledge-graph concepts yet - grade against the assignment brief alone.)"
    )

    material_block = ""
    if course_material.strip():
        material_block = f"""
Excerpts from this course's own teaching material, retrieved as relevant to this
assignment. Grade against what THIS course taught: if the submission uses the
course's notation, definitions or method, credit it even where another convention
exists. Do not penalise a student for not using an approach these excerpts never
introduce, and do not treat these excerpts as a model answer.
{course_material}
"""

    rubric_block = ""
    system_prompt = SYSTEM_PROMPT
    if rubric_criteria:
        system_prompt = SYSTEM_PROMPT + RUBRIC_SYSTEM_PROMPT_SUFFIX
        rubric_lines = "\n".join(
            f"- id={c['id']}: {c['title']} (max {c['max_points']} points) - {c.get('description') or ''}"
            for c in rubric_criteria
        )
        rubric_block = f"\nGrading rubric for this assignment (use these exact criterion ids):\n{rubric_lines}\n"

    user_content = f"""Assignment: {assignment_title}
Instructions: {assignment_description or 'No additional instructions provided.'}

Course concepts this assignment may draw on:
{concept_list}
{material_block}{rubric_block}
Student's submission (extracted text, first 12000 characters):
\"\"\"
{submission_text[:12000]}
\"\"\"
"""

    last_error = None
    for attempt in range(3):
        try:
            started = time.monotonic()
            logger.info("Grading request starting (attempt %d/3, model=%s)", attempt + 1, settings.KIMI_MODEL)
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                # kimi-k2.5 is a reasoning model - excluding reasoning tokens
                # avoids it burning the whole max_tokens budget on internal
                # "thinking" before ever emitting the JSON answer (that failure
                # mode returns message.content=None, which crashed json.loads
                # with a cryptic "not NoneType" error on every retry, not just
                # occasionally - see kimi_service.py for the full explanation).
                max_tokens=3000,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            logger.info("Grading request finished in %.1fs", time.monotonic() - started)
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(
                    f"Model returned empty content (finish_reason={response.choices[0].finish_reason})."
                )
            data = json.loads(raw_content)
            data.setdefault("concept_scores", [])
            data.setdefault("criterion_scores", [])
            if rubric_criteria:
                # Recompute overall_grade from the rubric itself rather than trusting the
                # model's own 0-100 judgment call - a rubric exists precisely so the
                # grade is a deterministic function of the criterion scores, not a
                # second, possibly-inconsistent number the model also happens to emit.
                by_id = {c["id"]: c for c in rubric_criteria}
                total_possible = sum(c["max_points"] for c in rubric_criteria) or 1.0
                total_earned = 0.0
                for cs in data["criterion_scores"]:
                    crit = by_id.get(cs.get("criterion_id"))
                    max_pts = crit["max_points"] if crit else 0.0
                    cs["points_earned"] = max(0.0, min(max_pts, float(cs.get("points_earned", 0))))
                    cs["max_points"] = max_pts
                    cs["title"] = crit["title"] if crit else cs.get("title", "")
                    total_earned += cs["points_earned"]
                data["overall_grade"] = max(0.0, min(100.0, (total_earned / total_possible) * 100))
            else:
                data["overall_grade"] = max(0.0, min(100.0, float(data.get("overall_grade", 0))))
            return data
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Grading call returned malformed JSON on attempt %d/3: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Grading call failed on attempt %d/3: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Grading call failed after 3 attempts: {last_error}")


def format_feedback_text(result: Dict[str, Any]) -> str:
    """Renders the structured grading result into the single Text field
    AssignmentSubmission.feedback actually has - a short overall summary followed
    by one line per rubric criterion (if a rubric was used) or per concept, so a
    student sees exactly where they lost/kept marks."""
    lines = [result.get("overall_feedback", "").strip(), ""]
    for c in result.get("criterion_scores", []):
        lines.append(f"- {c.get('title', 'Criterion')} ({c.get('points_earned', 0)}/{c.get('max_points', 0)}): {c.get('feedback', '')}")
    for c in result.get("concept_scores", []):
        lines.append(f"- {c.get('concept_name', 'Unknown concept')} ({round(c.get('score', 0))}/100): {c.get('feedback', '')}")
    return "\n".join(lines).strip()
