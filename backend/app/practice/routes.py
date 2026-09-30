"""Mock test + practice analytics endpoints.

A mock test is student-initiated, repeatable and ephemeral - see practice/service.py
for why it is not an Exam row. It is student-only: a teacher is the one setting the
questions a mock draws from, so them "practising" against their own bank isn't a
real signal, and previously letting them run one (even ungraded) meant a teacher
account could exercise the exact same "solve" surface a student uses.
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.auth.routes import get_current_user
from app.courses.access import assert_course_access
from app.database.connection import get_db
from app.database.models import Course, QuestionBankItem, User
from app.exams.service import load_questions
from app.gamification import service as gamification_service
from app.mastery import service as mastery_service
from app.practice import service as practice_service
from app.study import service as study_service

router = APIRouter(prefix="/courses", tags=["Practice"])
logger = logging.getLogger("conceptintel.practice")


class MockTestRequest(BaseModel):
    """Request to start a mock test: how many questions (validated below)."""
    size: int = practice_service.DEFAULT_MOCK_SIZE

    @field_validator("size")
    @classmethod
    def sane_size(cls, v: int) -> int:
        """Keep the requested size between 1 and the maximum allowed."""
        if not (1 <= v <= practice_service.MAX_MOCK_SIZE):
            raise ValueError(f"size must be between 1 and {practice_service.MAX_MOCK_SIZE}")
        return v


class MockTestOut(BaseModel):
    """A freshly built mock test: the token to submit back plus the student-facing questions."""
    attempt_token: str
    question_count: int
    total_points: int
    questions: List[dict]


class SubmitMockRequest(BaseModel):
    """Student's submission: the attempt token, answers keyed by question id, and time taken."""
    attempt_token: str
    responses: Dict[str, Any] = {}
    duration_seconds: Optional[int] = None


def _get_course(db: Session, course_id: int, user: User) -> Course:
    """Fetch the course (404 if missing) and check the user has access to it."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, user)
    return course


def _require_student(user: User) -> None:
    """Raise 403 unless the user is a student (mock tests are student-only)."""
    if user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mock tests are for students to practise on - only a student can take one.",
        )


@router.post("/{course_id}/practice/mock-test", response_model=MockTestOut, status_code=status.HTTP_201_CREATED)
def start_mock_test(
    course_id: int,
    payload: MockTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assembles a fresh mock test, weighted towards this student's weak concepts."""
    _get_course(db, course_id, current_user)
    _require_student(current_user)
    try:
        questions, seed = practice_service.assemble_mock_test(
            db, current_user.id, course_id, size=payload.size
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    served = practice_service.serve_mock_questions(questions, seed)
    return MockTestOut(
        attempt_token=practice_service.make_mock_token([q.id for q in questions], seed),
        question_count=len(served),
        total_points=sum(q.points or 1 for q in questions),
        questions=served,
    )


@router.post("/{course_id}/practice/mock-test/submit")
def submit_mock_test(
    course_id: int,
    payload: SubmitMockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Grade a mock test from its token, log a study session, record per-concept mastery
    evidence, award points, and return the score breakdown."""
    course = _get_course(db, course_id, current_user)
    _require_student(current_user)
    try:
        question_ids, seed = practice_service.read_mock_token(payload.attempt_token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    questions = load_questions(db, question_ids)
    # Guard against a token from another course being replayed here.
    if any(q.course_id != course_id for q in questions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This mock test doesn't belong to this course.",
        )
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The questions in this mock test are no longer available.",
        )

    result = practice_service.grade_mock(questions, seed, payload.responses or {})

    study_service.record_session(
        db, current_user.id, course_id, None, "mock",
        items_total=len(questions),
        items_correct=sum(1 for q in result["per_question"] if q["correct"]),
        duration_seconds=payload.duration_seconds,
    )
    # A mock spans many concepts, so evidence is recorded PER CONCEPT from that
    # concept's own questions rather than writing one blended score against an
    # arbitrary concept - which is what makes the weak-concept weighting improve
    # over time instead of chasing its own tail.
    if course.catalog_id:
        by_concept_node: Dict[str, Dict[str, Any]] = {}
        for item, pq in zip(questions, result["per_question"]):
            if not item.concept_node_id:
                continue
            slot = by_concept_node.setdefault(
                item.concept_node_id,
                {"name": item.concept_name or "", "earned": 0.0, "possible": 0.0},
            )
            slot["earned"] += pq["points_earned"]
            slot["possible"] += pq["points"]
        for node_id, v in by_concept_node.items():
            if v["possible"] <= 0:
                continue
            try:
                mastery_service.record_evidence(
                    db, current_user.id, course_id, course.catalog_id,
                    node_id, v["name"], round((v["earned"] / v["possible"]) * 100, 1),
                    source_type="quiz", source_id=0,
                )
            except Exception as e:
                logger.warning("Could not record mock mastery for %s: %s", node_id, e)

    gamification_service.award_points(
        db, current_user.id, course_id, round(result["score"] / 10),
        reason="Mock test", source_type="quiz", source_id=0,
    )
    db.commit()

    return result


@router.get("/{course_id}/practice/analytics")
def practice_analytics(
    course_id: int,
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This user's own practice picture for the course: mastery per concept, weakest
    and strongest topics, score trends, and streaks."""
    _get_course(db, course_id, current_user)
    return practice_service.build_analytics(db, current_user.id, course_id, days=days)


@router.get("/{course_id}/practice/bank-size")
def bank_size(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """How many questions a mock test can draw on - lets the UI disable the button
    with a real reason instead of failing after the click."""
    _get_course(db, course_id, current_user)
    count = db.query(QuestionBankItem).filter(
        QuestionBankItem.course_id == course_id,
        QuestionBankItem.status == "Approved",
    ).count()
    return {"available": count, "max_size": practice_service.MAX_MOCK_SIZE}
