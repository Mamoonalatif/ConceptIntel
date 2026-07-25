from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Announcement, Assignment, Material, Meeting, Course, User
from app.stream.schemas import StreamItem
from app.auth.routes import get_current_user
from app.courses.access import assert_course_access

router = APIRouter(prefix="/courses", tags=["Class Stream"])


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


@router.get("/{course_id}/stream", response_model=List[StreamItem])
def get_class_stream(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unified, chronological feed merging Announcements + Assignments + Materials +
    Meetings for a course, each tagged with `post_type` - the Google-Classroom-style
    "stream" view. Same visibility rule as the individual per-type endpoints
    (see assert_course_access); this just saves the frontend four round trips."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    items: List[StreamItem] = []

    announcements = db.query(Announcement).filter(Announcement.course_id == course_id).all()
    for a in announcements:
        items.append(StreamItem(
            id=a.id, post_type="announcement", course_id=a.course_id, teacher_id=a.teacher_id,
            teacher_name=a.teacher.full_name if a.teacher else None,
            content=a.content, created_at=a.created_at, updated_at=a.updated_at,
        ))

    assignments = db.query(Assignment).filter(Assignment.course_id == course_id).all()
    for asg in assignments:
        items.append(StreamItem(
            id=asg.id, post_type="assignment", course_id=asg.course_id, teacher_id=asg.teacher_id,
            teacher_name=asg.teacher.full_name if asg.teacher else None,
            title=asg.title, content=asg.description, created_at=asg.created_at, updated_at=asg.updated_at,
            due_date=asg.due_date, points=asg.points, attachment_filename=asg.attachment_filename,
        ))

    materials = db.query(Material).filter(Material.course_id == course_id).all()
    for m in materials:
        items.append(StreamItem(
            id=m.id, post_type="material", course_id=m.course_id, teacher_id=m.teacher_id,
            teacher_name=m.teacher.full_name if m.teacher else None,
            title=m.title, content=m.description, created_at=m.created_at, updated_at=m.updated_at,
            attachment_filename=m.attachment_filename, external_link=m.external_link,
        ))

    meetings = db.query(Meeting).filter(Meeting.course_id == course_id).all()
    for mt in meetings:
        items.append(StreamItem(
            id=mt.id, post_type="meeting", course_id=mt.course_id, teacher_id=mt.teacher_id,
            teacher_name=mt.teacher.full_name if mt.teacher else None,
            title=mt.title, content=mt.description, created_at=mt.created_at, updated_at=mt.updated_at,
            meeting_link=mt.meeting_link, scheduled_at=mt.scheduled_at, duration_minutes=mt.duration_minutes,
        ))

    items.sort(key=lambda i: i.created_at, reverse=True)
    return items
