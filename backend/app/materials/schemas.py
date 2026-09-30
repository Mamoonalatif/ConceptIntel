# Pydantic models for course materials (teacher-posted resources).
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# Partial edit payload for a material; only supplied fields change.
class MaterialUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    external_link: Optional[str] = None


# Material returned to clients, including the teacher's name.
class MaterialResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    attachment_filename: Optional[str] = None
    external_link: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
