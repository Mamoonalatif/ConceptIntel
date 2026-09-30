# Comment endpoints: private student-teacher comment threads on assignments, announcements and materials.
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Comment, Course, Assignment, Announcement, Material, User
from app.comments.schemas import CommentCreate, CommentResponse
from app.auth.routes import get_current_user
from app.courses.access import assert_course_access
from app.notifications.service import create_notification
from app.notifications.types import NotificationType

router = APIRouter(prefix="/courses/{course_id}/comments", tags=["Comments"])

# Maps a comment's target_type string to the table that holds that post.
_TARGET_MODELS = {
    "assignment": Assignment,
    "announcement": Announcement,
    "material": Material,
}


# Fetches a course by ID or raises 404.
def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


# Checks the target type is supported and that the post exists in this course.
def _get_target_or_404(db: Session, course_id: int, target_type: str, target_id: int):
    model = _TARGET_MODELS.get(target_type)
    if model is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported comment target type")
    target = db.query(model).filter(model.id == target_id, model.course_id == course_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{target_type.capitalize()} not found")
    return target


# Converts a Comment ORM row into the API response model (adds author name and is_own).
def _to_response(c: Comment, current_user: User) -> CommentResponse:
    return CommentResponse(
        id=c.id,
        course_id=c.course_id,
        target_type=c.target_type,
        target_id=c.target_id,
        author_id=c.author_id,
        author_name=c.author.full_name if c.author else "Unknown",
        is_own=c.author_id == current_user.id,
        content=c.content,
        created_at=c.created_at,
    )


# GET /courses/{id}/comments - one thread; students see only their own and the teacher's comments (see docstring).
@router.get("", response_model=List[CommentResponse])
def list_comments(
    course_id: int,
    target_type: str,
    target_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns one private thread. The course's teacher sees every thread on
    their content; a student only ever sees their own thread - other
    students' comments on the same assignment/announcement stay invisible to
    them, matching the "private note between a student and their teacher"
    model rather than a public reply feed."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _get_target_or_404(db, course_id, target_type, target_id)

    query = db.query(Comment).filter(
        Comment.course_id == course_id,
        Comment.target_type == target_type,
        Comment.target_id == target_id,
    )
    is_owner_teacher = course.teacher_id == current_user.id
    if not is_owner_teacher and current_user.role.lower() != "admin":
        query = query.filter(
            (Comment.author_id == current_user.id) | (Comment.author_id == course.teacher_id)
        )
    comments = query.order_by(Comment.created_at.asc()).all()
    return [_to_response(c, current_user) for c in comments]


# POST /courses/{id}/comments - adds a comment, then notifies the other side of the thread.
@router.post("", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    course_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    _get_target_or_404(db, course_id, payload.target_type, payload.target_id)

    comment = Comment(
        course_id=course_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        author_id=current_user.id,
        content=payload.content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # Notify "the other side" of the thread: a student's comment notifies the
    # teacher, the teacher's reply notifies that student back.
    try:
        if current_user.id == course.teacher_id:
            recipient_id = (
                db.query(Comment.author_id)
                .filter(
                    Comment.course_id == course_id,
                    Comment.target_type == payload.target_type,
                    Comment.target_id == payload.target_id,
                    Comment.author_id != course.teacher_id,
                )
                .order_by(Comment.created_at.desc())
                .first()
            )
            if recipient_id:
                create_notification(
                    db, recipient_id[0], NotificationType.COMMENT_POSTED,
                    "New reply from your teacher",
                    f"{current_user.full_name} replied to your comment on {course.name}.",
                    link=f"/course/{course_id}",
                )
        else:
            create_notification(
                db, course.teacher_id, NotificationType.COMMENT_POSTED,
                "New student comment",
                f"{current_user.full_name} commented on {course.name}.",
                link=f"/course/{course_id}",
            )
    except Exception:
        pass

    return _to_response(comment, current_user)
