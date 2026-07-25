from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class AnnouncementCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class AnnouncementUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


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
