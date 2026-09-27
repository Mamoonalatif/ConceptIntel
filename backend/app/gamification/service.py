"""Points, streaks, and badge awarding - the Gamification module. Deliberately
rule-based (plain code, no AI): a rewards system needs to be deterministic and
fair, not subject to LLM variance. Called from wherever a student's work gets
graded (app/assignments/routes.py grade_submission, app/content_generation/routes.py
submit_quiz_attempt) - never called directly by the frontend.
"""
from datetime import date, timedelta
from typing import List

from sqlalchemy.orm import Session

from app.database.models import (
    Badge, StudentBadge, StudentPoints, PointsLedgerEntry, ConceptMastery,
)


def _get_or_create_points_row(db: Session, student_id: int, course_id: int) -> StudentPoints:
    row = (
        db.query(StudentPoints)
        .filter(StudentPoints.student_id == student_id, StudentPoints.course_id == course_id)
        .first()
    )
    if row is None:
        row = StudentPoints(student_id=student_id, course_id=course_id)
        db.add(row)
        db.flush()
    return row


def _update_streak(row: StudentPoints, today: date) -> None:
    """Simple daily-activity streak: consecutive calendar days with at least one
    graded quiz/assignment. A gap of more than 1 day resets it to 1 (today counts).
    Multiple activities on the same day don't inflate the streak."""
    if row.last_activity_date == today:
        return  # already counted today
    if row.last_activity_date == today - timedelta(days=1):
        row.current_streak_days += 1
    else:
        row.current_streak_days = 1
    row.longest_streak_days = max(row.longest_streak_days, row.current_streak_days)
    row.last_activity_date = today


def award_points(
    db: Session, student_id: int, course_id: int, points: int, reason: str, source_type: str, source_id: int,
) -> StudentPoints:
    """Adds points, updates the activity streak, and checks for newly-earned
    badges - the single entry point grading code should call. Returns the updated
    StudentPoints row (caller is responsible for db.commit())."""
    row = _get_or_create_points_row(db, student_id, course_id)
    row.total_points += points
    _update_streak(row, date.today())

    db.add(PointsLedgerEntry(
        student_id=student_id, course_id=course_id, points=points,
        reason=reason, source_type=source_type, source_id=source_id,
    ))
    db.flush()

    check_and_award_badges(db, student_id, course_id)
    return row


def _award_if_new(db: Session, student_id: int, course_id: int, badge_code: str) -> None:
    badge = db.query(Badge).filter(Badge.code == badge_code).first()
    if not badge:
        return  # catalog not seeded yet - fails safe rather than crashing grading
    already_earned = (
        db.query(StudentBadge)
        .filter(
            StudentBadge.student_id == student_id,
            StudentBadge.badge_id == badge.id,
            StudentBadge.course_id == course_id,
        )
        .first()
    )
    if already_earned:
        return
    db.add(StudentBadge(student_id=student_id, badge_id=badge.id, course_id=course_id))
    # The badge's own point reward is a separate ledger entry, not a recursive
    # award_points call, so it can never itself trigger another badge check loop.
    row = _get_or_create_points_row(db, student_id, course_id)
    row.total_points += badge.points_reward
    db.add(PointsLedgerEntry(
        student_id=student_id, course_id=course_id, points=badge.points_reward,
        reason=f"Earned badge: {badge.name}", source_type="badge", source_id=badge.id,
    ))


def check_and_award_badges(db: Session, student_id: int, course_id: int) -> None:
    """Deterministic checks against real data - see app/gamification/seed.py for
    what each code means. Cheap to call after every grading event since each check
    is a single aggregate query."""
    from app.database.models import MasteryEvidence, QuizAttempt

    evidence_count = (
        db.query(MasteryEvidence)
        .filter(MasteryEvidence.student_id == student_id, MasteryEvidence.course_id == course_id)
        .count()
    )
    if evidence_count >= 1:
        _award_if_new(db, student_id, course_id, "first_steps")

    has_perfect = (
        db.query(MasteryEvidence)
        .filter(MasteryEvidence.student_id == student_id, MasteryEvidence.course_id == course_id, MasteryEvidence.score >= 100)
        .first()
    )
    if has_perfect:
        _award_if_new(db, student_id, course_id, "perfectionist")

    high_quiz_count = (
        db.query(QuizAttempt)
        .filter(QuizAttempt.student_id == student_id, QuizAttempt.course_id == course_id, QuizAttempt.score >= 80)
        .count()
    )
    if high_quiz_count >= 3:
        _award_if_new(db, student_id, course_id, "quiz_streak_3")

    mastery_rows: List[ConceptMastery] = (
        db.query(ConceptMastery)
        .filter(ConceptMastery.student_id == student_id, ConceptMastery.course_id == course_id)
        .all()
    )
    if any(r.mastery_score >= 90 for r in mastery_rows):
        _award_if_new(db, student_id, course_id, "concept_master")

    if len(mastery_rows) >= 3 and (sum(r.mastery_score for r in mastery_rows) / len(mastery_rows)) >= 85:
        _award_if_new(db, student_id, course_id, "course_champion")

    points_row = _get_or_create_points_row(db, student_id, course_id)
    if points_row.current_streak_days >= 3:
        _award_if_new(db, student_id, course_id, "on_a_roll")
    if points_row.current_streak_days >= 7:
        _award_if_new(db, student_id, course_id, "consistent_learner")


def get_leaderboard(db: Session, course_id: int, limit: int = 10) -> List[StudentPoints]:
    return (
        db.query(StudentPoints)
        .filter(StudentPoints.course_id == course_id)
        .order_by(StudentPoints.total_points.desc())
        .limit(limit)
        .all()
    )


def get_student_badges(db: Session, student_id: int, course_id: int = None) -> List[StudentBadge]:
    query = db.query(StudentBadge).filter(StudentBadge.student_id == student_id)
    if course_id is not None:
        query = query.filter(StudentBadge.course_id == course_id)
    return query.order_by(StudentBadge.earned_at.desc()).all()
