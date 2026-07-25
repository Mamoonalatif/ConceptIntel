from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    meeting_link: str = Field(min_length=1, max_length=1000)
    scheduled_at: datetime
    duration_minutes: Optional[int] = None


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    meeting_link: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


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
