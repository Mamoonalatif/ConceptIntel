"""Mock tests and practice analytics.

MOCK TESTS ARE EPHEMERAL, NOT Exam ROWS
---------------------------------------
A mock test is student-initiated and can be taken repeatedly, so materialising one as
an Exam would fill the teacher's exam list with rows they never made and did not want.
Instead a mock is assembled on demand from the question bank and carried in a signed-
ish token, exactly like the study-mode Test: the seed and the chosen question ids go
out with the paper and come back on submit, so grading rebuilds the identical test
server-side. The only thing persisted is the StudySession row, which is what the
analytics below read.

WEAK-CONCEPT WEIGHTING
----------------------
A mock test is only useful if it spends its questions where the student is actually
losing marks. Question selection is therefore biased by ConceptMastery: concepts the
student has never been assessed on, or scores poorly in, get proportionally more
questions. The bias is a weight, not a filter - a mock test that only ever asked about
weak areas would stop being a mock of the real exam, which covers everything.

ANALYTICS READ, THEY DO NOT COMPUTE
-----------------------------------
Every figure here is derived from rows other features already write: MasteryEvidence
(assignments, quizzes, exams), StudySession (learn/test/match/mock) and StudentPoints
(streaks). Nothing double-counts, and no new write path was added - which is why these
numbers agree with the mastery and gamification views rather than drifting from them.
"""
import base64
import json
import logging
import random
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.models import (
    ConceptMastery, MasteryEvidence, QuestionBankItem, StudentPoints, StudySession,
)
from app.question_bank import service as qb

logger = logging.getLogger("conceptintel.practice")

DEFAULT_MOCK_SIZE = 20
MAX_MOCK_SIZE = 60

# Weight applied to a concept's questions when picking a mock test. A concept the
# student has never been assessed on is the most valuable thing to ask about, so it
# outranks even a badly-failed one - you cannot revise what you have not met.
UNSEEN_WEIGHT = 3.0
MIN_WEIGHT = 0.5


def _mastery_by_concept(db: Session, student_id: int, course_id: int) -> Dict[str, float]:
    rows = db.query(ConceptMastery.concept_node_id, ConceptMastery.mastery_score).filter(
        ConceptMastery.student_id == student_id, ConceptMastery.course_id == course_id
    ).all()
    return {node_id: float(score or 0.0) for node_id, score in rows}


def _weight_for(concept_node_id: Optional[str], mastery: Dict[str, float]) -> float:
    """Higher weight = more likely to be asked. Unseen beats weak beats strong."""
    if not concept_node_id or concept_node_id not in mastery:
        return UNSEEN_WEIGHT
    score = mastery[concept_node_id]
    # 0% mastery -> 2.0, 50% -> 1.25, 100% -> 0.5
    return max(MIN_WEIGHT, 2.0 - (score / 100.0) * 1.5)


def assemble_mock_test(
    db: Session, student_id: int, course_id: int, size: int = DEFAULT_MOCK_SIZE,
    seed: Optional[int] = None,
) -> Tuple[List[QuestionBankItem], int]:
    """Picks questions for a mock test, biased towards what this student is weakest at.

    Returns (questions, seed). Raises ValueError when the bank is empty, because a
    mock test with no questions is a bug the student should be told about rather than
    an empty paper.
    """
    seed = seed if seed is not None else random.randint(1, 2_000_000_000)
    rng = random.Random(seed)

    pool = db.query(QuestionBankItem).filter(
        QuestionBankItem.course_id == course_id,
        QuestionBankItem.status == "Approved",
    ).all()
    if not pool:
        raise ValueError(
            "This course's question bank is empty, so there is nothing to build a mock test "
            "from. Ask your instructor to add questions."
        )

    mastery = _mastery_by_concept(db, student_id, course_id)
    size = max(1, min(size, min(MAX_MOCK_SIZE, len(pool))))

    # Weighted sampling WITHOUT replacement: draw one at a time, removing each pick, so
    # a heavily-weighted concept cannot fill the paper with the same question twice.
    remaining = list(pool)
    weights = [_weight_for(q.concept_node_id, mastery) for q in remaining]
    chosen: List[QuestionBankItem] = []
    for _ in range(size):
        if not remaining:
            break
        total = sum(weights)
        if total <= 0:
            pick = rng.randrange(len(remaining))
        else:
            r = rng.uniform(0, total)
            upto = 0.0
            pick = len(remaining) - 1
            for i, w in enumerate(weights):
                upto += w
                if upto >= r:
                    pick = i
                    break
        chosen.append(remaining.pop(pick))
        weights.pop(pick)

    return chosen, seed


