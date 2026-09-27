from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Course, Enrollment, User
from app.auth.routes import get_current_user, get_current_student
from app.courses.access import assert_course_access, ACTIVE_ENROLLMENT_STATUSES
from app.mastery import service as mastery_service
from app.mastery.schemas import MyMasterySummary, ConceptMasteryOut

router = APIRouter(prefix="/mastery", tags=["Mastery"])


@router.get("/my-progress", response_model=list[MyMasterySummary])
def get_my_mastery(
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """A student's own real per-concept mastery, one entry per enrolled course.
    Concepts with zero graded evidence yet simply don't appear - this reports what
    exists, not a fabricated default."""
    enrollments = (
        db.query(Enrollment)
        .filter(Enrollment.student_id == current_student.id, Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES))
        .all()
    )
    results = []
    for enr in enrollments:
        rows = mastery_service.get_student_mastery(db, current_student.id, enr.course_id)
        overall = mastery_service.get_course_average_progress(db, current_student.id, enr.course_id)
        results.append(MyMasterySummary(
            course_id=enr.course_id,
            course_name=enr.course.name if enr.course else "Unknown",
            overall_progress=overall,
            concepts=[ConceptMasteryOut.model_validate(r) for r in rows],
        ))
    return results


@router.get("/course/{course_id}/student/{student_id}", response_model=list[ConceptMasteryOut])
def get_student_mastery_for_teacher(
    course_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A teacher/coordinator/admin view of one student's per-concept mastery within
    a course they have access to - the data source for the Adaptive Engine's
    "what's this student struggling with" view and the Analytics Dashboard's
    per-student drill-down."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if current_user.role.lower() == "student" and current_user.id != student_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view another student's mastery.")
    if current_user.role.lower() != "student":
        assert_course_access(db, course, current_user)

    rows = mastery_service.get_student_mastery(db, student_id, course_id)
    return [ConceptMasteryOut.model_validate(r) for r in rows]
