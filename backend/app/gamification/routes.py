from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Badge, Course, StudentPoints, User
from app.gamification.schemas import BadgeOut, LeaderboardEntry, MyGamificationSummary
from app.gamification import service as gamification_service
from app.auth.routes import get_current_user, get_current_student
from app.courses.access import assert_course_access
from app.core import simple_cache

router = APIRouter(prefix="/courses", tags=["Gamification"])
catalog_router = APIRouter(prefix="/gamification", tags=["Gamification"])


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


@router.get("/{course_id}/gamification/leaderboard", response_model=list[LeaderboardEntry])
def get_leaderboard(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Top students by points in this course - visible to everyone with course
    access (students see their classmates' rank, same as a real classroom
    leaderboard would work)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    def _compute():
        rows = gamification_service.get_leaderboard(db, course_id, limit=20)
        return [
            LeaderboardEntry(
                student_id=r.student_id,
                student_name=r.student.full_name if r.student else "Unknown",
                total_points=r.total_points,
                current_streak_days=r.current_streak_days,
                rank=i + 1,
            )
            for i, r in enumerate(rows)
        ]

    # Short TTL - every student viewing a course sees the same leaderboard, so
    # this absorbs repeat loads without meaningfully stale rankings (same
    # tradeoff a real game leaderboard makes).
    return simple_cache.get_or_compute(f"gamification:leaderboard:{course_id}", ttl_seconds=10, compute=_compute)


@router.get("/{course_id}/gamification/my-summary", response_model=MyGamificationSummary)
def get_my_summary(
    course_id: int,
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """The current student's own points/streak/badges for this course - what
    drives their gamification widget on the course page."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_student)

    points_row = (
        db.query(StudentPoints)
        .filter(StudentPoints.student_id == current_student.id, StudentPoints.course_id == course_id)
        .first()
    )
    badges = gamification_service.get_student_badges(db, current_student.id, course_id)

    return MyGamificationSummary(
        course_id=course_id,
        total_points=points_row.total_points if points_row else 0,
        current_streak_days=points_row.current_streak_days if points_row else 0,
        longest_streak_days=points_row.longest_streak_days if points_row else 0,
        badges=[BadgeOut.model_validate(sb.badge) for sb in badges],
    )


@catalog_router.get("/badges", response_model=list[BadgeOut])
def list_all_badges(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """The full badge catalog (earned or not) - lets students see what's still
    achievable, Duolingo-style."""
    return db.query(Badge).all()
