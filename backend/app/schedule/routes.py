from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Course, CourseSchedule, User
from app.auth.routes import get_current_teacher, get_current_user
from app.courses.access import assert_course_access
from app.schedule import service as schedule_service
from app.schedule.schemas import CourseScheduleResponse, CourseScheduleUpdate, TodayTopicsResponse

router = APIRouter(prefix="/schedule", tags=["Course Schedule"])


def _get_owned_course(db: Session, course_id: int, current_teacher: User) -> Course:
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor.",
        )
    return course


@router.post("/course/{course_id}/generate", response_model=CourseScheduleResponse)
def generate_schedule(
    course_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """AI-generate a schedule from the course's uploaded outline - applied
    straight to the live schedule, visible to students immediately. No
    coordinator approval gate: a schedule is one teacher's own section plan."""
    _get_owned_course(db, course_id, current_teacher)
    schedule = schedule_service.generate_schedule_draft(db, course_id, current_teacher.id)
    return schedule_service.serialize_schedule(schedule)


@router.put("/course/{course_id}", response_model=CourseScheduleResponse)
def update_schedule(
    course_id: int,
    body: CourseScheduleUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """A teacher's hand-edited schedule (from scratch or refining a generated
    one) - applied straight to the live schedule, no approval step."""
    _get_owned_course(db, course_id, current_teacher)
    schedule = schedule_service.submit_schedule_edit(
        db, course_id, current_teacher.id, [s.model_dump() for s in body.sessions],
    )
    return schedule_service.serialize_schedule(schedule)


@router.get("/course/{course_id}", response_model=CourseScheduleResponse)
def get_schedule(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The course's schedule - visible to any course member, including students."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)

    schedule = db.query(CourseSchedule).filter(CourseSchedule.course_id == course_id).first()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No schedule has been created for this course yet.")
    return schedule_service.serialize_schedule(schedule)


@router.get("/course/{course_id}/today", response_model=TodayTopicsResponse)
def get_today_topics(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """What the schedule says this course teaches this week - the daily
    teaching-calendar signal, computed live from Course.start_date rather than a
    separately maintained "current week" field. Same visibility as the schedule
    itself: any course member, teacher or student. Empty/null fields (not a 404)
    when the course hasn't started yet or the schedule doesn't reach this far -
    that's a normal, expected state, not an error."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)

    today = schedule_service.get_today_topics(db, course_id)
    return today or {"course_id": course_id, "topics": []}
