# Meeting endpoints: teachers post/edit/delete live-session links for a course; course members list them.
import threading
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db, SessionLocal
from app.database.models import Meeting, Course, User
from app.meetings.schemas import MeetingCreate, MeetingUpdate, MeetingResponse
from app.auth.routes import get_current_user, get_current_teacher
from app.courses.access import assert_course_access
from app.notifications.service import notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary

router = APIRouter(prefix="/courses", tags=["Meetings"])


# Converts a Meeting ORM row into the API response model (adds teacher name).
def _to_response(m: Meeting) -> MeetingResponse:
    return MeetingResponse(
        id=m.id,
        course_id=m.course_id,
        teacher_id=m.teacher_id,
        teacher_name=m.teacher.full_name if m.teacher else None,
        title=m.title,
        description=m.description,
        meeting_link=m.meeting_link,
        scheduled_at=m.scheduled_at,
        duration_minutes=m.duration_minutes,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


# Fetches a course by ID or raises 404.
def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _notify_meeting_posted_background(course_id: int, meeting_id: int) -> None:
    """Runs off the request thread - see the call site in create_meeting for
    why. Split into two short-lived DB sessions around the LLM call rather
    than one held open across it - see the equivalent function in
    app/assignments/routes.py for why that matters for the whole app's
    connection pool, not just this one endpoint."""
    bg_db = SessionLocal()
    try:
        course = bg_db.query(Course).filter(Course.id == course_id).first()
        meeting = bg_db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not course or not meeting:
            return
        when_str = meeting.scheduled_at.strftime('%b %d, %Y %I:%M %p')
        content = f"Scheduled in {course.name} for {when_str}. {meeting.description or ''}".strip()
        title = meeting.title
    finally:
        bg_db.close()

    try:
        summary = generate_posting_summary("meeting", title, content)
        bg_db = SessionLocal()
        try:
            notify_course_students(
                bg_db, course_id, NotificationType.MEETING_POSTED,
                title=f"New meeting: {title}",
                message=summary,
                link=f"/course/{course_id}",
            )
        finally:
            bg_db.close()
    except Exception as e:
        print(f"Warning: failed to create meeting notifications: {str(e)}")


# GET /courses/{id}/meetings - newest-first list for users with course access.
@router.get("/{course_id}/meetings", response_model=List[MeetingResponse])
def list_meetings(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Newest-first list of a course's posted lecture/live-session links - same
    visibility rule as the rest of the class stream content."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    meetings = (
        db.query(Meeting)
        .filter(Meeting.course_id == course_id)
        .order_by(Meeting.created_at.desc())
        .all()
    )
    return [_to_response(m) for m in meetings]


# POST /courses/{id}/meetings - the course teacher posts a meeting; students are notified in a
# background thread so the request returns quickly.
@router.post("/{course_id}/meetings", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
def create_meeting(
    course_id: int,
    payload: MeetingCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")

    meeting = Meeting(
        course_id=course_id, teacher_id=current_teacher.id, title=payload.title, description=payload.description,
        meeting_link=payload.meeting_link, scheduled_at=payload.scheduled_at, duration_minutes=payload.duration_minutes,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    # Backgrounded - see _notify_meeting_posted_background docstring.
    threading.Thread(target=_notify_meeting_posted_background, args=(course_id, meeting.id), daemon=True).start()

    return _to_response(meeting)


# Loads a meeting in this course and checks the caller posted it (404/403 otherwise).
def _get_owned_meeting(db: Session, course_id: int, meeting_id: int, teacher_id: int) -> Meeting:
    meeting = (
        db.query(Meeting)
        .filter(Meeting.id == meeting_id, Meeting.course_id == course_id)
        .first()
    )
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    if meeting.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own meetings.")
    return meeting


# PATCH .../meetings/{id} - owner edits any supplied field.
@router.patch("/{course_id}/meetings/{meeting_id}", response_model=MeetingResponse)
def update_meeting(
    course_id: int,
    meeting_id: int,
    payload: MeetingUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    meeting = _get_owned_meeting(db, course_id, meeting_id, current_teacher.id)
    if payload.title is not None:
        meeting.title = payload.title
    if payload.description is not None:
        meeting.description = payload.description
    if payload.meeting_link is not None:
        meeting.meeting_link = payload.meeting_link
    if payload.scheduled_at is not None:
        meeting.scheduled_at = payload.scheduled_at
    if payload.duration_minutes is not None:
        meeting.duration_minutes = payload.duration_minutes
    meeting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(meeting)
    return _to_response(meeting)


# DELETE .../meetings/{id} - owner deletes the meeting.
@router.delete("/{course_id}/meetings/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(
    course_id: int,
    meeting_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    meeting = _get_owned_meeting(db, course_id, meeting_id, current_teacher.id)
    db.delete(meeting)
    db.commit()
    return None
