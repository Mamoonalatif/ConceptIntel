import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.database import get_db
from app.models.supervision import ContentStatus, ContentType
from app.models.user import User, UserRole
from app.schemas.supervision import (
    AiContentCreate,
    AiContentResponse,
    AiContentUpdate,
    ApprovalResponse,
    AuditLogResponse,
    ContentDetailResponse,
    RegenerateRequest,
    RejectRequest,
    ReviewActionRequest,
    RevisionResponse,
    SupervisionStatsResponse,
)
from app.services import supervision_service as svc

router = APIRouter(prefix="/supervision", tags=["supervision"])

Reviewer = Annotated[User, Depends(require_roles(UserRole.teacher, UserRole.coordinator, UserRole.admin))]
Student = Annotated[User, Depends(require_roles(UserRole.student))]


def _to_content_response(content) -> AiContentResponse:
    data = svc._serialize_content(content)
    return AiContentResponse(**data)


def _to_detail(content) -> ContentDetailResponse:
    base = _to_content_response(content)
    revisions = [
        RevisionResponse(
            id=r.id,
            content_id=r.content_id,
            version=r.version,
            title=r.title,
            body=json.loads(r.body),
            edited_by_id=r.edited_by_id,
            edited_by_name=r.edited_by_name,
            edit_note=r.edit_note,
            created_at=r.created_at,
        )
        for r in sorted(content.revisions, key=lambda x: x.created_at, reverse=True)
    ]
    approvals = [
        ApprovalResponse.model_validate(a)
        for a in sorted(content.approvals, key=lambda x: x.created_at, reverse=True)
    ]
    return ContentDetailResponse(**base.model_dump(), revisions=revisions, approvals=approvals)


def _ensure_can_access(user: User, content) -> None:
    if user.role == UserRole.teacher and content.teacher_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your content")


@router.get("/stats", response_model=SupervisionStatsResponse)
def supervision_stats(user: Reviewer, db: Annotated[Session, Depends(get_db)]):
    return SupervisionStatsResponse(**svc.get_stats(db, user))


@router.get("/content", response_model=list[AiContentResponse])
def list_content(
    user: Reviewer,
    db: Annotated[Session, Depends(get_db)],
    status_filter: ContentStatus | None = Query(None, alias="status"),
    content_type: ContentType | None = Query(None, alias="type"),
    course_id: str | None = None,
):
    items = svc.list_content_for_reviewer(db, user, status_filter, content_type, course_id)
    return [_to_content_response(item) for item in items]


@router.get("/content/{content_id}", response_model=ContentDetailResponse)
def get_content_detail(content_id: str, user: Reviewer, db: Annotated[Session, Depends(get_db)]):
    content = svc.get_content(db, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    _ensure_can_access(user, content)
    return _to_detail(content)


@router.post("/content", response_model=AiContentResponse, status_code=status.HTTP_201_CREATED)
def create_content(payload: AiContentCreate, user: Reviewer, db: Annotated[Session, Depends(get_db)]):
    if user.role != UserRole.teacher:
        raise HTTPException(status_code=403, detail="Only teachers can create AI content")
    content = svc.create_content(db, user, payload)
    return _to_content_response(content)


@router.put("/content/{content_id}", response_model=AiContentResponse)
def edit_content(
    content_id: str,
    payload: AiContentUpdate,
    user: Reviewer,
    db: Annotated[Session, Depends(get_db)],
):
    content = svc.get_content(db, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    _ensure_can_access(user, content)
    updated = svc.update_content(db, user, content, payload)
    return _to_content_response(updated)


@router.post("/content/{content_id}/approve", response_model=AiContentResponse)
def approve_content(
    content_id: str,
    payload: ReviewActionRequest,
    user: Reviewer,
    db: Annotated[Session, Depends(get_db)],
):
    content = svc.get_content(db, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    _ensure_can_access(user, content)
    updated = svc.approve_content(db, user, content, payload.comment)
    return _to_content_response(updated)


@router.post("/content/{content_id}/reject", response_model=AiContentResponse)
def reject_content(
    content_id: str,
    payload: RejectRequest,
    user: Reviewer,
    db: Annotated[Session, Depends(get_db)],
):
    content = svc.get_content(db, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    _ensure_can_access(user, content)
    updated = svc.reject_content(db, user, content, payload.reason)
    return _to_content_response(updated)


@router.post("/content/{content_id}/regenerate", response_model=AiContentResponse)
def regenerate_content(
    content_id: str,
    payload: RegenerateRequest,
    user: Reviewer,
    db: Annotated[Session, Depends(get_db)],
):
    content = svc.get_content(db, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    _ensure_can_access(user, content)
    updated = svc.regenerate_content(db, user, content, payload.instructions)
    return _to_content_response(updated)


@router.get("/audit-logs", response_model=list[AuditLogResponse])
def audit_logs(user: Reviewer, db: Annotated[Session, Depends(get_db)], limit: int = Query(50, le=200)):
    logs = svc.list_audit_logs(db, user, limit)
    return [
        AuditLogResponse(
            id=log.id,
            actor_id=log.actor_id,
            actor_name=log.actor_name,
            actor_role=log.actor_role,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            details=json.loads(log.details),
            created_at=log.created_at,
        )
        for log in logs
    ]


@router.get("/student/content", response_model=list[AiContentResponse])
def student_approved_content(
    _user: Student,
    db: Annotated[Session, Depends(get_db)],
    course_id: str | None = None,
    content_type: ContentType | None = Query(None, alias="type"),
):
    items = svc.list_approved_for_students(db, course_id, content_type)
    return [_to_content_response(item) for item in items]


@router.post("/seed", status_code=status.HTTP_201_CREATED)
def seed_demo(user: Reviewer, db: Annotated[Session, Depends(get_db)]):
    count = svc.seed_demo_content(db)
    return {"seeded": count}
