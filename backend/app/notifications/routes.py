from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Notification, User
from app.notifications.schemas import (
    NotificationResponse,
    NotificationListResponse,
    UnreadCountResponse,
    BulkActionResponse,
)
from app.auth.routes import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Paginated, newest-first list of the current user's own notifications. Scoped
    strictly to current_user.id - there is no admin "view any user's notifications"
    path, these are private by design."""
    base_query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        base_query = base_query.filter(Notification.is_read == False)  # noqa: E712

    total = base_query.count()
    unread_count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    items = (
        base_query.order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return NotificationListResponse(items=items, unread_count=unread_count, total=total)


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight endpoint meant for frequent polling (badge count) without paying
    for the full list query every time."""
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    return UnreadCountResponse(unread_count=count)


def _get_owned_notification(db: Session, notification_id: int, user_id: int) -> Notification:
    notif = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return notif


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = _get_owned_notification(db, notification_id, current_user.id)
    if not notif.is_read:
        notif.is_read = True
        notif.read_at = datetime.utcnow()
        db.commit()
        db.refresh(notif)
    return notif


@router.post("/read-all", response_model=BulkActionResponse)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True, "read_at": datetime.utcnow()}, synchronize_session=False)
    )
    db.commit()
    return BulkActionResponse(updated=updated)


@router.delete("/read", response_model=BulkActionResponse)
def clear_read_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk-delete every already-read notification for the current user - lets the
    bell dropdown offer a "Clear read" cleanup action instead of the list growing
    unbounded forever."""
    deleted = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == True)  # noqa: E712
        .delete(synchronize_session=False)
    )
    db.commit()
    return BulkActionResponse(deleted=deleted)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = _get_owned_notification(db, notification_id, current_user.id)
    db.delete(notif)
    db.commit()
    return None
