from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class AssignmentStat(BaseModel):
    id: int
    title: str
    due_date: Optional[datetime] = None
    total_students: int
    submitted_count: int
    late_count: int
    graded_count: int
    avg_grade: Optional[float] = None


class StudentStat(BaseModel):
    student_id: int
    full_name: str
    email: str
    submitted_count: int
    total_assignments: int
    completion_rate: float
    graded_count: int
    avg_grade: Optional[float] = None
    # One entry per course assignment, in the same order as
    # CourseAnalyticsResponse.assignments, so the frontend can render a
    # per-student x per-assignment status grid positionally without a
    # separate lookup. Values: "submitted" | "late" | "missing".
    assignment_status: List[str] = []


class ConceptMasteryStat(BaseModel):
    concept_node_id: str
    concept_name: str
    avg_mastery: float
    students_with_evidence: int
    at_risk_count: int  # students below the at-risk mastery threshold on this concept


class CourseAnalyticsResponse(BaseModel):
    course_id: int
    course_name: str
    total_students: int
    total_assignments: int
    concept_count: int
    edge_count: int
    easy_count: int
    medium_count: int
    hard_count: int
    avg_completion_rate: float
    at_risk_count: int
    assignments: List[AssignmentStat]
    students: List[StudentStat]
    # Real per-concept mastery heatmap (from ConceptMastery, written by Assignment
    # Evaluation grading and quiz attempts) - empty until students have graded
    # evidence. Sorted weakest-average-first, so the first entries are the
    # course's actual learning bottlenecks.
    concept_mastery: List[ConceptMasteryStat] = []


class RoleCounts(BaseModel):
    students: int
    teachers: int
    program_coordinators: int
    course_coordinators: int
    admins: int


class CourseSummary(BaseModel):
    course_id: int
    course_name: str
    student_count: int
    avg_completion_rate: float
    avg_mastery: Optional[float] = None


class PlatformOverviewResponse(BaseModel):
    """Admin-only, platform-wide analytics - aggregated across every course and
    student, not scoped to one course the way CourseAnalyticsResponse is."""
    total_courses: int
    total_programs: int
    roles: RoleCounts
    avg_completion_rate: float
    courses: List[CourseSummary]
    concept_mastery: List[ConceptMasteryStat] = []


class MyCourseProgress(BaseModel):
    course_id: int
    course_name: str
    submitted_count: int
    total_assignments: int
    completion_rate: float
    graded_count: int
    avg_grade: Optional[float] = None
