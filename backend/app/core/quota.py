"""A blunt per-user, per-calendar-day cap on token-spending "Generate" actions.

Every LLM call in this app is already gated behind an explicit user action (see
the module docstrings in content_generation/, question_bank/generation.py,
gamification/game_service.py) - nothing fires on its own. What isn't guarded is
repetition: nothing stops one account from clicking Generate 50 times in a row.
This is that backstop - a simple daily counter, not a token-accurate budget.
"""
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import DailyGenerationUsage


def check_and_increment(db: Session, user_id: int) -> None:
    """Raises 429 if this user has already hit today's generation cap, otherwise
    increments today's count. Call this right before an LLM-spending action -
    never after, since a failed generation still shouldn't refund the click but a
    request that never reaches the model shouldn't count against the cap either.

    DAILY_GENERATION_LIMIT=0 disables the cap entirely (useful for local dev)."""
    limit = settings.DAILY_GENERATION_LIMIT
    if limit <= 0:
        return

    today = date.today()
    row = db.query(DailyGenerationUsage).filter(
        DailyGenerationUsage.user_id == user_id,
        DailyGenerationUsage.usage_date == today,
    ).first()

    if row and row.count >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"You've reached today's limit of {limit} AI generations. "
                "This resets at midnight - it's a safeguard against runaway API "
                "spend, not a reflection of your course's quality."
            ),
        )

    if row is None:
        db.add(DailyGenerationUsage(user_id=user_id, usage_date=today, count=1))
    else:
        row.count += 1
    # Caller commits alongside its own writes, same as mastery/gamification calls
    # elsewhere in this codebase - this is not its own transaction.
