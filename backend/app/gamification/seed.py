"""Fixed, rule-based badge catalog - see app/gamification/service.py for the
deterministic check that awards each one. No AI involved: a rewards system needs
to be fair and reproducible, not subject to LLM variance."""

BADGE_CATALOG = [
    {"code": "first_steps", "name": "First Steps", "icon": "🌱",
     "description": "Complete your first graded quiz or assignment.", "points_reward": 10},
    {"code": "perfectionist", "name": "Perfectionist", "icon": "💯",
     "description": "Score a perfect 100 on a quiz or assignment.", "points_reward": 25},
    {"code": "quiz_streak_3", "name": "Quiz Streak", "icon": "🔥",
     "description": "Score 80 or higher on 3 quizzes in one course.", "points_reward": 30},
    {"code": "concept_master", "name": "Concept Master", "icon": "🧠",
     "description": "Reach 90+ mastery on any single concept.", "points_reward": 20},
    {"code": "course_champion", "name": "Course Champion", "icon": "🏆",
     "description": "Average 85+ mastery across at least 3 concepts in a course.", "points_reward": 50},
    {"code": "on_a_roll", "name": "On a Roll", "icon": "⚡",
     "description": "Keep a 3-day activity streak.", "points_reward": 15},
    {"code": "consistent_learner", "name": "Consistent Learner", "icon": "📅",
     "description": "Keep a 7-day activity streak.", "points_reward": 40},
]


def seed_badges(db):
    """Idempotent - only inserts badges whose code doesn't already exist, so
    re-running on every startup is safe and new badges can be added later without
    touching already-earned ones."""
    from app.database.models import Badge

    existing_codes = {row[0] for row in db.query(Badge.code).all()}
    for entry in BADGE_CATALOG:
        if entry["code"] not in existing_codes:
            db.add(Badge(**entry))
    db.commit()
