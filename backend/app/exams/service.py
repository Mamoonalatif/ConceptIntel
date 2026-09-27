"""Exam delivery: turning a stored Exam plus its bank questions into a sitting, and
grading that sitting back into a score.

DETERMINISTIC SHUFFLING
-----------------------
An attempt stores a seed, not the shuffled questions. Every time the attempt is
rendered or graded, the exact same ordering is rebuilt from that seed. This matters
because options are shuffled per attempt: the student answers "option 2", and only
the attempt's own ordering says which option that was. Storing the seed rather than
the expanded payload keeps the row small, keeps a resumed attempt identical to the
one that was started, and makes a regrade after a fixed answer key trivially correct.

TIME LIMITS ARE SERVER-SIDE
---------------------------
`started_at` is written by the database. Remaining time is computed against it on
every fetch, and a submission arriving after the limit is marked late rather than
silently accepted, because the countdown a browser renders is a convenience and can
be paused, throttled or edited.

WHAT COUNTS AS "PASSED"
-----------------------
pass_mark is a percentage of points earned over points possible, where a question's
points come from the bank item. Partial credit on multi-select and matching therefore
flows straight through - a half-right matching question contributes half its points.
"""
import json
import logging
import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.database.models import Exam, ExamAttempt, QuestionBankItem
from app.question_bank import service as qb

logger = logging.getLogger("conceptintel.exams")

# Grace period allowed on top of a timed exam's limit, to absorb the round trip and
# a slow network rather than punishing a student who clicked submit in time.
LATE_GRACE_SECONDS = 15


