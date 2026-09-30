# Enrollment endpoints: students join courses by code, list their courses, check prerequisites,
# and drop; teachers list the students enrolled in their courses.
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from typing import List
from app.database.connection import get_db
from app.database.models import Course, Enrollment, User
from app.enrollment.schemas import EnrollmentJoinRequest, EnrollmentResponse, EnrollmentDetailResponse
from app.enrollment.services import join_course_service, EnrollmentError
from app.auth.routes import get_current_student, get_current_teacher, get_current_user
from app.notifications.service import create_notification
from app.notifications.types import NotificationType
from app.core.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/enrollment", tags=["Enrollments"])

# The enrollment code is effectively a bearer credential (see
# courses/routes.py generate_unique_code) - without a limit here, a caller could
# script through the whole 8-character keyspace against this endpoint. 10 tries
# per 5 minutes is generous for a real student (who has the code in an email/
# announcement and mistypes at most a couple of times) but useless for guessing.
# Max join attempts per student within the window below.
JOIN_RATE_LIMIT = 10
JOIN_RATE_LIMIT_WINDOW_SECONDS = 300


# POST /enrollment/join - student joins a course with an enrollment code (see docstring).
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
    enforce_rate_limit("enrollment-join", str(current_student.id), JOIN_RATE_LIMIT, JOIN_RATE_LIMIT_WINDOW_SECONDS)
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

    # Best-effort: a notification failure must never turn a successful enrollment
    # into an error response for the student.
    try:
        course = enrollment.course
        if course:
            create_notification(
                db, current_student.id, NotificationType.ENROLLMENT_JOINED,
                title="Enrolled successfully",
                message=f"You joined {course.name} ({course.code or course.semester}).",
                link=f"/course/{course.id}",
            )
            create_notification(
                db, course.teacher_id, NotificationType.ENROLLMENT_NEW_STUDENT,
                title="New student enrolled",
                message=f"{current_student.full_name} joined {course.name}.",
                link=f"/course/{course.id}",
            )
    except Exception as e:
        print(f"Warning: failed to create enrollment notifications: {str(e)}")

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


# GET /enrollment/my-courses - the student's enrollments with course details.
@router.get("/my-courses", response_model=List[EnrollmentDetailResponse])
def get_student_courses(
    db: Session = Depends(get_db), 
    current_student: User = Depends(get_current_student)
):
    """Retrieve courses the current student is enrolled in."""
    return db.query(Enrollment).filter(Enrollment.student_id == current_student.id).all()


# GET /enrollment/check-prerequisite/{id} - tells the student if they finished the course's prerequisite.
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


# GET /enrollment/teacher/course/{id}/students - roster of a course for its owning teacher.
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


# DELETE /enrollment/{id} - the student (or course teacher) drops an enrollment; soft delete via status.
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
        
    # Check permissions: must be the student enrolled OR the teacher of the course.
    # The student branch short-circuits before touching `course` - a student
    # dropping their own enrollment must still work even if the course itself was
    # since deleted, which would otherwise leave `course` None here.
    if enrollment.student_id != current_user.id:
        course = db.query(Course).filter(Course.id == enrollment.course_id).first()
        if not course or course.teacher_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to drop this course."
            )
        
    # Instead of deleting, we change status to Dropped
    enrollment.status = "Dropped"
    db.commit()
    return None
