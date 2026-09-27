from datetime import datetime
from pydantic import BaseModel


class BadgeOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    icon: str
    points_reward: int

    class Config:
        from_attributes = True


class EarnedBadgeOut(BaseModel):
    badge: BadgeOut
    course_id: int | None
    earned_at: datetime


class LeaderboardEntry(BaseModel):
    student_id: int
    student_name: str
    total_points: int
    current_streak_days: int
    rank: int


class MyGamificationSummary(BaseModel):
    course_id: int
    total_points: int
    current_streak_days: int
    longest_streak_days: int
    badges: list[BadgeOut]
