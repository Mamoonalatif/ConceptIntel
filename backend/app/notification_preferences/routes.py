from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import NotificationPreference, User
from app.notification_preferences.schemas import NotificationPreferenceResponse, NotificationPreferenceUpdate
from app.auth.routes import get_current_user

router = APIRouter(prefix="/notification-preferences", tags=["Notification Preferences"])


def _get_or_create_preference(db: Session, user_id: int) -> NotificationPreference:
    pref = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    if pref is None:
        # All columns default True at the DB level, so a bare insert already gives
        # the Classroom-style "everything on until you opt out" starting point.
        pref = NotificationPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


@router.get("/me", response_model=NotificationPreferenceResponse)
def get_my_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the current user's notification preferences, creating a default
    (all-enabled) row on first access if none exists yet."""
    return _get_or_create_preference(db, current_user.id)


@router.patch("/me", response_model=NotificationPreferenceResponse)
def update_my_preferences(
    payload: NotificationPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partial update - only the fields included in the request body are changed."""
    pref = _get_or_create_preference(db, current_user.id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(pref, field, value)
    db.commit()
    db.refresh(pref)
    return pref
