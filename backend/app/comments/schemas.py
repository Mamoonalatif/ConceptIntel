# Pydantic models for comments on course posts.
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

# The kinds of post a comment can be attached to.
TargetType = Literal["assignment", "announcement", "material"]


# Payload for a new comment: which post it targets and the text (1-4000 chars).
class CommentCreate(BaseModel):
    target_type: TargetType
    target_id: int
    content: str = Field(min_length=1, max_length=4000)


# Comment returned to clients; is_own tells the UI whether the viewer wrote it.
class CommentResponse(BaseModel):
    id: int
    course_id: int
    target_type: str
    target_id: int
    author_id: int
    author_name: str
    is_own: bool
    content: str
    created_at: datetime

    class Config:
        from_attributes = True
