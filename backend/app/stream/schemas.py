# Pydantic model for one card in the unified class stream.
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class StreamItem(BaseModel):
    """One card in the unified class stream - a flattened union of Announcement,
    Assignment, Material, and Meeting fields, tagged with `post_type` so the
    frontend can pick the right renderer/badge. Fields that don't apply to a given
    post_type are simply left None (e.g. `due_date` on a Material)."""
    id: int
    post_type: str  # "announcement" | "assignment" | "material" | "meeting"
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Assignment-specific
    due_date: Optional[datetime] = None
    points: Optional[int] = None

    # Material/Assignment attachment info
    attachment_filename: Optional[str] = None
    external_link: Optional[str] = None

    # Meeting-specific
    meeting_link: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None

    class Config:
        from_attributes = True
