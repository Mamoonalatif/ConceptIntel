# Pydantic models for course meetings (live-session links).
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# Payload for posting a meeting; title and link are required with length limits.
class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    meeting_link: str = Field(min_length=1, max_length=1000)
    scheduled_at: datetime
    duration_minutes: Optional[int] = None


# Partial edit payload; only supplied fields change.
class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    meeting_link: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


# Meeting returned to clients, including the teacher's name.
class MeetingResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    meeting_link: str
    scheduled_at: datetime
    duration_minutes: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
