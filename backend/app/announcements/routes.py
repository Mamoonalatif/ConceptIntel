from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Announcement, Course, User
from app.announcements.schemas import AnnouncementCreate, AnnouncementUpdate, AnnouncementResponse
from app.auth.routes import get_current_user, get_current_teacher
from app.courses.access import assert_course_access
from app.notifications.service import notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary

router = APIRouter(prefix="/courses", tags=["Class Stream"])


def _to_response(a: Announcement) -> AnnouncementResponse:
    return AnnouncementResponse(
        id=a.id,
        course_id=a.course_id,
        teacher_id=a.teacher_id,
        teacher_name=a.teacher.full_name if a.teacher else None,
        content=a.content,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


@router.get("/{course_id}/announcements", response_model=List[AnnouncementResponse])
def list_announcements(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Newest-first class stream for a course - same visibility rule as its content
    (teacher who owns it, actively enrolled students, or oversight roles)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    announcements = (
        db.query(Announcement)
        .filter(Announcement.course_id == course_id)
        .order_by(Announcement.created_at.desc())
        .all()
    )
    return [_to_response(a) for a in announcements]


@router.post("/{course_id}/announcements", response_model=AnnouncementResponse, status_code=status.HTTP_201_CREATED)
def create_announcement(
    course_id: int,
    payload: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")

    announcement = Announcement(course_id=course_id, teacher_id=current_teacher.id, content=payload.content)
    db.add(announcement)
    db.commit()
    db.refresh(announcement)

    try:
        summary = generate_posting_summary("announcement", course.name, payload.content)
        notify_course_students(
            db, course_id, NotificationType.ANNOUNCEMENT_POSTED,
            title=f"New announcement in {course.name}",
            message=summary,
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to create announcement notifications: {str(e)}")

    return _to_response(announcement)


def _get_owned_announcement(db: Session, course_id: int, announcement_id: int, teacher_id: int) -> Announcement:
    announcement = (
        db.query(Announcement)
        .filter(Announcement.id == announcement_id, Announcement.course_id == course_id)
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    if announcement.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own announcements.")
    return announcement


@router.patch("/{course_id}/announcements/{announcement_id}", response_model=AnnouncementResponse)
def update_announcement(
    course_id: int,
    announcement_id: int,
    payload: AnnouncementUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    announcement = _get_owned_announcement(db, course_id, announcement_id, current_teacher.id)
    announcement.content = payload.content
    announcement.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(announcement)
    return _to_response(announcement)


@router.delete("/{course_id}/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    course_id: int,
    announcement_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    announcement = _get_owned_announcement(db, course_id, announcement_id, current_teacher.id)
    db.delete(announcement)
    db.commit()
    return None
