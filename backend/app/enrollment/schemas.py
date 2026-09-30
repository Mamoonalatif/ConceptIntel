# Pydantic models for enrollment requests and responses.
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.courses.schemas import CourseResponse

# Body of the join request: just the course's enrollment code.
class EnrollmentJoinRequest(BaseModel):
    enrollment_code: str

# Result of a successful join, including the course name/code for the UI.
class EnrollmentResponse(BaseModel):
    id: int
    student_id: int
    course_id: int
    status: str
    enrolled_at: datetime
    progress: float
    last_accessed: Optional[datetime] = None
    # Populated by the route from the joined Course so the frontend can render
    # "Successfully enrolled in {course_name} ({course_code})." without an extra round trip.
    course_name: Optional[str] = None
    course_code: Optional[str] = None

    class Config:
        from_attributes = True

# An enrollment with its full nested course, used for the "my courses" list.
class EnrollmentDetailResponse(BaseModel):
    id: int
    status: str
    enrolled_at: datetime
    progress: float
    last_accessed: Optional[datetime] = None
    course: CourseResponse

    class Config:
        from_attributes = True
