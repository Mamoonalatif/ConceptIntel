import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.supervision import (
    AiContent,
    ApprovalAction,
    ApprovalRecord,
    AuditLog,
    ContentRevision,
    ContentStatus,
    ContentType,
)
from app.models.user import User, UserRole
from app.schemas.supervision import AiContentCreate, AiContentUpdate, ContentBody


def _new_id() -> str:
    return str(uuid4())


def _log_action(
    db: Session,
    actor: User,
    action: str,
    resource_type: str,
    resource_id: str,
    details: dict[str, Any],
) -> None:
    db.add(
        AuditLog(
            id=_new_id(),
            actor_id=actor.id,
            actor_name=actor.full_name,
            actor_role=actor.role.value,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=json.dumps(details),
        )
    )


def _record_approval(
    db: Session,
    content: AiContent,
    actor: User,
    action: ApprovalAction,
    previous_status: ContentStatus,
    new_status: ContentStatus,
    comment: str | None = None,
) -> ApprovalRecord:
    record = ApprovalRecord(
        id=_new_id(),
        content_id=content.id,
        action=action,
        reviewer_id=actor.id,
        reviewer_name=actor.full_name,
        reviewer_role=actor.role.value,
        comment=comment,
        previous_status=previous_status.value,
        new_status=new_status.value,
    )
    db.add(record)
    return record


def _serialize_content(content: AiContent) -> dict[str, Any]:
    return {
        "id": content.id,
        "course_id": content.course_id,
        "course_name": content.course_name,
        "title": content.title,
        "content_type": content.content_type,
        "subject": content.subject,
        "concept_tags": content.get_concept_tags(),
        "body": content.get_body(),
        "status": content.status,
        "version": content.version,
        "teacher_id": content.teacher_id,
        "teacher_name": content.teacher_name,
        "reviewed_by_id": content.reviewed_by_id,
        "reviewed_by_name": content.reviewed_by_name,
        "rejection_reason": content.rejection_reason,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
    }


def list_content_for_reviewer(
    db: Session,
    user: User,
    status: ContentStatus | None = None,
    content_type: ContentType | None = None,
    course_id: str | None = None,
) -> list[AiContent]:
    query = db.query(AiContent)
    if user.role == UserRole.teacher:
        query = query.filter(AiContent.teacher_id == user.id)
    if status:
        query = query.filter(AiContent.status == status)
    if content_type:
        query = query.filter(AiContent.content_type == content_type)
    if course_id:
        query = query.filter(AiContent.course_id == course_id)
    return query.order_by(AiContent.updated_at.desc()).all()


def list_approved_for_students(
    db: Session,
    course_id: str | None = None,
    content_type: ContentType | None = None,
) -> list[AiContent]:
    query = db.query(AiContent).filter(AiContent.status == ContentStatus.approved)
    if course_id:
        query = query.filter(AiContent.course_id == course_id)
    if content_type:
        query = query.filter(AiContent.content_type == content_type)
    return query.order_by(AiContent.updated_at.desc()).all()


def get_content(db: Session, content_id: str) -> AiContent | None:
    return db.query(AiContent).filter(AiContent.id == content_id).first()


def get_stats(db: Session, user: User) -> dict[str, int]:
    items = list_content_for_reviewer(db, user)
    return {
        "pending_review": sum(1 for i in items if i.status == ContentStatus.pending_review),
        "approved": sum(1 for i in items if i.status == ContentStatus.approved),
        "rejected": sum(1 for i in items if i.status == ContentStatus.rejected),
        "total": len(items),
    }


def create_content(db: Session, user: User, payload: AiContentCreate) -> AiContent:
    body = payload.body.model_dump()
    content = AiContent(
        id=_new_id(),
        course_id=payload.course_id,
        course_name=payload.course_name,
        title=payload.title,
        content_type=payload.content_type,
        subject=payload.subject,
        concept_tags=json.dumps(payload.concept_tags),
        body=json.dumps(body),
        status=ContentStatus.pending_review,
        version=1,
        teacher_id=user.id,
        teacher_name=user.full_name,
    )
    db.add(content)
    _log_action(db, user, "content_created", "ai_content", content.id, {"title": content.title})
    db.commit()
    db.refresh(content)
    return content


