"""Study mode endpoints: Learn, Test and Match over already-approved material.

WHO CAN DO WHAT
---------------
Student-only. A teacher authors this material and reviews it through the Content
Studio/Library instead of drilling it themselves - letting a teacher account run
Learn/Test/Match is the same "solve" surface a student uses, and ConceptMastery,
StudentPoints and StudySession are per-student tables anyway: writing a teacher's id
into them invents a phantom learner on their own course's leaderboard and skews
every weak-concept calculation the Adaptive Engine makes. This mirrors the same rule
in app/gamification/game_routes.py.

Students only ever see Approved content, enforced here rather than in the UI - the
same gate list_content applies.

ON TEST INTEGRITY
-----------------
The assembled test omits correct_index, and options are shuffled per attempt, so the
response alone does not give the answers away. That is a usability guard, not a
security boundary: an approved item's full payload (including correct_index) is
already fetchable by a student through GET /courses/{id}/content/{content_id}, which
is pre-existing behaviour. Scoring therefore happens server-side by re-deriving the
exact same test from the attempt token's seed - a determined student can still cheat,
exactly as they can on the existing quiz, and the authoritative assessment signals in
this system remain assignments and teacher-set quizzes.
"""
import base64
import json
import logging
import random
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.routes import get_current_user
from app.courses.access import assert_course_access
from app.database.connection import get_db
from app.database.models import Course, GeneratedContent, StudySession, User
from app.gamification import service as gamification_service
from app.mastery import service as mastery_service
from app.study import service as study_service
from app.study.schemas import (
    LearnQueueOut, LearnResultOut, MatchSetOut, StudyOverviewOut, StudySessionOut,
    SubmitLearnRequest, SubmitMatchRequest, SubmitTestRequest, TestOut, TestResultOut,
)

router = APIRouter(prefix="/courses", tags=["Study Modes"])
logger = logging.getLogger("conceptintel.study")


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _get_studyable_content(db: Session, course_id: int, content_id: int, user: User) -> GeneratedContent:
    item = db.query(GeneratedContent).filter(
        GeneratedContent.id == content_id, GeneratedContent.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study set not found")
    if user.role.lower() == "student" and item.status != "Approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This material hasn't been approved by your instructor yet.",
        )
    return item


def _require_student(user: User) -> None:
    if user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Learn/Test/Match are for students to drill with - only a student can run them.",
        )


def _make_token(content_id: int, seed: int) -> str:
    raw = json.dumps({"c": content_id, "s": seed}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _read_token(token: str, content_id: int) -> int:
    """Recovers the seed so the exact same test can be rebuilt for scoring."""
    try:
        padded = token + "=" * (-len(token) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        if int(data["c"]) != content_id:
            raise ValueError("token belongs to a different study set")
        return int(data["s"])
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This test attempt has expired or is invalid. Start it again.",
        )


# ─────────────────────────────── overview ────────────────────────────────

@router.get("/{course_id}/study/overview", response_model=List[StudyOverviewOut])
def study_overview(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every drillable set in the course with this user's progress against it, so the
    UI can lead with what actually needs work instead of a flat list."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    query = db.query(GeneratedContent).filter(
        GeneratedContent.course_id == course_id,
        GeneratedContent.content_type.in_(("flashcard", "mcq", "quiz")),
    )
    if current_user.role.lower() == "student":
        query = query.filter(GeneratedContent.status == "Approved")

    out: List[StudyOverviewOut] = []
    for item in query.order_by(GeneratedContent.created_at.desc()).all():
        items = study_service.extract_items(item)
        if not items:
            continue
        _, progress = study_service.build_learn_queue(db, current_user.id, item, limit=0)
        out.append(StudyOverviewOut(
            content_id=item.id,
            title=item.title,
            content_type=item.content_type,
            concept_name=item.concept_name,
            difficulty=item.difficulty or "Medium",
            total_items=progress["total"],
            mastered=progress["mastered"],
            due=progress["new"] + progress["due"],
            # Match needs real term/definition pairs; an MCQ option is meaningless
            # without its distractors, so only flashcards qualify.
            supports_match=item.content_type == "flashcard" and len(items) >= 2,
        ))
    return out


# ───────────────────────────────── learn ─────────────────────────────────

@router.get("/{course_id}/study/{content_id}/learn", response_model=LearnQueueOut)
def get_learn_queue(
    course_id: int,
    content_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    queue, progress = study_service.build_learn_queue(
        db, current_user.id, item, limit=max(1, min(limit, 50))
    )
    if not queue and progress["total"] == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This material has no drillable items (study guides are read, not drilled).",
        )
    return LearnQueueOut(
        content_id=item.id, title=item.title, content_type=item.content_type,
        queue=queue, progress=progress,
    )


@router.post("/{course_id}/study/{content_id}/learn", response_model=LearnResultOut)
def submit_learn_round(
    course_id: int,
    content_id: int,
    payload: SubmitLearnRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    valid_indices = {i["index"] for i in study_service.extract_items(item)}
    answers = [a for a in payload.answers if a.item_index in valid_indices]
    if not answers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="None of the submitted answers match this study set.",
        )

    correct_count = sum(1 for a in answers if a.correct)

    for a in answers:
        study_service.record_answer(
            db, current_user.id, course_id, item, a.item_index, a.correct,
        )
    study_service.record_session(
        db, current_user.id, course_id, item, "learn",
        items_total=len(answers), items_correct=correct_count,
        duration_seconds=payload.duration_seconds,
    )
    # Drilling is practice, so it earns points but does NOT write mastery
    # evidence: mastery should reflect assessment, and a student can repeat a
    # Learn round until every card is right, which would inflate it to 100%.
    gamification_service.award_points(
        db, current_user.id, course_id, max(1, round(correct_count / 3)),
        reason=f"Studied: {item.title}", source_type="study", source_id=item.id,
    )
    db.commit()

    _, progress = study_service.build_learn_queue(db, current_user.id, item, limit=0)
    return LearnResultOut(
        score=round((correct_count / len(answers)) * 100, 1),
        items_total=len(answers),
        items_correct=correct_count,
        progress=progress,
    )


# ────────────────────────────────── test ─────────────────────────────────

@router.get("/{course_id}/study/{content_id}/test", response_model=TestOut)
def start_test(
    course_id: int,
    content_id: int,
    count: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    seed = random.randint(1, 2_000_000_000)
    questions = study_service.assemble_test(
        db, item, question_count=count, seed=seed,
    )
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This set can't be turned into a test. Flashcard sets need at least 4 "
                "cards so there are enough options to choose between."
            ),
        )
    return TestOut(
        content_id=item.id,
        title=item.title,
        attempt_token=_make_token(item.id, seed),
        # correct_index is stripped here - the client never receives the answer key.
        questions=[
            {"source_index": q["source_index"], "question": q["question"],
             "options": q["options"], "explanation": q["explanation"]}
            for q in questions
        ],
    )


