"""Course schedule/outline preview: a lightweight, teacher-editable week-by-week
breakdown of topics, extracted by AI from the course's uploaded outline file and
shown to students and teachers ahead of the full (Neo4j) concept graph.

Unlike the concept graph, this has NO coordinator-approval gate: a teacher's
generate/edit action writes straight to the live `sessions` students see. A
schedule is one teacher's own section plan, not a shared-catalog artifact, so
there's no "one teacher's edit becomes visible to every other section" risk
that motivates approval elsewhere in this app.
"""
import json
import logging
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import Course, CourseSchedule, ScheduleSession
from app.content_processing.kimi_service import openrouter_payment_error_message
from app.content_processing.pipeline_service import get_course_outline_text

logger = logging.getLogger("conceptintel.schedule")


def _get_client() -> OpenAI:
    if not settings.OPENROUTER_API_KEY or settings.OPENROUTER_API_KEY.startswith("your_"):
        raise RuntimeError("OPENROUTER_API_KEY is not configured - cannot generate a schedule.")
    return OpenAI(api_key=settings.OPENROUTER_API_KEY, base_url=settings.OPENROUTER_BASE_URL)


def _extract_sessions_from_outline(outline_text: str) -> List[Dict[str, Any]]:
    """Single Kimi call - the outline is already capped to ~8000 chars by
    get_course_outline_text and isn't chunked anywhere else in this codebase, so a
    per-chunk loop (as used for concept extraction) isn't needed here."""
    client = _get_client()
    system_prompt = """You are a curriculum planner extracting a week-by-week (or session-by-session)
breakdown of topics from a university course outline/syllabus.

Do NOT invent descriptions, difficulty levels, or prerequisites - just the shallow
week -> topic-names structure, preserving the outline's own wording and order as
closely as possible. If the outline doesn't split cleanly into weeks, use whatever
session/unit/module structure it actually uses for week_label (e.g. "Module 2",
"Session 5"). Every topics list must have at least one entry.

Respond ONLY with valid JSON in this exact format:
{
  "sessions": [
    {"week_label": "Week 1", "title": "Optional session title or null", "topics": ["Topic A", "Topic B"]}
  ]
}"""
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Course outline:\n\n{outline_text}"},
                ],
                response_format={"type": "json_object"},
                temperature=0.15,
                max_tokens=3000,
                timeout=60.0,
                extra_body={"reasoning": {"exclude": True}},
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            data = json.loads(raw_content)
            sessions = data.get("sessions", [])
            if not sessions:
                raise ValueError("Model response had no 'sessions' items")
            return sessions
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Schedule extraction attempt %d/3 failed: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Schedule extraction attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Schedule extraction failed after 3 attempts: {last_error}")


def _get_or_create_schedule(db: Session, course_id: int) -> CourseSchedule:
    schedule = db.query(CourseSchedule).filter(CourseSchedule.course_id == course_id).first()
    if not schedule:
        schedule = CourseSchedule(course_id=course_id, status="Draft")
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
    return schedule


def _sessions_to_json(sessions: List[Dict[str, Any]]) -> str:
    """Normalizes raw session dicts (from Kimi or a teacher's PUT body) into the
    stored JSON shape."""
    normalized = [
        {
            "week_label": s.get("week_label") or f"Week {i + 1}",
            "title": s.get("title"),
            "topics": s.get("topics") or [],
            "linked_concept_ids": s.get("linked_concept_ids"),
        }
        for i, s in enumerate(sessions)
    ]
    return json.dumps(normalized)


def _apply_sessions(db: Session, schedule: CourseSchedule, sessions: List[Dict[str, Any]]) -> None:
    """Replaces the live ScheduleSession rows wholesale - delete-then-insert, same
    re-ingestion pattern as rag/pipeline.py. Writes straight to what students see;
    there is no separate pending/approval state to stage through."""
    for existing in list(schedule.sessions):
        db.delete(existing)
    db.flush()
    for i, item in enumerate(sessions):
        db.add(ScheduleSession(
            schedule_id=schedule.id,
            order_index=i,
            week_label=item.get("week_label") or f"Week {i + 1}",
            title=item.get("title"),
            topics_json=json.dumps(item.get("topics") or []),
            linked_concept_ids_json=(
                json.dumps(item["linked_concept_ids"]) if item.get("linked_concept_ids") else None
            ),
        ))