def update_content(db: Session, user: User, content: AiContent, payload: AiContentUpdate) -> AiContent:
    previous_status = content.status
    previous_body = content.body
    previous_title = content.title

    if payload.title:
        content.title = payload.title
    if payload.concept_tags is not None:
        content.concept_tags = json.dumps(payload.concept_tags)
    if payload.body:
        content.body = json.dumps(payload.body.model_dump())

    content.version += 1
    content.status = ContentStatus.pending_review
    content.reviewed_by_id = None
    content.reviewed_by_name = None
    content.rejection_reason = None
    content.updated_at = datetime.now(timezone.utc)

    db.add(
        ContentRevision(
            id=_new_id(),
            content_id=content.id,
            version=content.version,
            title=previous_title,
            body=previous_body,
            edited_by_id=user.id,
            edited_by_name=user.full_name,
            edit_note=payload.edit_note,
        )
    )
    _record_approval(
        db,
        content,
        user,
        ApprovalAction.edited,
        previous_status,
        ContentStatus.pending_review,
        payload.edit_note,
    )
    _log_action(
        db,
        user,
        "content_edited",
        "ai_content",
        content.id,
        {"version": content.version, "edit_note": payload.edit_note},
    )
    db.commit()
    db.refresh(content)
    return content


def approve_content(db: Session, user: User, content: AiContent, comment: str | None) -> AiContent:
    previous = content.status
    content.status = ContentStatus.approved
    content.reviewed_by_id = user.id
    content.reviewed_by_name = user.full_name
    content.rejection_reason = None
    content.updated_at = datetime.now(timezone.utc)
    _record_approval(db, content, user, ApprovalAction.approved, previous, ContentStatus.approved, comment)
    _log_action(db, user, "content_approved", "ai_content", content.id, {"comment": comment})
    db.commit()
    db.refresh(content)
    return content


def reject_content(db: Session, user: User, content: AiContent, reason: str) -> AiContent:
    previous = content.status
    content.status = ContentStatus.rejected
    content.reviewed_by_id = user.id
    content.reviewed_by_name = user.full_name
    content.rejection_reason = reason
    content.updated_at = datetime.now(timezone.utc)
    _record_approval(db, content, user, ApprovalAction.rejected, previous, ContentStatus.rejected, reason)
    _log_action(db, user, "content_rejected", "ai_content", content.id, {"reason": reason})
    db.commit()
    db.refresh(content)
    return content


def regenerate_content(db: Session, user: User, content: AiContent, instructions: str | None) -> AiContent:
    previous_status = content.status
    body = content.get_body()
    previous_body = content.body
    previous_title = content.title

    regen_note = instructions or "Regenerated with updated AI parameters"
    body["ai_notes"] = f"{body.get('ai_notes', '')} | Regenerated: {regen_note}".strip(" |")
    body["ai_confidence"] = min(0.98, float(body.get("ai_confidence", 0.85)) + 0.05)

    if content.content_type == ContentType.quiz and body.get("questions"):
        for q in body["questions"]:
            q["question"] = f"[Revised] {q.get('question', 'Question')}"
    elif content.content_type == ContentType.assignment:
        body["instructions"] = f"{body.get('instructions', '')}\n\nRevision note: {regen_note}".strip()
    elif content.content_type == ContentType.flashcard and body.get("cards"):
        body["cards"].append({"front": "New AI card", "back": regen_note})

    content.body = json.dumps(body)
    content.version += 1
    content.status = ContentStatus.pending_review
    content.reviewed_by_id = None
    content.reviewed_by_name = None
    content.rejection_reason = None
    content.updated_at = datetime.now(timezone.utc)

    db.add(
        ContentRevision(
            id=_new_id(),
            content_id=content.id,
            version=content.version,
            title=previous_title,
            body=previous_body,
            edited_by_id=user.id,
            edited_by_name=user.full_name,
            edit_note=f"AI regeneration: {regen_note}",
        )
    )
    _record_approval(
        db,
        content,
        user,
        ApprovalAction.regenerated,
        previous_status,
        ContentStatus.pending_review,
        regen_note,
    )
    _log_action(db, user, "content_regenerated", "ai_content", content.id, {"instructions": instructions})
    db.commit()
    db.refresh(content)
    return content


