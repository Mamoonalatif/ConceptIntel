"""Shared "is this user actually in this course" check - Google-Classroom-style
scoping: viewing a course's content/knowledge graph is not just gated by role, it's
gated by actually being the teacher who owns it, a student enrolled in it, or an
oversight role (admin/coordinator). Without this, any two logged-in users could
view/search/download each other's course material just by guessing course IDs.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.database.models import Course, Enrollment, User

OVERSIGHT_ROLES = ("admin", "program_coordinator", "course_coordinator")
ACTIVE_ENROLLMENT_STATUSES = ("Active", "Completed")


def assert_course_access(db: Session, course: Course, user: User) -> None:
    """Raises 403 unless the user may view this course's content: its teacher, an
    actively-enrolled student, or an oversight role (admin/program/course coordinator)."""
    if user.role.lower() in OVERSIGHT_ROLES:
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
