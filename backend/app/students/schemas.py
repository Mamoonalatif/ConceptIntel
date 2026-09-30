# Pydantic model for one entry in the student's to-do list.
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# A single assignment as shown in the to-do view, with submission status and grade.
class TodoItem(BaseModel):
    assignment_id: int
    course_id: int
    course_name: str
    title: str
    due_date: Optional[datetime] = None
    points: Optional[int] = None
    # "missing" | "submitted" | "late"
    status: str
    submitted_at: Optional[datetime] = None
    grade: Optional[float] = None

    class Config:
        from_attributes = True
