from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SubmissionSummary(BaseModel):
    id: int
    file_filename: str
    submitted_at: datetime
    is_late: bool
    grade: Optional[float] = None
    feedback: Optional[str] = None

    class Config:
        from_attributes = True


class AssignmentResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    points: Optional[int] = None
    attachment_filename: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Populated only for the requesting student - their own submission, if any.
    my_submission: Optional[SubmissionSummary] = None
    # Populated only for the teacher/oversight roles - count of student submissions.
    submission_count: Optional[int] = None

    class Config:
        from_attributes = True


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    points: Optional[int] = None


class SubmissionResponse(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    file_filename: str
    submitted_at: datetime
    is_late: bool
    grade: Optional[float] = None
    feedback: Optional[str] = None

    class Config:
        from_attributes = True
