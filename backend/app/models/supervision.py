import enum
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ContentType(str, enum.Enum):
    quiz = "quiz"
    assignment = "assignment"
    flashcard = "flashcard"
    study_guide = "study_guide"
    lecture_note = "lecture_note"
    concept_map = "concept_map"


class ContentStatus(str, enum.Enum):
    pending_review = "pending_review"
    approved = "approved"
    rejected = "rejected"
    draft = "draft"


class ApprovalAction(str, enum.Enum):
    approved = "approved"
    rejected = "rejected"
    regenerated = "regenerated"
    edited = "edited"


class AiContent(Base):
    __tablename__ = "ai_content"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[ContentType] = mapped_column(Enum(ContentType), nullable=False)
    subject: Mapped[str] = mapped_column(String(64), nullable=False, default="cs")
    concept_tags: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[ContentStatus] = mapped_column(
        Enum(ContentStatus), nullable=False, default=ContentStatus.pending_review
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    teacher_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    teacher_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reviewed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    revisions: Mapped[list["ContentRevision"]] = relationship(back_populates="content", cascade="all, delete-orphan")
    approvals: Mapped[list["ApprovalRecord"]] = relationship(back_populates="content", cascade="all, delete-orphan")

    def get_body(self) -> dict[str, Any]:
        return json.loads(self.body)

    def get_concept_tags(self) -> list[str]:
        return json.loads(self.concept_tags)


class ContentRevision(Base):
    __tablename__ = "content_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    content_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_content.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_by_id: Mapped[str] = mapped_column(String(36), nullable=False)
    edited_by_name: Mapped[str] = mapped_column(String(255), nullable=False)
    edit_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    content: Mapped["AiContent"] = relationship(back_populates="revisions")


class ApprovalRecord(Base):
    __tablename__ = "approval_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    content_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_content.id"), nullable=False, index=True)
    action: Mapped[ApprovalAction] = mapped_column(Enum(ApprovalAction), nullable=False)
    reviewer_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reviewer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reviewer_role: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_status: Mapped[str] = mapped_column(String(32), nullable=False)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    content: Mapped["AiContent"] = relationship(back_populates="approvals")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
