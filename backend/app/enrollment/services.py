import re
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database.models import Course, Enrollment, User

# Enrollment codes are generated as 8-character uppercase alphanumeric strings
# (see courses/routes.py generate_unique_code) - validate against that same shape.
ENROLLMENT_CODE_LENGTH = 8
ENROLLMENT_CODE_PATTERN = re.compile(r"^[A-Z0-9]+$")


class EnrollmentError(Exception):
    """Structured enrollment validation/business-rule failure. Carries the HTTP
    status code and user-facing message the route should surface, so the route
    stays a thin translation layer instead of re-implementing this logic."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _validate_code_format(raw_code: str) -> str:
    code = (raw_code or "").strip()
    if not code:
        raise EnrollmentError(400, "Enrollment code is required.")
    if len(code) != ENROLLMENT_CODE_LENGTH or not ENROLLMENT_CODE_PATTERN.match(code):
        raise EnrollmentError(400, "Invalid enrollment code.")
    return code


def _get_course_by_code(db: Session, code: str) -> Course:
    course = db.query(Course).filter(Course.enrollment_code == code).first()
    if not course:
        raise EnrollmentError(404, "Course not found.")
    return course


def _check_status_open(course: Course) -> None:
    if (course.status or "").lower() != "open":
        raise EnrollmentError(400, "This course is currently not open for enrollment.")


def _check_enrollment_window(course: Course) -> None:
    """Courses created before this feature may have null enrollment_start/end (older
    test data) - treat null as "no window restriction" rather than crashing."""
    today = date.today()
    if course.enrollment_start and today < course.enrollment_start:
        raise EnrollmentError(400, "Enrollment has not started yet.")
    if course.enrollment_end and today > course.enrollment_end:
        raise EnrollmentError(400, "Enrollment period has ended.")
    # NOTE: course.start_date is intentionally NOT checked separately here.
    # Course create/update already enforces enrollment_end <= start_date (see the
    # model_validators on CourseCreate/CourseUpdate in courses/schemas.py), so once
    # enrollment_end has passed the window check above already rejects the join for
    # all validly-created courses. A redundant start_date check would only risk a
    # conflicting/duplicate message for the same underlying condition.


def _check_existing_enrollment(db: Session, student: User, course: Course):
    """Returns the existing enrollment row (if any) so the caller can decide whether
    to reactivate it, or raises if the student already has an active enrollment."""
    existing = (
        db.query(Enrollment)
        .filter(Enrollment.student_id == student.id, Enrollment.course_id == course.id)
        .first()
    )
    if existing and existing.status == "Active":
        raise EnrollmentError(400, "You are already enrolled in this course.")
    return existing


def _check_prerequisite(db: Session, student: User, course: Course) -> None:
    if not course.prerequisite_course_id:
        return

    completed = (
        db.query(Enrollment)
        .filter(
            Enrollment.student_id == student.id,
            Enrollment.course_id == course.prerequisite_course_id,
            Enrollment.status == "Completed",
        )
        .first()
    )
    if completed:
        return

    prereq_course = db.query(Course).filter(Course.id == course.prerequisite_course_id).first()
    prereq_name = prereq_course.name if prereq_course else "the prerequisite course"
    raise EnrollmentError(
        400,
        f"You must complete {prereq_name} before enrolling in {course.name}.",
    )


def _check_capacity(db: Session, course: Course) -> None:
    if course.max_students is None:
        return  # Nullable max_students means unlimited capacity.

    active_count = (
        db.query(Enrollment)
        .filter(Enrollment.course_id == course.id, Enrollment.status == "Active")
        .count()
    )
    if active_count >= course.max_students:
        raise EnrollmentError(400, "This course has reached maximum capacity.")


def _extract_semester_number(value) -> "int | None":
    """Best-effort numeric extraction from free-text semester labels like
    'Semester 2' or '2'. Returns None if no digits are present."""
    if value is None:
        return None
    match = re.search(r"\d+", str(value))
    return int(match.group()) if match else None


def _check_semester(student: User, course: Course) -> None:
    """Optional, non-blocking check: only enforced when both the student's
    current_semester and the course's semester field resolve to comparable
    integers. Any ambiguity (missing data, non-numeric free text) is treated as a
    pass rather than a hard failure - this is explicitly optional per spec."""
    student_semester = getattr(student, "current_semester", None)
    if student_semester is None:
        return

    course_semester = _extract_semester_number(course.semester)
    if course_semester is None:
        return

    if student_semester != course_semester:
        raise EnrollmentError(
            400,
            f"This course is intended for semester {course_semester} students; "
            f"you are currently in semester {student_semester}.",
        )


def join_course_service(db: Session, student: User, raw_code: str) -> Enrollment:
    """Runs the full enrollment validation checklist and, on success, creates (or
    reactivates a previously dropped/completed) enrollment record. Raises
    EnrollmentError with a structured status/detail on any failed check - the route
    is responsible for translating that into an HTTPException."""
    code = _validate_code_format(raw_code)
    course = _get_course_by_code(db, code)

    _check_status_open(course)
    _check_enrollment_window(course)

    existing = _check_existing_enrollment(db, student, course)
    _check_prerequisite(db, student, course)
    _check_capacity(db, course)
    _check_semester(student, course)

    try:
        if existing:
            existing.status = "Active"
            db.commit()
            db.refresh(existing)
            return existing

        new_enrollment = Enrollment(
            student_id=student.id,
            course_id=course.id,
            status="Active",
            progress=0.0,
        )
        db.add(new_enrollment)
        db.commit()
        db.refresh(new_enrollment)
        return new_enrollment
    except IntegrityError:
        # Race condition: a concurrent duplicate request slipped past the earlier
        # existence check and hit the DB-level unique constraint first. Treat it the
        # same as the "already enrolled" business error rather than a raw 500.
        db.rollback()
        raise EnrollmentError(400, "You are already enrolled in this course.")
