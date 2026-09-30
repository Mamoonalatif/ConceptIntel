# Pydantic model for one entry in the aggregated calendar.
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CalendarEvent(BaseModel):
    """One entry in a user's aggregated calendar - either an Assignment due date or
    a Meeting's scheduled time, across every course the user has a stake in (a
    student's active enrollments, or a teacher's own taught courses). Flattened,
    Google-Classroom-Calendar-style, the same way StreamItem flattens the class
    stream - fields that don't apply to a given `type` are simply left None."""
    id: int
    type: str  # "assignment" | "meeting"
    title: str
    course_id: int
    course_name: str
    date: datetime
    points: Optional[int] = None
    meeting_link: Optional[str] = None

    class Config:
        from_attributes = True
