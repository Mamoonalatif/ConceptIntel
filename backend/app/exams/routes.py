"""Exam endpoints: a teacher assembles and publishes, a student sits, the server grades.

The split of responsibility is deliberate and load-bearing: no endpoint here ever
sends an answer key to a student before submission, and no score is computed anywhere
but on the server. The student-facing payload is produced by
exams.service.build_served_questions, which is the only function allowed to shape a
question for delivery.
"""
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.routes import get_current_teacher, get_current_user
from app.courses.access import assert_course_access
from app.database.connection import get_db
from app.database.models import CLOAttainment, CLOAttainmentEvidence, Course, Exam, ExamAttempt, QuestionBankItem, User
from app.exams import service as exam_service
from app.exams.schemas import (
    ExamAttemptOut, ExamAttemptSummary, ExamIn, ExamOut, ExamResultOut,
    ExamUpdate, SubmitExamRequest,
)
from app.gamification import service as gamification_service
from app.mastery import service as mastery_service
from app.outcomes import services as outcomes_service

router = APIRouter(prefix="/courses", tags=["Exams"])
logger = logging.getLogger("conceptintel.exams")


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _get_owned_course(db: Session, course_id: int, teacher: User) -> Course:
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course."
        )
    return course


def _require_student(user: User) -> None:
    if user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Exams are sat by students - as the instructor, review results from the Attempts view instead.",
        )


def _to_out(db: Session, exam: Exam) -> ExamOut:
    ids = exam_service.exam_question_ids(exam)
    questions = exam_service.load_questions(db, ids)
    return ExamOut(
        id=exam.id, course_id=exam.course_id, title=exam.title, description=exam.description,
        question_ids=ids, question_count=len(questions),
        missing_question_count=len(ids) - len(questions),
        total_points=sum(q.points or 1 for q in questions),
        time_limit_seconds=exam.time_limit_seconds,
        shuffle_questions=exam.shuffle_questions, shuffle_options=exam.shuffle_options,
        max_attempts=exam.max_attempts, pass_mark=exam.pass_mark,
        show_answers_after=exam.show_answers_after,
        status=exam.status, created_at=exam.created_at,
    )


def _validate_question_ids(db: Session, course_id: int, ids: List[int]) -> List[int]:
    """Keeps only ids that exist in THIS course's bank, preserving order and dropping
    duplicates - an exam that silently contained another course's question would leak
    material across courses."""
    if not ids:
        return []
    owned = {
        i for (i,) in db.query(QuestionBankItem.id).filter(
            QuestionBankItem.id.in_(ids), QuestionBankItem.course_id == course_id
        ).all()
    }
    seen, out = set(), []
    for i in ids:
        if i in owned and i not in seen:
            seen.add(i)
            out.append(i)
    return out


# ─────────────────────────────── teacher ────────────────────────────────

@router.post("/{course_id}/exams", response_model=ExamOut, status_code=status.HTTP_201_CREATED)
def create_exam(
    course_id: int,
    payload: ExamIn,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    _get_owned_course(db, course_id, current_teacher)
    ids = _validate_question_ids(db, course_id, payload.question_ids)
    exam = Exam(
        course_id=course_id, title=payload.title, description=payload.description,
        question_ids_json=json.dumps(ids),
        time_limit_seconds=payload.time_limit_seconds,
        shuffle_questions=payload.shuffle_questions, shuffle_options=payload.shuffle_options,
        max_attempts=payload.max_attempts, pass_mark=payload.pass_mark,
        show_answers_after=payload.show_answers_after,
        created_by_id=current_teacher.id,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return _to_out(db, exam)


@router.get("/{course_id}/exams", response_model=List[ExamOut])
def list_exams(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Teachers see every exam; students see only published ones."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    q = db.query(Exam).filter(Exam.course_id == course_id)
    if current_user.role.lower() == "student":
        q = q.filter(Exam.status == "Published")
    return [_to_out(db, e) for e in q.order_by(Exam.created_at.desc()).all()]


@router.patch("/{course_id}/exams/{exam_id}", response_model=ExamOut)
def update_exam(
    course_id: int,
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    _get_owned_course(db, course_id, current_teacher)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.course_id == course_id).first()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    submitted = db.query(ExamAttempt).filter(
        ExamAttempt.exam_id == exam.id, ExamAttempt.submitted_at.isnot(None)
    ).count()
    changes_content = payload.question_ids is not None or payload.pass_mark is not None
    if submitted and changes_content:
        # Changing the questions or the pass mark after students have sat it would
        # silently invalidate their recorded scores.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{submitted} student(s) have already submitted this exam, so its questions "
                "and pass mark are locked. Duplicate it instead if you need a revised version."
            ),
        )

    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An exam needs a title.")
        exam.title = payload.title.strip()
    if payload.description is not None:
        exam.description = payload.description
    if payload.question_ids is not None:
        exam.question_ids_json = json.dumps(_validate_question_ids(db, course_id, payload.question_ids))
    for field in ("time_limit_seconds", "shuffle_questions", "shuffle_options",
                  "max_attempts", "pass_mark", "show_answers_after"):
        value = getattr(payload, field)
        if value is not None:
            setattr(exam, field, value)
    if payload.status is not None:
        if payload.status not in ("Draft", "Published", "Closed"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown exam status.")
        if payload.status == "Published" and not exam_service.exam_question_ids(exam):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Add at least one question before publishing this exam.",
            )
        exam.status = payload.status

    db.commit()
    db.refresh(exam)
    return _to_out(db, exam)


@router.delete("/{course_id}/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    course_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    _get_owned_course(db, course_id, current_teacher)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.course_id == course_id).first()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    submitted = db.query(ExamAttempt).filter(
        ExamAttempt.exam_id == exam.id, ExamAttempt.submitted_at.isnot(None)
    ).count()
    if submitted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{submitted} student(s) have sat this exam - close it instead of deleting it.",
        )
    db.query(ExamAttempt).filter(ExamAttempt.exam_id == exam.id).delete(synchronize_session=False)
    db.delete(exam)
    db.commit()
    return None


