# Calendar endpoint: assignment due dates and meeting times across the user's courses.
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Assignment, Course, Enrollment, Meeting, User
from app.calendar.schemas import CalendarEvent
from app.auth.routes import get_current_user

router = APIRouter(prefix="/calendar", tags=["Calendar"])


def _student_course_ids(db: Session, user: User) -> List[int]:
    """Same "active enrollment" join pattern as students/routes.py get_my_todo."""
    return [
        row[0] for row in (
            db.query(Course.id)
            .join(Enrollment, (Enrollment.course_id == Course.id) & (Enrollment.student_id == user.id) & (Enrollment.status == "Active"))
            .all()
        )
    ]


# IDs of courses the user teaches.
def _teacher_course_ids(db: Session, user: User) -> List[int]:
    return [row[0] for row in db.query(Course.id).filter(Course.teacher_id == user.id).all()]


# Builds date-sorted CalendarEvents (assignment due dates and meetings) for the given courses.
def _events_for_course_ids(db: Session, course_ids: List[int]) -> List[CalendarEvent]:
    if not course_ids:
        return []

    events: List[CalendarEvent] = []

    assignment_rows = (
        db.query(Assignment, Course)
        .join(Course, Assignment.course_id == Course.id)
        .filter(Assignment.course_id.in_(course_ids), Assignment.due_date.isnot(None))
        .all()
    )
    for assignment, course in assignment_rows:
        events.append(CalendarEvent(
            id=assignment.id,
            type="assignment",
            title=assignment.title,
            course_id=course.id,
            course_name=course.name,
            date=assignment.due_date,
            points=assignment.points,
        ))

    meeting_rows = (
        db.query(Meeting, Course)
        .join(Course, Meeting.course_id == Course.id)
        .filter(Meeting.course_id.in_(course_ids))
        .all()
    )
    for meeting, course in meeting_rows:
        events.append(CalendarEvent(
            id=meeting.id,
            type="meeting",
            title=meeting.title,
            course_id=course.id,
            course_name=course.name,
            date=meeting.scheduled_at,
            meeting_link=meeting.meeting_link,
        ))

    events.sort(key=lambda e: e.date)
    return events


# GET /calendar/me - events for the student's enrollments or the staff user's taught courses.
@router.get("/me", response_model=List[CalendarEvent])
def get_my_calendar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregated calendar - Assignment due dates + Meeting times - across every
    course the current user has a stake in, the Google-Classroom-Calendar-style
    view. A student sees their active enrollments; a teacher sees the courses they
    teach. Admin/program/course coordinator aren't this feature's primary audience
    (per platform design, oversight roles aren't tied to a fixed set of courses the
    same way), so they get their own taught courses if any (usually none), otherwise
    an empty list rather than every course platform-wide."""
    role = current_user.role.lower()

    if role == "student":
        course_ids = _student_course_ids(db, current_user)
    elif role in ("teacher", "admin", "program_coordinator", "course_coordinator"):
        # Reuses the same "courses I teach" lookup for every staff-ish role - only
        # ever non-empty for an actual teacher (or a staff account that also
        # happens to teach a course), which is the desired behavior here.
        course_ids = _teacher_course_ids(db, current_user)
    else:
        course_ids = []

    return _events_for_course_ids(db, course_ids)