def list_audit_logs(db: Session, user: User, limit: int = 50) -> list[AuditLog]:
    query = db.query(AuditLog)
    if user.role == UserRole.teacher:
        query = query.filter(AuditLog.actor_id == user.id)
    return query.order_by(AuditLog.created_at.desc()).limit(limit).all()


def seed_demo_content(db: Session) -> int:
    if db.query(AiContent).count() > 0:
        return 0

    teacher = db.query(User).filter(User.role == UserRole.teacher).first()
    if not teacher:
        return 0

    samples = [
        {
            "course_id": "course_dsa_101",
            "course_name": "Data Structures & Algorithms",
            "title": "Graph Algorithms Quiz",
            "content_type": ContentType.quiz,
            "subject": "cs",
            "concept_tags": ["Graph Theory", "DFS", "BFS"],
            "body": ContentBody(
                summary="AI-generated quiz on graph traversal algorithms",
                questions=[
                    {"question": "What is the time complexity of BFS?", "options": ["O(V+E)", "O(V*E)", "O(V²)", "O(E²)"], "answer": "O(V+E)"},
                    {"question": "Which structure does DFS use?", "options": ["Queue", "Stack", "Heap", "Hash Map"], "answer": "Stack"},
                ],
                ai_confidence=0.91,
                ai_notes="Generated from Week 4 lecture slides and CLO mapping",
            ),
        },
        {
            "course_id": "course_dsa_101",
            "course_name": "Data Structures & Algorithms",
            "title": "Assignment 3: Graph Algorithms",
            "content_type": ContentType.assignment,
            "subject": "cs",
            "concept_tags": ["Graph Theory", "Shortest Path"],
            "body": ContentBody(
                summary="Soft-form assignment on graph algorithms",
                instructions="Implement Dijkstra's algorithm and analyze time complexity for sparse vs dense graphs.",
                ai_confidence=0.88,
                ai_notes="Aligned with CLO-3: Apply graph algorithms to real problems",
            ),
        },
        {
            "course_id": "course_ml_201",
            "course_name": "Machine Learning Fundamentals",
            "title": "Gradient Descent Flashcards",
            "content_type": ContentType.flashcard,
            "subject": "cs",
            "concept_tags": ["Gradient Descent", "Optimization"],
            "body": ContentBody(
                summary="Flashcard set for optimization concepts",
                cards=[
                    {"front": "Learning rate", "back": "Step size used during weight updates"},
                    {"front": "Local minimum", "back": "Point where gradient is zero but not global optimum"},
                ],
                ai_confidence=0.86,
            ),
        },
        {
            "course_id": "course_physics_101",
            "course_name": "Applied Physics",
            "title": "Newton's Laws Study Guide",
            "content_type": ContentType.study_guide,
            "subject": "physics",
            "concept_tags": ["Newton's Laws", "Force", "Motion"],
            "body": ContentBody(
                summary="Concept-level study guide for mechanics unit",
                sections=[
                    {"heading": "First Law", "content": "An object remains at rest or in uniform motion unless acted upon by a net force."},
                    {"heading": "Second Law", "content": "F = ma relates force, mass, and acceleration."},
                ],
                ai_confidence=0.93,
            ),
        },
        {
            "course_id": "course_dld_101",
            "course_name": "Digital Logic Design",
            "title": "Boolean Algebra Concept Map",
            "content_type": ContentType.concept_map,
            "subject": "engineering",
            "concept_tags": ["Boolean Algebra", "Logic Gates"],
            "body": ContentBody(
                summary="Knowledge graph fragment for DLD prerequisites",
                sections=[
                    {"heading": "AND Gate", "content": "Outputs 1 only when all inputs are 1"},
                    {"heading": "OR Gate", "content": "Outputs 1 when any input is 1"},
                ],
                ai_confidence=0.89,
            ),
        },
    ]

    for sample in samples:
        create_content(db, teacher, AiContentCreate(**sample))

    approved = db.query(AiContent).filter(AiContent.title == "Graph Algorithms Quiz").first()
    if approved:
        approve_content(db, teacher, approved, "Seeded approved content for student demo")

    return len(samples)