@router.get("/{course_id}/exams/{exam_id}/attempts", response_model=List[ExamAttemptSummary])
def list_exam_attempts(
    course_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Every student's result for one exam - the teacher's results view."""
    _get_owned_course(db, course_id, current_teacher)
    rows = (
        db.query(ExamAttempt, User.full_name)
        .join(User, ExamAttempt.student_id == User.id)
        .filter(ExamAttempt.exam_id == exam_id)
        .order_by(ExamAttempt.submitted_at.desc().nullslast())
        .all()
    )
    return [
        ExamAttemptSummary(
            id=a.id, student_id=a.student_id, student_name=name,
            attempt_number=a.attempt_number, score=a.score, passed=a.passed,
            submitted_at=a.submitted_at,
        )
        for a, name in rows
    ]


# ─────────────────────────────── student ────────────────────────────────

@router.post("/{course_id}/exams/{exam_id}/attempt", response_model=ExamAttemptOut, status_code=status.HTTP_201_CREATED)
def start_exam_attempt(
    course_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Starts a sitting, or resumes the one already in progress.

    Resuming rather than starting fresh is deliberate: a student whose browser
    crashed mid-exam must not lose an attempt, and must get back the same questions
    in the same order - which the stored seed guarantees.
    """
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.course_id == course_id).first()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    open_attempt = db.query(ExamAttempt).filter(
        ExamAttempt.exam_id == exam.id,
        ExamAttempt.student_id == current_user.id,
        ExamAttempt.submitted_at.is_(None),
    ).order_by(ExamAttempt.started_at.desc()).first()

    if open_attempt is None:
        allowed, why = exam_service.can_attempt(db, exam, current_user.id)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=why)
        if exam.status != "Published":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This exam isn't open.")

        questions = exam_service.load_questions(db, exam_service.exam_question_ids(exam))
        if not questions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This exam has no questions available.",
            )
        open_attempt = exam_service.start_attempt(db, exam, current_user.id, questions)
        db.commit()
        db.refresh(open_attempt)

    seed, ids = exam_service.attempt_seed_and_ids(open_attempt)
    questions = exam_service.load_questions(db, ids)
    served = exam_service.build_served_questions(exam, questions, seed)

    return ExamAttemptOut(
        attempt_id=open_attempt.id, exam_id=exam.id, title=exam.title,
        description=exam.description, attempt_number=open_attempt.attempt_number,
        questions=served,
        remaining_seconds=exam_service.remaining_seconds(exam, open_attempt),
        time_limit_seconds=exam.time_limit_seconds,
        started_at=open_attempt.started_at,
    )


@router.post("/{course_id}/exams/{exam_id}/attempt/{attempt_id}/submit", response_model=ExamResultOut)
def submit_exam_attempt(
    course_id: int,
    exam_id: int,
    attempt_id: int,
    payload: SubmitExamRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _require_student(current_user)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.course_id == course_id).first()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    attempt = db.query(ExamAttempt).filter(
        ExamAttempt.id == attempt_id,
        ExamAttempt.exam_id == exam.id,
        ExamAttempt.student_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attempt not found")
    if attempt.submitted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This attempt has already been submitted."
        )

    late = exam_service.is_late(exam, attempt)
    result = exam_service.grade_attempt(db, exam, attempt, payload.responses or {})

    try:
        if course.catalog_id:
            for c in result.get("concept_scores", []):
                mastery_service.record_evidence(
                    db, current_user.id, course_id, course.catalog_id,
                    c["concept_node_id"], exam.title, c["score"],
                    source_type="quiz", source_id=exam.id,
                )
    except Exception as e:
        logger.warning("Could not record mastery for exam %s: %s", exam.id, e)

    try:
        touched_clo_ids: set = set()
        for c in result.get("clo_scores", []):
            clo_id = c["clo_id"]
            touched_clo_ids.add(clo_id)
            db.add(CLOAttainmentEvidence(
                student_id=current_user.id, course_id=course_id, clo_id=clo_id,
                source_type="quiz", source_id=exam.id, score=c["score"],
            ))
            attainment = db.query(CLOAttainment).filter(
                CLOAttainment.student_id == current_user.id,
                CLOAttainment.course_id == course_id,
                CLOAttainment.clo_id == clo_id,
            ).first()
            if attainment is None:
                db.add(CLOAttainment(
                    student_id=current_user.id, course_id=course_id, clo_id=clo_id,
                    attainment_score=c["score"], evidence_count=1,
                ))
            else:
                attainment.attainment_score = (
                    (attainment.attainment_score * attainment.evidence_count) + c["score"]
                ) / (attainment.evidence_count + 1)
                attainment.evidence_count += 1
        if touched_clo_ids:
            db.flush()
            for clo_id in touched_clo_ids:
                outcomes_service.recompute_plo_attainment(db, current_user.id, clo_id)
    except Exception as e:
        logger.warning("Could not record CLO/PLO attainment for exam %s: %s", exam.id, e)

    gamification_service.award_points(
        db, current_user.id, course_id, round(result["score"] / 10),
        reason=f"Exam: {exam.title}", source_type="quiz", source_id=exam.id,
    )
    db.commit()

    return ExamResultOut(attempt_id=attempt.id, late=late, **result)
