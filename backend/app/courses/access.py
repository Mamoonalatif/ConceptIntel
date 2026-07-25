"""Shared "is this user actually in this course" check - Google-Classroom-style
scoping: viewing a course's content/knowledge graph is not just gated by role, it's
gated by actually being the teacher who owns it, a student enrolled in it, or an
oversight role (admin/coordinator). Without this, any two logged-in users could
view/search/download each other's course material just by guessing course IDs.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.database.models import Course, Enrollment, User

ACTIVE_ENROLLMENT_STATUSES = ("Active", "Completed")


def assert_course_access(db: Session, course: Course, user: User) -> None:
    """Raises 403 unless the user may view this course's content: its teacher, an
    actively-enrolled student, or an oversight role/authority (admin, or a teacher
    holding program/course coordinator authority - these are additive flags, not a
    separate role, see database/models.py)."""
    if user.role.lower() == "admin" or user.is_program_coordinator or user.is_course_coordinator:
        return
    if course.teacher_id == user.id:
        return
    if user.role.lower() == "student":
        enrolled = (
            db.query(Enrollment)
            .filter(
                Enrollment.course_id == course.id,
                Enrollment.student_id == user.id,
                Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES),
            )
            .first()
        )
        if enrolled:
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You don't have access to this course's content."
    )
