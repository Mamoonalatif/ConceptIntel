from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from typing import List
from app.database.connection import get_db
from app.database.models import Course, Enrollment, User
from app.enrollment.schemas import EnrollmentJoinRequest, EnrollmentResponse, EnrollmentDetailResponse
from app.enrollment.services import join_course_service, EnrollmentError
from app.auth.routes import get_current_student, get_current_teacher, get_current_user

router = APIRouter(prefix="/enrollment", tags=["Enrollments"])


@router.post("/join", response_model=EnrollmentResponse)
def join_course(
    req: EnrollmentJoinRequest,
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student)
):
    """Validates and processes a student's enrollment-code join request. All
    validation/business rules live in enrollment/services.py - this route is just
    the HTTP translation layer (structured errors -> HTTPException, unexpected
    DB failures -> a clean 503 instead of a leaked stack trace)."""
    try:
        enrollment = join_course_service(db, current_student, req.enrollment_code)
    except EnrollmentError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to enroll. Please try again later."
        )

    return EnrollmentResponse(
        id=enrollment.id,
        student_id=enrollment.student_id,
        course_id=enrollment.course_id,
        status=enrollment.status,
        enrolled_at=enrollment.enrolled_at,
        progress=enrollment.progress,
        last_accessed=enrollment.last_accessed,
        course_name=enrollment.course.name if enrollment.course else None,
        course_code=enrollment.course.code if enrollment.course else None,
    )


@router.get("/my-courses", response_model=List[EnrollmentDetailResponse])
def get_student_courses(
    db: Session = Depends(get_db), 
    current_student: User = Depends(get_current_student)
):
    """Retrieve courses the current student is enrolled in."""
    return db.query(Enrollment).filter(Enrollment.student_id == current_student.id).all()


@router.get("/check-prerequisite/{course_id}")
def check_prerequisites(
    course_id: int, 
    db: Session = Depends(get_db), 
    current_student: User = Depends(get_current_student)
):
    """Verify if the student meets the prerequisites for a specific course ID."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    
    if not course.prerequisite_course_id:
        return {"satisfied": True, "reason": "No prerequisite required."}
        
    prereq_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == current_student.id,
        Enrollment.course_id == course.prerequisite_course_id,
        Enrollment.status == "Completed"
    ).first()
    
    if prereq_enrollment:
        return {"satisfied": True, "reason": "Prerequisite completed."}
    
    prereq_course = db.query(Course).filter(Course.id == course.prerequisite_course_id).first()
    return {
        "satisfied": False, 
        "reason": f"Prerequisite course '{prereq_course.name}' is not completed."
    }


@router.get("/teacher/course/{course_id}/students")
def get_enrolled_students(
    course_id: int, 
    db: Session = Depends(get_db), 
    current_teacher: User = Depends(get_current_teacher)
):
    """Retrieve list of students enrolled in a teacher's course."""
    # Ensure teacher owns the course
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )
        
    enrollments = db.query(Enrollment).filter(Enrollment.course_id == course_id).all()
    students_list = []
    for enr in enrollments:
        student = db.query(User).filter(User.id == enr.student_id).first()
        if student:
            students_list.append({
                "enrollment_id": enr.id,
                "student_id": student.id,
                "full_name": student.full_name,
                "email": student.email,
                "status": enr.status,
                "enrolled_at": enr.enrolled_at,
                "progress": enr.progress
            })
    return students_list


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def drop_course(
    id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Drop or delete an enrollment record."""
    enrollment = db.query(Enrollment).filter(Enrollment.id == id).first()
    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment record not found"
        )
        
    # Check permissions: must be the student enrolled OR the teacher of the course
    course = db.query(Course).filter(Course.id == enrollment.course_id).first()
    if enrollment.student_id != current_user.id and course.teacher_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to drop this course."
        )
        
    # Instead of deleting, we change status to Dropped
    enrollment.status = "Dropped"
    db.commit()
    return None
