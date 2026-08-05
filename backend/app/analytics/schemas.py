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


class MyCourseProgress(BaseModel):
    course_id: int
    course_name: str
    submitted_count: int
    total_assignments: int
    completion_rate: float
    graded_count: int
    avg_grade: Optional[float] = None
