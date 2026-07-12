from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import Course, Enrollment
from app.db.session import get_db
from app.schemas.course_db import EnrollmentOut, EnrollRequest
from app.services.course_logic import compute_status

router = APIRouter(prefix="/enrollments", tags=["enrollments"])


@router.post("/join", response_model=EnrollmentOut)
def join_course(payload: EnrollRequest, db: Session = Depends(get_db)):
    course = (
        db.query(Course)
        .filter(Course.enrollment_code.ilike(payload.code.strip()))
        .first()
    )
    if not course:
        raise HTTPException(404, "not_found")

    status = compute_status(course.enrollment_start_date, course.enrollment_end_date)
    if status != "open":
        raise HTTPException(400, "not_open")

    existing = (
        db.query(Enrollment)
        .filter_by(course_id=course.id, student_id=payload.student_id)
        .first()
    )
    if existing:
        raise HTTPException(400, "already_enrolled")

    if course.max_students is not None:
        count = db.query(Enrollment).filter_by(course_id=course.id).count()
        if count >= course.max_students:
            raise HTTPException(400, "full")

    enrollment = Enrollment(course_id=course.id, student_id=payload.student_id)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return enrollment


@router.get("/course/{course_id}", response_model=list[EnrollmentOut])
def list_enrollments(course_id: UUID, db: Session = Depends(get_db)):
    return db.query(Enrollment).filter_by(course_id=course_id).all()
