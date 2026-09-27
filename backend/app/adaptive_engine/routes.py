from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Course, User
from app.adaptive_engine.schemas import RevisionPlanOut
from app.adaptive_engine import service as adaptive_service
from app.auth.routes import get_current_user, get_current_student
from app.courses.access import assert_course_access

router = APIRouter(prefix="/courses", tags=["Adaptive Engine"])


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


@router.get("/{course_id}/adaptive/my-plan", response_model=RevisionPlanOut)
def get_my_revision_plan(
    course_id: int,
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """The current student's personalized revision plan for this course - weak
    concepts, foundational ones prioritized, each linked to approved study
    materials if any exist. Empty plan means no weak concepts (or no graded
    evidence yet)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_student)
    return adaptive_service.build_revision_plan(db, current_student.id, course_id, course)


@router.get("/{course_id}/adaptive/student/{student_id}", response_model=RevisionPlanOut)
def get_student_revision_plan(
    course_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Teacher/oversight view of one student's revision plan - the "what is this
    student struggling with, specifically" drill-down the Analytics Dashboard links
    into."""
    course = _get_course_or_404(db, course_id)
    if current_user.role.lower() == "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Use /adaptive/my-plan for your own plan.")
    assert_course_access(db, course, current_user)
    return adaptive_service.build_revision_plan(db, student_id, course_id, course)