def generate_schedule_draft(db: Session, course_id: int, teacher_id: int) -> CourseSchedule:
    """Extracts a schedule from the course's uploaded outline and writes it
    straight to the live sessions - no approval step. Raises if no outline has
    been uploaded (same "nothing to extract from" failure mode as the concept
    pipeline)."""
    outline_text = get_course_outline_text(db, course_id)
    if not outline_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This course has no outline uploaded yet - upload one before generating a schedule.",
        )

    schedule = _get_or_create_schedule(db, course_id)
    try:
        sessions = _extract_sessions_from_outline(outline_text)
    except Exception as e:
        schedule.status = "Failed"
        schedule.error_message = str(e)[:2000]
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Schedule generation failed: {e}")

    _apply_sessions(db, schedule, sessions)
    schedule.status = "Approved"
    schedule.generated_by_ai = True
    schedule.submitted_by_id = teacher_id
    schedule.error_message = None
    db.commit()
    db.refresh(schedule)
    return schedule


def submit_schedule_edit(db: Session, course_id: int, teacher_id: int, sessions: List[Dict[str, Any]]) -> CourseSchedule:
    """A teacher's hand-edited schedule (whether starting fresh or refining an
    AI-generated one) - applied straight to the live sessions, no approval step."""
    schedule = _get_or_create_schedule(db, course_id)
    _apply_sessions(db, schedule, sessions)
    schedule.status = "Approved"
    schedule.generated_by_ai = False
    schedule.submitted_by_id = teacher_id
    schedule.error_message = None
    db.commit()
    db.refresh(schedule)
    return schedule


def serialize_sessions(sessions: List[ScheduleSession]) -> List[Dict[str, Any]]:
    return [
        {
            "week_label": s.week_label,
            "title": s.title,
            "topics": json.loads(s.topics_json or "[]"),
            "linked_concept_ids": json.loads(s.linked_concept_ids_json) if s.linked_concept_ids_json else None,
        }
        for s in sessions
    ]


def serialize_schedule(schedule: CourseSchedule) -> Dict[str, Any]:
    return {
        "id": schedule.id,
        "course_id": schedule.course_id,
        "status": schedule.status,
        "generated_by_ai": schedule.generated_by_ai,
        "sessions": serialize_sessions(schedule.sessions),
        "updated_at": schedule.updated_at,
    }


def get_today_topics(db: Session, course_id: int, today: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """What the APPROVED schedule says this course is teaching this week, derived
    purely from Course.start_date + the ordered session list - no separate
    "which week is it" field to keep in sync. Each approved ScheduleSession is
    treated as exactly one calendar week in order, starting the week
    Course.start_date falls in.

    Returns None when there's nothing to say: no approved schedule, no course
    start date, or today falls before the course starts or after its last
    scheduled week (course_id, plus a `week_index`/`total_weeks` pair so a caller
    can distinguish "not started yet" context from "schedule doesn't reach this
    far" if it wants to, though both currently just mean "nothing to show").
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course or not course.start_date:
        return None

    schedule = db.query(CourseSchedule).filter(CourseSchedule.course_id == course_id).first()
    if not schedule or not schedule.sessions:
        return None

    today = today or date.today()
    if today < course.start_date:
        return None

    week_index = (today - course.start_date).days // 7
    sessions = schedule.sessions  # already ordered by order_index, see the model's relationship
    if week_index >= len(sessions):
        return None

    current = sessions[week_index]
    return {
        "course_id": course_id,
        "week_index": week_index,
        "total_weeks": len(sessions),
        "week_label": current.week_label,
        "title": current.title,
        "topics": json.loads(current.topics_json or "[]"),
    }
