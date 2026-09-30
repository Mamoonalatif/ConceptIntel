# Pydantic models for course announcements.
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# Payload for posting an announcement (1-5000 chars).
class AnnouncementCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


# Payload for editing an announcement's text.
class AnnouncementUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


# Announcement returned to clients, including the teacher's name.
class AnnouncementResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    content: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
