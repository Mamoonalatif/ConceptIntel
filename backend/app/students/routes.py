from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Assignment, AssignmentSubmission, Enrollment, Course, User
from app.students.schemas import TodoItem
from app.auth.routes import get_current_student

router = APIRouter(prefix="/students", tags=["Student To-Do"])


def _submission_status(assignment: Assignment, submission: Optional[AssignmentSubmission]) -> str:
    if submission is None:
        return "missing"
    if submission.is_late:
        return "late"
    return "submitted"


@router.get("/me/todo", response_model=List[TodoItem])
def get_my_todo(
    sort: str = Query("due_date", pattern="^(due_date|course)$"),
    filter: Optional[str] = Query(None, pattern="^(upcoming|missing|done)$"),
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """Aggregates every Assignment across the student's Active enrollments, joined
    with (if any) their own AssignmentSubmission, into a single to-do list - the
    Google-Classroom-style "To-do" view. `sort` controls ordering, `filter` narrows
    to upcoming (due in the future and not yet submitted), missing (past due and not
    submitted), or done (submitted, regardless of on-time/late)."""
    rows = (
        db.query(Assignment, Course, AssignmentSubmission)
        .join(Course, Assignment.course_id == Course.id)
        .join(
            Enrollment,
            (Enrollment.course_id == Course.id) & (Enrollment.student_id == current_student.id) & (Enrollment.status == "Active"),
        )
        .outerjoin(
            AssignmentSubmission,
            (AssignmentSubmission.assignment_id == Assignment.id) & (AssignmentSubmission.student_id == current_student.id),
        )
        .all()
    )

    now = datetime.utcnow()
    items: List[TodoItem] = []
    for assignment, course, submission in rows:
        sub_status = _submission_status(assignment, submission)
        items.append(TodoItem(
            assignment_id=assignment.id,
            course_id=course.id,
            course_name=course.name,
            title=assignment.title,
            due_date=assignment.due_date,
            points=assignment.points,
            status=sub_status,
            submitted_at=submission.submitted_at if submission else None,
            grade=submission.grade if submission else None,
        ))

    if filter == "done":
        items = [i for i in items if i.status in ("submitted", "late")]
    elif filter == "missing":
        items = [i for i in items if i.status == "missing" and i.due_date and i.due_date < now]
    elif filter == "upcoming":
        items = [i for i in items if i.status == "missing" and (i.due_date is None or i.due_date >= now)]

    if sort == "course":
        items.sort(key=lambda i: (i.course_name.lower(), i.due_date is None, i.due_date or now))
    else:
        items.sort(key=lambda i: (i.due_date is None, i.due_date or now))

    return items
