from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models.supervision import ApprovalAction, ContentStatus, ContentType


class ContentBody(BaseModel):
    summary: str = ""
    questions: list[dict[str, Any]] = Field(default_factory=list)
    instructions: str = ""
    cards: list[dict[str, Any]] = Field(default_factory=list)
    sections: list[dict[str, Any]] = Field(default_factory=list)
    ai_confidence: float = 0.85
    ai_notes: str = ""


class AiContentCreate(BaseModel):
    course_id: str
    course_name: str
    title: str
    content_type: ContentType
    subject: str = "cs"
    concept_tags: list[str] = Field(default_factory=list)
    body: ContentBody


class AiContentUpdate(BaseModel):
    title: str | None = None
    body: ContentBody | None = None
    concept_tags: list[str] | None = None
    edit_note: str | None = None


class ReviewActionRequest(BaseModel):
    comment: str | None = None


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class RegenerateRequest(BaseModel):
    instructions: str | None = None


class AiContentResponse(BaseModel):
    id: str
    course_id: str
    course_name: str
    title: str
    content_type: ContentType
    subject: str
    concept_tags: list[str]
    body: dict[str, Any]
    status: ContentStatus
    version: int
    teacher_id: str
    teacher_name: str
    reviewed_by_id: str | None
    reviewed_by_name: str | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RevisionResponse(BaseModel):
    id: str
    content_id: str
    version: int
    title: str
    body: dict[str, Any]
    edited_by_id: str
    edited_by_name: str
    edit_note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalResponse(BaseModel):
    id: str
    content_id: str
    action: ApprovalAction
    reviewer_id: str
    reviewer_name: str
    reviewer_role: str
    comment: str | None
    previous_status: str
    new_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: str
    actor_id: str
    actor_name: str
    actor_role: str
    action: str
    resource_type: str
    resource_id: str
    details: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentDetailResponse(AiContentResponse):
    revisions: list[RevisionResponse] = Field(default_factory=list)
    approvals: list[ApprovalResponse] = Field(default_factory=list)


class SupervisionStatsResponse(BaseModel):
    pending_review: int
    approved: int
    rejected: int
    total: int
