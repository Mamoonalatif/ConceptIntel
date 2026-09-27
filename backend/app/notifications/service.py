import threading
from typing import List, Optional
from sqlalchemy.orm import Session
from app.database.models import Notification, NotificationPreference, Enrollment, User
from app.notifications.types import DEFAULT_PRIORITY, NotificationType
from app.email_service import send_notification_email

# All emitters are best-effort: a notification failure must never break the
# business operation that triggered it (enrollment, upload processing, etc.), so
# every call site wraps these in try/except. These helpers themselves stay simple
# and let that wrapping happen at the call site rather than swallowing errors here.

def _dispatch_email_async(email: str, full_name: str, title: str, message: str, link: Optional[str] = None):
    """Dispatches email notification in a background thread so it never blocks the request."""
    if not email:
        return
    thread = threading.Thread(
        target=send_notification_email,
        args=(email, full_name or email, title, message, link),
        daemon=True,
    )
    thread.start()


# Maps each NotificationType to the NotificationPreference boolean column that
# gates it (see app/database/models.py NotificationPreference for the full mapping
# rationale). A type with no entry here is never gated (always created) - reserved
# for events with no sensible opt-out, though currently every type is mapped.
NOTIFICATION_TYPE_TO_PREFERENCE_FIELD = {
    NotificationType.ANNOUNCEMENT_POSTED: "course_posts",
    NotificationType.MATERIAL_POSTED: "course_posts",
    NotificationType.MEETING_POSTED: "course_posts",
    NotificationType.NEW_COURSE_CONTENT: "course_posts",
    NotificationType.ASSIGNMENT_POSTED: "assignment_updates",
    NotificationType.ASSIGNMENT_SUBMITTED: "grading_updates",
    NotificationType.ASSIGNMENT_GRADED: "grading_updates",
    NotificationType.ENROLLMENT_JOINED: "enrollment_updates",
    NotificationType.ENROLLMENT_NEW_STUDENT: "enrollment_updates",
    NotificationType.FILE_PROCESSING_COMPLETED: "content_processing_updates",
    NotificationType.CONTENT_GENERATION_READY: "content_processing_updates",
    NotificationType.CONTENT_GENERATION_FAILED: "content_processing_updates",
    NotificationType.FILE_PROCESSING_FAILED: "content_processing_updates",
    NotificationType.GRAPH_APPROVED: "content_processing_updates",
    NotificationType.GRAPH_REJECTED: "content_processing_updates",
    NotificationType.TEACHER_REQUEST_SUBMITTED: "system_updates",
    NotificationType.ACCOUNT_APPROVED: "system_updates",
    NotificationType.COMMENT_POSTED: "course_posts",
}


def _is_notification_allowed(db: Session, user_id: int, type: str) -> bool:
    """Checks the user's NotificationPreference row (if any) for the column that
    gates `type`. No row yet (user never opened the settings page) or no mapping
    for this type both mean "allowed" - the opt-out model only takes effect once a
    row exists and its column is explicitly False. This does NOT create a default
    row (that only happens via GET /notification-preferences/me) to keep this a
    cheap read on the hot notification-creation path."""
    field = NOTIFICATION_TYPE_TO_PREFERENCE_FIELD.get(type)
    if field is None:
        return True

    pref = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).first()
    if pref is None:
        return True
    return bool(getattr(pref, field, True))


def create_notification(
    db: Session,
    user_id: int,
    type: str,
    title: str,
    message: str,
    link: Optional[str] = None,
    priority: Optional[str] = None,
) -> Optional[Notification]:
    if not _is_notification_allowed(db, user_id, type):
        return None

    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        link=link,
        priority=priority or DEFAULT_PRIORITY.get(type, "info"),
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)

    # If notification preference is allowed, send email notification in background
    user = db.query(User).filter(User.id == user_id).first()
    if user and user.email:
        _dispatch_email_async(user.email, user.full_name, title, message, link)

    return notif


def notify_many(
    db: Session,
    user_ids: List[int],
    type: str,
    title: str,
    message: str,
    link: Optional[str] = None,
    priority: Optional[str] = None,
) -> List[Notification]:
    """Bulk variant of create_notification - one commit for the whole batch instead
    of one round trip per recipient (e.g. notifying every enrolled student about
    new course content). Recipients who have opted out of this type's category are
    silently skipped."""
    unique_ids = {uid for uid in user_ids if uid is not None}
    if not unique_ids:
        return []

    allowed_ids = {uid for uid in unique_ids if _is_notification_allowed(db, uid, type)}
    if not allowed_ids:
        return []

    resolved_priority = priority or DEFAULT_PRIORITY.get(type, "info")
    notifs = [
        Notification(user_id=uid, type=type, title=title, message=message, link=link, priority=resolved_priority)
        for uid in allowed_ids
    ]
    db.add_all(notifs)
    db.commit()

    # Dispatch email notifications for all allowed recipients in background
    users = db.query(User).filter(User.id.in_(allowed_ids)).all()
    for user in users:
        if user and user.email:
            _dispatch_email_async(user.email, user.full_name, title, message, link)

    return notifs


def notify_course_students(
    db: Session,
    course_id: int,
    type: str,
    title: str,
    message: str,
    link: Optional[str] = None,
    priority: Optional[str] = None,
) -> List[Notification]:
    student_ids = [
        row.student_id
        for row in db.query(Enrollment.student_id)
        .filter(Enrollment.course_id == course_id, Enrollment.status == "Active")
        .all()
    ]
    return notify_many(db, student_ids, type, title, message, link, priority)


def notify_admins(
    db: Session,
    type: str,
    title: str,
    message: str,
    link: Optional[str] = None,
    priority: Optional[str] = None,
) -> List[Notification]:
    admin_ids = [row.id for row in db.query(User.id).filter(User.role == "admin").all()]
    return notify_many(db, admin_ids, type, title, message, link, priority)