def make_mock_token(question_ids: List[int], seed: int) -> str:
    raw = json.dumps({"q": question_ids, "s": seed}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def read_mock_token(token: str) -> Tuple[List[int], int]:
    try:
        padded = token + "=" * (-len(token) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return [int(i) for i in data["q"]], int(data["s"])
    except Exception:
        raise ValueError("This mock test has expired or is invalid. Start a new one.")


def serve_mock_questions(questions: List[QuestionBankItem], seed: int) -> List[Dict[str, Any]]:
    """Student-facing form of each question - identical shape to an exam's, so the
    frontend reuses one player component for both."""
    served = []
    for item in questions:
        try:
            payload = json.loads(item.payload_json) or {}
        except (json.JSONDecodeError, TypeError):
            continue
        q_rng = random.Random(seed * 1000003 + item.id)
        public = qb.public_payload(item.question_type, payload, shuffle=True, rng=q_rng)
        served.append({
            "id": item.id,
            "question_type": item.question_type,
            "prompt": item.prompt,
            "points": item.points or 1,
            "difficulty": item.difficulty or "Medium",
            "concept_name": item.concept_name,
            "time_limit_seconds": item.time_limit_seconds,
            **public,
        })
    return served


def grade_mock(
    questions: List[QuestionBankItem], seed: int, responses: Dict[str, Any],
) -> Dict[str, Any]:
    """Grades a mock test and returns a breakdown by concept and by difficulty - the
    part a student actually acts on."""
    served = {s["id"]: s for s in serve_mock_questions(questions, seed)}

    points_earned = points_possible = 0.0
    per_question: List[Dict[str, Any]] = []
    by_concept: Dict[str, Dict[str, float]] = defaultdict(lambda: {"earned": 0.0, "possible": 0.0})
    by_difficulty: Dict[str, Dict[str, float]] = defaultdict(lambda: {"earned": 0.0, "possible": 0.0})

    for item in questions:
        try:
            payload = json.loads(item.payload_json) or {}
        except (json.JSONDecodeError, TypeError):
            continue
        weight = float(item.points or 1)
        points_possible += weight

        raw = responses.get(str(item.id), responses.get(item.id))
        answered = raw is not None
        full, fraction = qb.grade(
            item.question_type, payload, raw, served=served.get(item.id)
        ) if answered else (False, 0.0)
        earned = round(weight * fraction, 4)
        points_earned += earned

        concept = item.concept_name or "Unassigned"
        by_concept[concept]["earned"] += earned
        by_concept[concept]["possible"] += weight
        diff = item.difficulty or "Medium"
        by_difficulty[diff]["earned"] += earned
        by_difficulty[diff]["possible"] += weight

        per_question.append({
            "id": item.id,
            "prompt": item.prompt,
            "question_type": item.question_type,
            "concept_name": item.concept_name,
            "difficulty": diff,
            "points": weight,
            "points_earned": earned,
            "correct": full,
            "answered": answered,
            "explanation": item.explanation or "",
        })

    score = round((points_earned / points_possible) * 100, 2) if points_possible else 0.0

    def _pct(d: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
        out = []
        for name, v in d.items():
            pct = round((v["earned"] / v["possible"]) * 100, 1) if v["possible"] else 0.0
            out.append({"name": name, "accuracy": pct, "points_possible": round(v["possible"], 2)})
        return sorted(out, key=lambda x: x["accuracy"])

    return {
        "score": score,
        "points_earned": round(points_earned, 2),
        "points_possible": round(points_possible, 2),
        "per_question": per_question,
        "by_concept": _pct(by_concept),
        "by_difficulty": _pct(by_difficulty),
    }


# ─────────────────────────────── analytics ────────────────────────────

def build_analytics(db: Session, student_id: int, course_id: int, days: int = 30) -> Dict[str, Any]:
    """Everything the practice dashboard shows, derived from rows other features write.

    `weakest` is intentionally ordered by mastery ascending and limited: a list of
    every concept sorted by score is a data dump, whereas the five you are worst at is
    a study plan.
    """
    since = datetime.utcnow() - timedelta(days=max(1, min(days, 365)))

    mastery_rows = db.query(ConceptMastery).filter(
        ConceptMastery.student_id == student_id, ConceptMastery.course_id == course_id
    ).all()
    concepts = [
        {
            "concept_node_id": m.concept_node_id,
            "concept_name": m.concept_name,
            "mastery": round(float(m.mastery_score or 0), 1),
            "evidence_count": m.evidence_count or 0,
        }
        for m in mastery_rows
    ]
    concepts.sort(key=lambda c: c["mastery"])

    sessions = db.query(StudySession).filter(
        StudySession.student_id == student_id,
        StudySession.course_id == course_id,
        StudySession.created_at >= since,
    ).order_by(StudySession.created_at.asc()).all()

    by_mode: Dict[str, Dict[str, float]] = defaultdict(lambda: {"count": 0, "score_sum": 0.0})
    trend: List[Dict[str, Any]] = []
    for s in sessions:
        by_mode[s.mode]["count"] += 1
        by_mode[s.mode]["score_sum"] += float(s.score or 0)
        trend.append({
            "date": s.created_at.date().isoformat() if s.created_at else None,
            "mode": s.mode,
            "score": round(float(s.score or 0), 1),
        })

    evidence = db.query(MasteryEvidence).filter(
        MasteryEvidence.student_id == student_id,
        MasteryEvidence.course_id == course_id,
        MasteryEvidence.created_at >= since,
    ).order_by(MasteryEvidence.created_at.asc()).all()
    assessment_trend = [
        {
            "date": e.created_at.date().isoformat() if e.created_at else None,
            "source": e.source_type,
            "score": round(float(e.score or 0), 1),
            "concept_name": e.concept_name,
        }
        for e in evidence
    ]

    points = db.query(StudentPoints).filter(
        StudentPoints.student_id == student_id, StudentPoints.course_id == course_id
    ).first()

    # Distinct calendar days with any practice, over the window - the honest measure
    # of "have you been showing up", independent of the points streak.
    active_days = db.query(func.count(func.distinct(func.date(StudySession.created_at)))).filter(
        StudySession.student_id == student_id,
        StudySession.course_id == course_id,
        StudySession.created_at >= since,
    ).scalar() or 0

    return {
        "window_days": days,
        "concepts": concepts,
        "weakest": concepts[:5],
        "strongest": list(reversed(concepts[-5:])) if concepts else [],
        "mode_breakdown": [
            {
                "mode": mode,
                "sessions": int(v["count"]),
                "average_score": round(v["score_sum"] / v["count"], 1) if v["count"] else 0.0,
            }
            for mode, v in sorted(by_mode.items())
        ],
        "practice_trend": trend,
        "assessment_trend": assessment_trend,
        "total_sessions": len(sessions),
        "active_days": int(active_days),
        "current_streak_days": points.current_streak_days if points else 0,
        "longest_streak_days": points.longest_streak_days if points else 0,
        "total_points": points.total_points if points else 0,
    }