def exam_question_ids(exam: Exam) -> List[int]:
    try:
        ids = json.loads(exam.question_ids_json or "[]")
        return [int(i) for i in ids] if isinstance(ids, list) else []
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def load_questions(db: Session, ids: List[int]) -> List[QuestionBankItem]:
    """Fetches bank items preserving the exam's declared order.

    A question that has since been deleted simply drops out; the caller reports the
    difference rather than pretending the exam is intact.
    """
    if not ids:
        return []
    rows = db.query(QuestionBankItem).filter(QuestionBankItem.id.in_(ids)).all()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def _payload(item: QuestionBankItem) -> Dict[str, Any]:
    try:
        return json.loads(item.payload_json) or {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("QuestionBankItem %s has unparseable payload_json", item.id)
        return {}


def attempts_used(db: Session, exam_id: int, student_id: int) -> int:
    return db.query(ExamAttempt).filter(
        ExamAttempt.exam_id == exam_id, ExamAttempt.student_id == student_id
    ).count()


def can_attempt(db: Session, exam: Exam, student_id: int) -> Tuple[bool, str]:
    """Whether this student may start another sitting, and why not if they may not."""
    if exam.status != "Published":
        return False, "This exam isn't open."
    used = attempts_used(db, exam.id, student_id)
    if exam.max_attempts and used >= exam.max_attempts:
        return False, (
            f"You've used all {exam.max_attempts} attempt(s) for this exam."
        )
    return True, ""


def build_served_questions(
    exam: Exam, questions: List[QuestionBankItem], seed: int,
) -> List[Dict[str, Any]]:
    """The student-facing form of every question, in this attempt's order.

    Rebuilt identically on every call for a given seed - that determinism is what lets
    grading resolve a selected index back to the option it referred to.
    """
    rng = random.Random(seed)
    ordered = list(questions)
    if exam.shuffle_questions:
        rng.shuffle(ordered)

    served = []
    for item in ordered:
        payload = _payload(item)
        # Each question gets its own generator, derived from the attempt seed and the
        # question id, so adding or removing a question does not reshuffle the options
        # of every other question in an in-progress attempt.
        q_rng = random.Random(seed * 1000003 + item.id)
        public = qb.public_payload(
            item.question_type, payload, shuffle=exam.shuffle_options, rng=q_rng,
        )
        served.append({
            "id": item.id,
            "question_type": item.question_type,
            "prompt": item.prompt,
            "points": item.points,
            "difficulty": item.difficulty,
            "concept_name": item.concept_name,
            "time_limit_seconds": item.time_limit_seconds,
            **public,
        })
    return served


def start_attempt(db: Session, exam: Exam, student_id: int, questions: List[QuestionBankItem]) -> ExamAttempt:
    """Creates the attempt row. Commits nothing - the caller owns the transaction."""
    seed = random.randint(1, 2_000_000_000)
    used = attempts_used(db, exam.id, student_id)
    attempt = ExamAttempt(
        exam_id=exam.id,
        student_id=student_id,
        course_id=exam.course_id,
        attempt_number=used + 1,
        question_order_json=json.dumps({"seed": seed, "ids": [q.id for q in questions]}),
    )
    db.add(attempt)
    return attempt


def attempt_seed_and_ids(attempt: ExamAttempt) -> Tuple[int, List[int]]:
    try:
        data = json.loads(attempt.question_order_json or "{}")
        return int(data.get("seed", 0)), [int(i) for i in (data.get("ids") or [])]
    except (json.JSONDecodeError, TypeError, ValueError):
        return 0, []


def remaining_seconds(exam: Exam, attempt: ExamAttempt) -> Optional[int]:
    """Seconds left on a timed exam, or None when it is untimed. Never negative."""
    if not exam.time_limit_seconds or not attempt.started_at:
        return None
    deadline = attempt.started_at + timedelta(seconds=exam.time_limit_seconds)
    return max(0, int((deadline - datetime.utcnow()).total_seconds()))


def is_late(exam: Exam, attempt: ExamAttempt) -> bool:
    if not exam.time_limit_seconds or not attempt.started_at:
        return False
    deadline = attempt.started_at + timedelta(seconds=exam.time_limit_seconds + LATE_GRACE_SECONDS)
    return datetime.utcnow() > deadline


def grade_attempt(
    db: Session, exam: Exam, attempt: ExamAttempt, responses: Dict[str, Any],
) -> Dict[str, Any]:
    """Grades every question and writes the result onto the attempt.

    responses is keyed by question id (as a string, because it arrives as JSON).
    A question with no response is graded as unanswered rather than skipped, so the
    denominator is always the whole exam - otherwise leaving questions blank would
    inflate the percentage.
    """
    seed, ids = attempt_seed_and_ids(attempt)
    questions = load_questions(db, ids)
    served = build_served_questions(exam, questions, seed)
    by_id = {q.id: q for q in questions}

    points_earned = 0.0
    points_possible = 0.0
    per_question: List[Dict[str, Any]] = []

    for s in served:
        item = by_id.get(s["id"])
        if item is None:
            continue
        payload = _payload(item)
        weight = float(item.points or 1)
        points_possible += weight

        raw = responses.get(str(item.id), responses.get(item.id))
        answered = raw is not None
        full, fraction = qb.grade(item.question_type, payload, raw, served=s) if answered else (False, 0.0)
        earned = round(weight * fraction, 4)
        points_earned += earned

        entry = {
            "id": item.id,
            "prompt": item.prompt,
            "question_type": item.question_type,
            "points": weight,
            "points_earned": earned,
            "correct": full,
            "answered": answered,
        }
        if exam.show_answers_after:
            entry["explanation"] = item.explanation or ""
            entry["answer_key"] = _readable_answer(item.question_type, payload)
        per_question.append(entry)

    score = round((points_earned / points_possible) * 100, 2) if points_possible else 0.0
    attempt.responses_json = json.dumps(responses)
    attempt.points_earned = round(points_earned, 4)
    attempt.points_possible = round(points_possible, 4)
    attempt.score = score
    attempt.passed = score >= float(exam.pass_mark or 0)
    attempt.submitted_at = datetime.utcnow()

    return {
        "score": score,
        "points_earned": attempt.points_earned,
        "points_possible": attempt.points_possible,
        "passed": bool(attempt.passed),
        "pass_mark": float(exam.pass_mark or 0),
        "per_question": per_question if exam.show_answers_after else [],
    }


def _readable_answer(question_type: str, payload: Dict[str, Any]) -> str:
    """The answer key rendered for a human, shown only when the exam allows it."""
    try:
        if question_type == "single_choice":
            return payload["options"][payload["correct_index"]]
        if question_type == "multi_select":
            return ", ".join(payload["options"][i] for i in payload["correct_indices"])
        if question_type == "true_false":
            return "True" if payload["correct"] else "False"
        if question_type == "fill_blank":
            return " / ".join(payload["accepted"])
        if question_type == "matching":
            return "; ".join(f"{p['left']} → {p['right']}" for p in payload["pairs"])
    except (KeyError, IndexError, TypeError):
        pass
    return ""
