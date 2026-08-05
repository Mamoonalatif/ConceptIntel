from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Course, Enrollment, Assignment, AssignmentSubmission, User
from app.analytics.schemas import CourseAnalyticsResponse, AssignmentStat, StudentStat, MyCourseProgress
from app.auth.routes import get_current_user, get_current_student
from app.courses.access import assert_course_access, ACTIVE_ENROLLMENT_STATUSES
from app.knowledge_graph.services import neo4j_service

router = APIRouter(prefix="/analytics", tags=["Analytics"])

# At-risk threshold: a student who has submitted fewer than this percentage of
# a course's assignments is flagged. This mirrors real, observable behavior
# (did they submit or not) rather than any invented "mastery" score - this
# course has no per-concept mastery data anywhere (see AssignmentSubmission.grade
# being nullable/unpopulated and Enrollment.progress never being written to).
AT_RISK_COMPLETION_THRESHOLD = 50.0


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _avg(values: List[float]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


@router.get("/course/{course_id}", response_model=CourseAnalyticsResponse)
def get_course_analytics(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Real, database-backed class analytics for one course - assignment
    submission/lateness/grading stats per assignment and per student, plus
    real Neo4j concept/edge counts. There is no per-student per-concept
    mastery data in this system yet (Neo4j only stores course-scoped concept
    nodes, not student-linked mastery), so this endpoint reports what
    genuinely exists - submission activity - rather than a fabricated
    mastery metric."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    if current_user.role.lower() == "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Class-wide analytics are only available to teachers and oversight roles. See /analytics/my-progress for your own data.",
        )

    roster = (
        db.query(Enrollment)
        .filter(Enrollment.course_id == course_id, Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES))
        .all()
    )
    assignments = db.query(Assignment).filter(Assignment.course_id == course_id).all()
    total_students = len(roster)
    total_assignments = len(assignments)

    assignment_stats: List[AssignmentStat] = []
    # student_id -> {submitted, grades, status_by_assignment_id}
    per_student: dict = {enr.student_id: {"submitted": 0, "grades": [], "status": {}} for enr in roster}

    for a in assignments:
        submitted_count = 0
        late_count = 0
        grades: List[float] = []
        submitted_student_ids = set()
        for sub in a.submissions:
            submitted_count += 1
            submitted_student_ids.add(sub.student_id)
            if sub.is_late:
                late_count += 1
            if sub.grade is not None:
                grades.append(sub.grade)
            if sub.student_id in per_student:
                per_student[sub.student_id]["submitted"] += 1
                per_student[sub.student_id]["status"][a.id] = "late" if sub.is_late else "submitted"
                if sub.grade is not None:
                    per_student[sub.student_id]["grades"].append(sub.grade)
        for enr in roster:
            if enr.student_id not in submitted_student_ids:
                per_student[enr.student_id]["status"].setdefault(a.id, "missing")

        assignment_stats.append(AssignmentStat(
            id=a.id, title=a.title, due_date=a.due_date,
            total_students=total_students, submitted_count=submitted_count,
            late_count=late_count, graded_count=len(grades), avg_grade=_avg(grades),
        ))

    student_stats: List[StudentStat] = []
    for enr in roster:
        stat = per_student[enr.student_id]
        completion_rate = round((stat["submitted"] / total_assignments) * 100, 1) if total_assignments else 0.0
        status_list = [stat["status"].get(a.id, "missing") for a in assignments]
        student_stats.append(StudentStat(
            student_id=enr.student_id,
            full_name=enr.student.full_name if enr.student else "Unknown",
            email=enr.student.email if enr.student else "",
            submitted_count=stat["submitted"], total_assignments=total_assignments,
            completion_rate=completion_rate, graded_count=len(stat["grades"]), avg_grade=_avg(stat["grades"]),
            assignment_status=status_list,
        ))
    student_stats.sort(key=lambda s: s.completion_rate, reverse=True)

    avg_completion_rate = _avg([s.completion_rate for s in student_stats]) or 0.0
    at_risk_count = sum(1 for s in student_stats if s.completion_rate < AT_RISK_COMPLETION_THRESHOLD)

    graph_stats = neo4j_service.get_graph_stats(course_id)

    return CourseAnalyticsResponse(
        course_id=course.id, course_name=course.name,
        total_students=total_students, total_assignments=total_assignments,
        concept_count=graph_stats.get("node_count", 0), edge_count=graph_stats.get("edge_count", 0),
        easy_count=graph_stats.get("easy_count", 0), medium_count=graph_stats.get("medium_count", 0),
        hard_count=graph_stats.get("hard_count", 0),
        avg_completion_rate=avg_completion_rate, at_risk_count=at_risk_count,
        assignments=assignment_stats, students=student_stats,
    )


@router.get("/my-progress", response_model=List[MyCourseProgress])
def get_my_progress(
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """A student's own real submission-completion rate per enrolled course -
    no classmates' data is exposed here."""
    enrollments = (
        db.query(Enrollment)
        .filter(Enrollment.student_id == current_student.id, Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES))
        .all()
    )
    results: List[MyCourseProgress] = []
    for enr in enrollments:
        assignments = db.query(Assignment).filter(Assignment.course_id == enr.course_id).all()
        total_assignments = len(assignments)
        submissions = (
            db.query(AssignmentSubmission)
            .join(Assignment, AssignmentSubmission.assignment_id == Assignment.id)
            .filter(Assignment.course_id == enr.course_id, AssignmentSubmission.student_id == current_student.id)
            .all()
        )
        grades = [s.grade for s in submissions if s.grade is not None]
        completion_rate = round((len(submissions) / total_assignments) * 100, 1) if total_assignments else 0.0
        results.append(MyCourseProgress(
            course_id=enr.course_id, course_name=enr.course.name if enr.course else "Unknown",
            submitted_count=len(submissions), total_assignments=total_assignments,
            completion_rate=completion_rate, graded_count=len(grades), avg_grade=_avg(grades),
        ))
    return results
