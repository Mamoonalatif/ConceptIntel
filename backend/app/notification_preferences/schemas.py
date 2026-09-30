# Pydantic models for a user's notification on/off switches by category.
from typing import Optional
from pydantic import BaseModel


# The user's current switches (one boolean per notification category).
class NotificationPreferenceResponse(BaseModel):
    course_posts: bool
    assignment_updates: bool
    grading_updates: bool
    enrollment_updates: bool
    content_processing_updates: bool
    system_updates: bool

    class Config:
        from_attributes = True


class NotificationPreferenceUpdate(BaseModel):
    """Partial update - any subset of the boolean fields may be sent."""
    course_posts: Optional[bool] = None
    assignment_updates: Optional[bool] = None
    grading_updates: Optional[bool] = None
    enrollment_updates: Optional[bool] = None
    content_processing_updates: Optional[bool] = None
    system_updates: Optional[bool] = None
