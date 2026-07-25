from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

TargetType = Literal["assignment", "announcement", "material"]


class CommentCreate(BaseModel):
    target_type: TargetType
    target_id: int
    content: str = Field(min_length=1, max_length=4000)


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
