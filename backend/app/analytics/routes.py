# Analytics API routes (mounted at /analytics): per-course class analytics for teachers, platform-wide
# overview for admins, and a student's own progress. Heavy results are cached briefly.
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Course, Program, Enrollment, Assignment, AssignmentSubmission, User
from app.analytics.schemas import (
    CourseAnalyticsResponse, AssignmentStat, StudentStat, MyCourseProgress, ConceptMasteryStat,
    PlatformOverviewResponse, RoleCounts, CourseSummary,
)
from app.auth.routes import get_current_user, get_current_student, get_current_admin
from app.courses.access import assert_course_access, ACTIVE_ENROLLMENT_STATUSES
from app.knowledge_graph.services import neo4j_service
from app.mastery import service as mastery_service
from app.core import simple_cache

router = APIRouter(prefix="/analytics", tags=["Analytics"])

# At-risk threshold: a student who has submitted fewer than this percentage of
# a course's assignments is flagged - this is the completion-rate signal, kept
# alongside (not replaced by) the real per-concept mastery heatmap below, since
# "didn't submit" and "submitted but scored low on concept X" are different
# problems a teacher needs to see separately.
AT_RISK_COMPLETION_THRESHOLD = 50.0


def _get_course_or_404(db: Session, course_id: int) -> Course:
    """Loads a course by id or raises 404."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _avg(values: List[float]) -> Optional[float]:
    """Mean rounded to 1 decimal, or None for an empty list."""
    return round(sum(values) / len(values), 1) if values else None


@router.get("/course/{course_id}", response_model=CourseAnalyticsResponse)
def get_course_analytics(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Real, database-backed class analytics for one course - assignment
    submission/lateness/grading stats per assignment and per student, real Neo4j
    concept/edge counts, and a real per-concept mastery heatmap (from
    ConceptMastery, written by Assignment Evaluation grading and quiz attempts)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    if current_user.role.lower() == "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Class-wide analytics are only available to teachers and oversight roles. See /analytics/my-progress for your own data.",
        )

    def _compute() -> CourseAnalyticsResponse:
        # This is the expensive part - several DB aggregations plus a Neo4j round
        # trip for graph_stats - and the result is identical for every teacher/
        # coordinator who views this same course, so it's cached for a short
        # window rather than recomputed on every single dashboard load/switch.
        """Builds the full course analytics response (cached by the caller): per-assignment and per-student stats, graph counts, mastery heatmap."""
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

        # One query for every assignment's submissions, not one lazy-loaded query
        # PER ASSIGNMENT (`a.submissions` below used to trigger a fresh round trip
        # each time it was first accessed in the loop - same "many small round
        # trips to a remote DB" cost as the platform-overview N+1 fixed alongside
        # this).
        submissions_by_assignment: dict[int, List[AssignmentSubmission]] = {a.id: [] for a in assignments}
        if assignments:
            for sub in (
                db.query(AssignmentSubmission)
                .filter(AssignmentSubmission.assignment_id.in_([a.id for a in assignments]))
                .all()
            ):
                submissions_by_assignment[sub.assignment_id].append(sub)

        for a in assignments:
            submitted_count = 0
            late_count = 0
            grades: List[float] = []
            submitted_student_ids = set()
            for sub in submissions_by_assignment[a.id]:
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
        heatmap = mastery_service.get_course_mastery_heatmap(db, course_id)

        return CourseAnalyticsResponse(
            course_id=course.id, course_name=course.name,
            total_students=total_students, total_assignments=total_assignments,
            concept_count=graph_stats.get("node_count", 0), edge_count=graph_stats.get("edge_count", 0),
            easy_count=graph_stats.get("easy_count", 0), medium_count=graph_stats.get("medium_count", 0),
            hard_count=graph_stats.get("hard_count", 0),
            avg_completion_rate=avg_completion_rate, at_risk_count=at_risk_count,
            assignments=assignment_stats, students=student_stats,
            concept_mastery=[ConceptMasteryStat(**h) for h in heatmap],
        )

    return simple_cache.get_or_compute(f"analytics:course:{course_id}", ttl_seconds=20, compute=_compute)


@router.get("/platform-overview", response_model=PlatformOverviewResponse)
def get_platform_overview(
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Platform-wide analytics for the Admin Console - aggregated across every
    course and student, distinct from the single-course view teachers/
    coordinators use at /analytics/course/{id}."""

    def _compute() -> PlatformOverviewResponse:
        """Builds the admin platform overview (cached by the caller): role counts, per-course summaries, platform mastery heatmap."""
        role_counts = {"student": 0, "teacher": 0, "admin": 0}
        program_coordinators = 0
        course_coordinators = 0
        for u in db.query(User).all():
            base_role = u.role.lower()
            if base_role in role_counts:
                role_counts[base_role] += 1
            if u.is_program_coordinator:
                program_coordinators += 1
            if u.is_course_coordinator:
                course_coordinators += 1

        courses = db.query(Course).all()

        # One query for every course's submission counts, grouped by (course,
        # student) - not one query PER STUDENT PER COURSE. The loop below used to
        # run a separate AssignmentSubmission COUNT for every enrolled student in
        # every course - fine on SQLite in dev, but each round trip to this app's
        # remote Supabase Postgres costs real network time (~0.5-0.9s measured),
        # so a platform with a handful of courses/students turned "Loading
        # platform analytics..." into a multi-second-to-a-minute wait. This is
        # the exact same data, computed with a single round trip instead of one
        # per (course, student) pair.
        submission_counts: dict[tuple[int, int], int] = {
            (course_id, student_id): count
            for course_id, student_id, count in (
                db.query(Assignment.course_id, AssignmentSubmission.student_id, func.count(AssignmentSubmission.id))
                .join(AssignmentSubmission, AssignmentSubmission.assignment_id == Assignment.id)
                .group_by(Assignment.course_id, AssignmentSubmission.student_id)
                .all()
            )
        }

        course_summaries: List[CourseSummary] = []
        completion_rates: List[float] = []
        for course in courses:
            roster = (
                db.query(Enrollment)
                .filter(Enrollment.course_id == course.id, Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES))
                .all()
            )
            total_assignments = db.query(Assignment).filter(Assignment.course_id == course.id).count()
            if not roster or not total_assignments:
                avg_rate = 0.0
            else:
                rates = [
                    (submission_counts.get((course.id, enr.student_id), 0) / total_assignments) * 100
                    for enr in roster
                ]
                avg_rate = round(sum(rates) / len(rates), 1) if rates else 0.0

            heatmap = mastery_service.get_course_mastery_heatmap(db, course.id)
            avg_mastery = round(sum(h["avg_mastery"] for h in heatmap) / len(heatmap), 1) if heatmap else None

            course_summaries.append(CourseSummary(
                course_id=course.id, course_name=course.name,
                student_count=len(roster), avg_completion_rate=avg_rate, avg_mastery=avg_mastery,
            ))
            completion_rates.append(avg_rate)

        platform_heatmap = mastery_service.get_platform_mastery_heatmap(db)

        return PlatformOverviewResponse(
            total_courses=len(courses),
            total_programs=db.query(Program).count(),
            roles=RoleCounts(
                students=role_counts["student"], teachers=role_counts["teacher"],
                program_coordinators=program_coordinators, course_coordinators=course_coordinators,
                admins=role_counts["admin"],
            ),
            avg_completion_rate=_avg(completion_rates) or 0.0,
            courses=course_summaries,
            concept_mastery=[ConceptMasteryStat(**h) for h in platform_heatmap],
        )

    return simple_cache.get_or_compute("analytics:platform-overview", ttl_seconds=30, compute=_compute)


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
