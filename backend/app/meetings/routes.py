from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Meeting, Course, User
from app.meetings.schemas import MeetingCreate, MeetingUpdate, MeetingResponse
from app.auth.routes import get_current_user, get_current_teacher
from app.courses.access import assert_course_access
from app.notifications.service import notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary

router = APIRouter(prefix="/courses", tags=["Meetings"])


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


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


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

    try:
        when_str = payload.scheduled_at.strftime('%b %d, %Y %I:%M %p')
        content = f"Scheduled in {course.name} for {when_str}. {payload.description or ''}".strip()
        summary = generate_posting_summary("meeting", payload.title, content)
        notify_course_students(
            db, course_id, NotificationType.MEETING_POSTED,
            title=f"New meeting: {payload.title}",
            message=summary,
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to create meeting notifications: {str(e)}")

    return _to_response(meeting)


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
