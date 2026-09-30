# Pydantic response models for gamification endpoints (badges, leaderboard, summary).
from datetime import datetime
from pydantic import BaseModel


class BadgeOut(BaseModel):
    """A badge from the catalog as returned to the client."""
    id: int
    code: str
    name: str
    description: str
    icon: str
    points_reward: int

    class Config:
        from_attributes = True


class EarnedBadgeOut(BaseModel):
    """A badge together with when and where (course) a student earned it."""
    badge: BadgeOut
    course_id: int | None
    earned_at: datetime


class LeaderboardEntry(BaseModel):
    """One ranked row of a course leaderboard."""
    student_id: int
    student_name: str
    total_points: int
    current_streak_days: int
    rank: int


class MyGamificationSummary(BaseModel):
    """A student's points, streaks and badges for one course."""
    course_id: int
    total_points: int
    current_streak_days: int
    longest_streak_days: int
    badges: list[BadgeOut]
