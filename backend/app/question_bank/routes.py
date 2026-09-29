"""Question bank endpoints - the teacher's library of reusable exam questions.

Everything here is teacher-facing and returns the ANSWER KEY. There is deliberately
no student-facing view of a bank question: students only ever meet these through an
exam, which strips the key (see app/exams/).
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.routes import get_current_teacher
from app.core import quota
from app.database.connection import get_db
from app.database.models import CLO, Course, GeneratedContent, QuestionBankItem, User
from app.knowledge_graph.services import neo4j_service
from app.question_bank import generation as qb_generation
from app.question_bank import service as qb
from app.question_bank.schemas import (
    GenerateQuestionsRequest, ImportQuestionsRequest, ImportResultOut,
    QuestionIn, QuestionOut, QuestionTypeInfo, QuestionUpdate,
)
from app.rag.retrieval import format_excerpts, retrieve_for_concept

router = APIRouter(prefix="/courses", tags=["Question Bank"])
logger = logging.getLogger("conceptintel.question_bank")


def _get_owned_course(db: Session, course_id: int, teacher: User) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if course.teacher_id != teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course."
        )
    return course


def _to_out(item: QuestionBankItem, db: Session) -> QuestionOut:
    try:
        payload = json.loads(item.payload_json) or {}
    except (json.JSONDecodeError, TypeError):
        payload = {}
    clo_code = None
    if item.clo_id:
        clo = db.query(CLO).filter(CLO.id == item.clo_id).first()
        clo_code = clo.code if clo else None
    return QuestionOut(
        id=item.id, course_id=item.course_id, question_type=item.question_type,
        question_type_label=qb.TYPE_LABELS.get(item.question_type, item.question_type),
        prompt=item.prompt, payload=payload, explanation=item.explanation,
        difficulty=item.difficulty or "Medium", points=item.points or 1,
        time_limit_seconds=item.time_limit_seconds,
        concept_node_id=item.concept_node_id, concept_name=item.concept_name,
        clo_id=item.clo_id, clo_code=clo_code,
        source=item.source, status=item.status, created_at=item.created_at,
    )


@router.get("/{course_id}/question-bank/types", response_model=List[QuestionTypeInfo])
def list_question_types(course_id: int):
    """The supported question types, so the UI never hardcodes the list.

    Course-scoped even though the list is global: an unscoped "/courses/question-types"
    is two segments and would be captured by the existing GET /courses/{course_id},
    binding course_id="question-types" and 422-ing. Declared before the
    /{course_id}/question-bank/{question_id} routes so "types" is never read as an id.
    """
    return [QuestionTypeInfo(key=k, label=qb.TYPE_LABELS[k]) for k in qb.QUESTION_TYPES]


@router.get("/{course_id}/question-bank", response_model=List[QuestionOut])
def list_questions(
    course_id: int,
    question_type: Optional[str] = None,
    difficulty: Optional[str] = None,
    concept_node_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    _get_owned_course(db, course_id, current_teacher)
    q = db.query(QuestionBankItem).filter(
        QuestionBankItem.course_id == course_id,
        QuestionBankItem.status != "Retired",
    )
    if question_type:
        q = q.filter(QuestionBankItem.question_type == question_type)
    if difficulty:
        q = q.filter(QuestionBankItem.difficulty == difficulty.capitalize())
    if concept_node_id:
        q = q.filter(QuestionBankItem.concept_node_id == concept_node_id)
    if search:
        q = q.filter(QuestionBankItem.prompt.ilike(f"%{search.strip()}%"))
    return [_to_out(i, db) for i in q.order_by(QuestionBankItem.created_at.desc()).all()]


@router.post("/{course_id}/question-bank", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
def create_question(
    course_id: int,
    payload: QuestionIn,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_owned_course(db, course_id, current_teacher)
    try:
        clean = qb.validate_payload(payload.question_type, payload.payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    clo_id = None
    if payload.clo_id:
        clo_row = db.query(CLO).filter(CLO.id == payload.clo_id, CLO.catalog_id == course.catalog_id).first()
        if not clo_row:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CLO not found for this course's subject.")
        clo_id = clo_row.id

    item = QuestionBankItem(
        course_id=course_id, catalog_id=course.catalog_id,
        concept_node_id=payload.concept_node_id, concept_name=payload.concept_name,
        clo_id=clo_id,
        question_type=payload.question_type, prompt=payload.prompt,
        payload_json=json.dumps(clean), explanation=payload.explanation,
        difficulty=payload.difficulty, points=payload.points,
        time_limit_seconds=payload.time_limit_seconds,
        source="manual", created_by_id=current_teacher.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(item, db)


@router.patch("/{course_id}/question-bank/{question_id}", response_model=QuestionOut)
def update_question(
    course_id: int,
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_owned_course(db, course_id, current_teacher)
    item = db.query(QuestionBankItem).filter(
        QuestionBankItem.id == question_id, QuestionBankItem.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    if payload.clear_clo:
        item.clo_id = None
    elif payload.clo_id is not None:
        clo_row = db.query(CLO).filter(CLO.id == payload.clo_id, CLO.catalog_id == course.catalog_id).first()
        if not clo_row:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CLO not found for this course's subject.")
        item.clo_id = clo_row.id

    if payload.payload is not None:
        try:
            item.payload_json = json.dumps(qb.validate_payload(item.question_type, payload.payload))
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if payload.prompt is not None:
        if not payload.prompt.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A question needs a prompt.")
        item.prompt = payload.prompt.strip()
    if payload.explanation is not None:
        item.explanation = payload.explanation
    if payload.difficulty is not None:
        item.difficulty = payload.difficulty.capitalize()
    if payload.points is not None:
        item.points = max(1, min(100, payload.points))
    if payload.time_limit_seconds is not None:
        item.time_limit_seconds = payload.time_limit_seconds or None
    if payload.status is not None and payload.status in ("Approved", "PendingReview", "Retired"):
        item.status = payload.status

    db.commit()
    db.refresh(item)
    return _to_out(item, db)


@router.delete("/{course_id}/question-bank/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(
    course_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Retires rather than deletes when the question is already in an exam.

    A hard delete would silently shorten every exam that references it, including
    exams students have already sat - which would change historical scores.
    """
    _get_owned_course(db, course_id, current_teacher)
    item = db.query(QuestionBankItem).filter(
        QuestionBankItem.id == question_id, QuestionBankItem.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    from app.database.models import Exam  # local import to avoid a cycle at module load
    referenced = False
    for exam in db.query(Exam).filter(Exam.course_id == course_id).all():
        try:
            if question_id in (json.loads(exam.question_ids_json or "[]") or []):
                referenced = True
                break
        except (json.JSONDecodeError, TypeError):
            continue

    if referenced:
        item.status = "Retired"
    else:
        db.delete(item)
    db.commit()
    return None


@router.post("/{course_id}/question-bank/import", response_model=ImportResultOut)
def import_from_generated(
    course_id: int,
    payload: ImportQuestionsRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Copies an already-generated set into the bank as individual questions, so
    material a teacher has already reviewed can be reused in exams without
    regenerating (and re-reviewing) anything."""
    course = _get_owned_course(db, course_id, current_teacher)
    content = db.query(GeneratedContent).filter(
        GeneratedContent.id == payload.content_id, GeneratedContent.course_id == course_id
    ).first()
    if not content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated set not found")

    candidates = qb.items_from_generated_content(content.content_type, content.payload_json)
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This set has nothing importable (study guides have no questions).",
        )

    existing_prompts = {
        p.lower() for (p,) in db.query(QuestionBankItem.prompt)
        .filter(QuestionBankItem.course_id == course_id).all()
    }

    imported = skipped = 0
    for c in candidates:
        if c["prompt"].lower() in existing_prompts:
            skipped += 1
            continue
        try:
            clean = qb.validate_payload(c["question_type"], c["payload"])
        except ValueError as e:
            logger.info("Skipping unimportable question from content %s: %s", content.id, e)
            skipped += 1
            continue
        db.add(QuestionBankItem(
            course_id=course_id, catalog_id=course.catalog_id,
            concept_node_id=content.concept_node_id, concept_name=content.concept_name,
            question_type=c["question_type"], prompt=c["prompt"],
            payload_json=json.dumps(clean), explanation=c.get("explanation"),
            difficulty=content.difficulty or "Medium", points=1,
            source="imported", source_content_id=content.id,
            created_by_id=current_teacher.id,
        ))
        existing_prompts.add(c["prompt"].lower())
        imported += 1

    db.commit()
    return ImportResultOut(
        imported=imported, skipped=skipped,
        message=(
            f"Imported {imported} question(s) from \"{content.title}\"."
            + (f" Skipped {skipped} already in the bank or unusable." if skipped else "")
        ),
    )


@router.post("/{course_id}/question-bank/generate", response_model=List[QuestionOut], status_code=status.HTTP_201_CREATED)
def generate_questions(
    course_id: int,
    payload: GenerateQuestionsRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Writes new questions of a chosen type for a concept, grounded in course material."""
    course = _get_owned_course(db, course_id, current_teacher)
    if not course.catalog_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This course has no catalog entry / concept graph yet.",
        )
    quota.check_and_increment(db, current_teacher.id)
    db.commit()

    graph = neo4j_service.get_catalog_graph(course.catalog_id)
    node = next((n for n in graph.get("nodes", []) if n.get("id") == payload.concept_node_id), None)
    if not node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Concept not found in this course's concept graph.",
        )
    concept_name = node.get("name") or "this concept"
    description = node.get("description") or ""

    excerpts = ""
    try:
        excerpts = format_excerpts(retrieve_for_concept(db, course_id, concept_name, description))
    except Exception as e:
        logger.warning("Retrieval failed for '%s', generating ungrounded: %s", concept_name, e)

    try:
        generated = qb_generation.generate_questions(
            concept_name, description, payload.question_type,
            payload.count, payload.difficulty, excerpts,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    created = []
    for g in generated:
        item = QuestionBankItem(
            course_id=course_id, catalog_id=course.catalog_id,
            concept_node_id=payload.concept_node_id, concept_name=concept_name,
            question_type=payload.question_type, prompt=g["prompt"],
            payload_json=json.dumps(g["payload"]), explanation=g.get("explanation"),
            difficulty=payload.difficulty, points=1,
            source="generated", created_by_id=current_teacher.id,
        )
        db.add(item)
        created.append(item)

    db.commit()
    for item in created:
        db.refresh(item)
    return [_to_out(i, db) for i in created]
