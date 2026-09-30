# Pydantic models for the course schedule API.
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


# One row of the schedule: a week/session label, optional title and its list of topics.
class ScheduleSessionItem(BaseModel):
    week_label: str
    title: Optional[str] = None
    topics: List[str] = []
    linked_concept_ids: Optional[List[str]] = None


class CourseScheduleResponse(BaseModel):
    """The live schedule - what students and teachers see. No approval gate: a
    generate/edit action writes here directly (see schedule/service.py)."""
    id: int
    course_id: int
    status: str
    generated_by_ai: bool
    sessions: List[ScheduleSessionItem]
    updated_at: datetime


class CourseScheduleUpdate(BaseModel):
    """A teacher's hand-edited schedule, applied straight to the live sessions."""
    sessions: List[ScheduleSessionItem]


class TodayTopicsResponse(BaseModel):
    """What the approved schedule says this course is teaching this week, derived
    from Course.start_date - see schedule/service.py get_today_topics. Null fields
    mean the course either hasn't started yet or the schedule doesn't reach this
    far (e.g. it's already over)."""
    course_id: int
    week_index: Optional[int] = None
    total_weeks: Optional[int] = None
    week_label: Optional[str] = None
    title: Optional[str] = None
    topics: List[str] = []
