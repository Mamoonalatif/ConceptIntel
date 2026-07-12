from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.models import Course, CourseCatalog, Enrollment
from app.db.session import get_db
from app.schemas.course_db import CourseCreate, CourseOut, CourseUpdate
from app.services.course_logic import add_months, compute_status, generate_enrollment_code, generate_invite_link

router = APIRouter(prefix="/courses", tags=["course-offerings"])


def _to_out(course: Course, db: Session) -> CourseOut:
    prereq = course.catalog.prerequisite if course.catalog and course.catalog.prerequisite_id else None
    enrolled_count = db.query(Enrollment).filter_by(course_id=course.id).count()
    return CourseOut(
        id=course.id,
        catalog_id=course.catalog_id,
        catalog_name=course.catalog.name,
        catalog_code=course.catalog.code,
        prerequisite_name=prereq.name if prereq else None,
        teacher_id=course.teacher_id,
        teacher_name=course.teacher.name if course.teacher else "Teacher",
        semester=course.semester,
        description=course.description,
        max_students=course.max_students,
        course_start_date=course.course_start_date,
        course_duration_months=course.course_duration_months,
        course_end_date=course.course_end_date,
        enrollment_start_date=course.enrollment_start_date,
        enrollment_end_date=course.enrollment_end_date,
        enrollment_code=course.enrollment_code,
        invite_link=course.invite_link,
        status=compute_status(course.enrollment_start_date, course.enrollment_end_date),
        enrolled_count=enrolled_count,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


@router.get("", response_model=list[CourseOut])
def list_courses(
    teacher_id: Optional[UUID] = Query(default=None, description="Only this teacher's own offerings (GCR-style 'my classes')"),
    catalog_id: Optional[UUID] = Query(default=None, description="Only offerings of this catalog course"),
    db: Session = Depends(get_db),
):
    query = db.query(Course)
    if teacher_id is not None:
        query = query.filter(Course.teacher_id == teacher_id)
    if catalog_id is not None:
        query = query.filter(Course.catalog_id == catalog_id)
    courses = query.order_by(Course.updated_at.desc()).all()
    return [_to_out(c, db) for c in courses]


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: UUID, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    return _to_out(course, db)


def _validate_dates(course_start_date, course_duration_months, enrollment_start_date, enrollment_end_date):
    course_end_date = add_months(course_start_date, course_duration_months)
    if enrollment_end_date <= enrollment_start_date:
        raise HTTPException(400, "Enrollment end date must be after the enrollment start date")
    if enrollment_end_date > course_end_date:
        raise HTTPException(400, "Enrollment end date cannot be after the course end date")
    return course_end_date


@router.post("", response_model=CourseOut)
def create_course(payload: CourseCreate, db: Session = Depends(get_db)):
    catalog_entry = db.get(CourseCatalog, payload.catalog_id)
    if not catalog_entry:
        raise HTTPException(400, "Unknown catalog course")

    course_end_date = _validate_dates(
        payload.course_start_date,
        payload.course_duration_months,
        payload.enrollment_start_date,
        payload.enrollment_end_date,
    )

    code = generate_enrollment_code(catalog_entry.code, payload.semester)
    course = Course(
        **payload.model_dump(),
        course_end_date=course_end_date,
        enrollment_code=code,
        invite_link=generate_invite_link(code),
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return _to_out(course, db)


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: UUID, payload: CourseUpdate, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(course, field, value)

    if "course_start_date" in data or "course_duration_months" in data:
        course.course_end_date = add_months(course.course_start_date, course.course_duration_months)

    if "enrollment_start_date" in data or "enrollment_end_date" in data or "course_start_date" in data or "course_duration_months" in data:
        if course.enrollment_end_date <= course.enrollment_start_date:
            raise HTTPException(400, "Enrollment end date must be after the enrollment start date")
        if course.enrollment_end_date > course.course_end_date:
            raise HTTPException(400, "Enrollment end date cannot be after the course end date")

    db.commit()
    db.refresh(course)
    return _to_out(course, db)


@router.delete("/{course_id}", status_code=204)
def delete_course(course_id: UUID, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    db.delete(course)
    db.commit()