@router.post("/{course_id}/study/{content_id}/test", response_model=TestResultOut)
def submit_test(
    course_id: int,
    content_id: int,
    payload: SubmitTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    seed = _read_token(payload.attempt_token, content_id)
    # Rebuilt from the same seed, so this is byte-for-byte the test that was served.
    questions = study_service.assemble_test(db, item, question_count=None, seed=seed)
    if len(payload.answers) > len(questions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected at most {len(questions)} answers, got {len(payload.answers)}.",
        )
    questions = questions[:len(payload.answers)]

    per_question = []
    correct_count = 0
    for q, selected in zip(questions, payload.answers):
        is_correct = selected == q["correct_index"]
        if is_correct:
            correct_count += 1
        per_question.append({
            "question": q["question"],
            "options": q["options"],
            "your_answer": selected,
            "correct_index": q["correct_index"],
            "correct": is_correct,
            "explanation": q["explanation"],
        })

    total = len(questions)
    score = round((correct_count / total) * 100, 1) if total else 0.0

    study_service.record_session(
        db, current_user.id, course_id, item, "test",
        items_total=total, items_correct=correct_count,
    )
    # Unlike Learn, a Test is a single scored sitting, so it IS mastery evidence -
    # same treatment as a quiz attempt.
    mastery_service.record_evidence(
        db, current_user.id, course_id, item.catalog_id,
        item.concept_node_id, item.concept_name, score,
        source_type="quiz", source_id=item.id,
    )
    gamification_service.award_points(
        db, current_user.id, course_id, round(score / 10),
        reason=f"Test: {item.title}", source_type="study", source_id=item.id,
    )
    db.commit()

    return TestResultOut(
        score=score, correct_count=correct_count, total_count=total, per_question=per_question,
    )


# ───────────────────────────────── match ─────────────────────────────────

@router.get("/{course_id}/study/{content_id}/match", response_model=MatchSetOut)
def start_match(
    course_id: int,
    content_id: int,
    pairs: int = 6,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    chosen = study_service.build_match_pairs(item, pair_count=max(2, min(pairs, 12)))
    if not chosen:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Match needs a flashcard set with at least 2 cards.",
        )
    return MatchSetOut(content_id=item.id, title=item.title, pairs=chosen)


@router.post("/{course_id}/study/{content_id}/match", status_code=status.HTTP_201_CREATED)
def submit_match(
    course_id: int,
    content_id: int,
    payload: SubmitMatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    item = _get_studyable_content(db, course_id, content_id, current_user)

    total = max(0, payload.pairs_total)
    matched = max(0, min(payload.pairs_matched, total))

    session = study_service.record_session(
        db, current_user.id, course_id, item, "match",
        items_total=total, items_correct=matched,
        duration_seconds=payload.duration_seconds,
    )
    gamification_service.award_points(
        db, current_user.id, course_id, max(1, round(matched / 2)),
        reason=f"Match drill: {item.title}", source_type="study", source_id=item.id,
    )
    db.commit()
    db.refresh(session)
    return StudySessionOut.model_validate(session)


# ──────────────────────────────── history ────────────────────────────────

@router.get("/{course_id}/study/sessions", response_model=List[StudySessionOut])
def list_study_sessions(
    course_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This user's own recent study runs in this course - feeds the practice history
    and streak display."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    rows = (
        db.query(StudySession)
        .filter(StudySession.course_id == course_id, StudySession.student_id == current_user.id)
        .order_by(StudySession.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [StudySessionOut.model_validate(r) for r in rows]
