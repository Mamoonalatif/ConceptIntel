# Pydantic request/response models for exams (settings, teacher CRUD, student attempts, results).
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator


class ExamSettings(BaseModel):
    """Delivery rules for an exam (timer, shuffling, attempts, pass mark, answer visibility)."""
    time_limit_seconds: Optional[int] = None
    shuffle_questions: bool = True
    shuffle_options: bool = True
    max_attempts: int = 1           # 0 = unlimited
    pass_mark: float = 50.0
    show_answers_after: bool = True

    @field_validator("time_limit_seconds")
    @classmethod
    def sane_limit(cls, v: Optional[int]) -> Optional[int]:
        """0/None means untimed; otherwise 1 minute to 6 hours."""
        if v is None or v == 0:
            return None
        if not (60 <= v <= 6 * 3600):
            raise ValueError("An exam time limit must be between 1 minute and 6 hours")
        return v

    @field_validator("max_attempts")
    @classmethod
    def sane_attempts(cls, v: int) -> int:
        """0 = unlimited, otherwise at most 20 attempts."""
        if not (0 <= v <= 20):
            raise ValueError("max_attempts must be between 0 (unlimited) and 20")
        return v

    @field_validator("pass_mark")
    @classmethod
    def sane_pass_mark(cls, v: float) -> float:
        """Pass mark is a percentage 0-100 (rounded to 2 dp)."""
        if not (0 <= v <= 100):
            raise ValueError("pass_mark must be a percentage between 0 and 100")
        return round(float(v), 2)


class ExamIn(ExamSettings):
    """Teacher's payload to create an exam: title, description, question ids and settings."""
    title: str
    description: Optional[str] = None
    question_ids: List[int] = []

    @field_validator("title")
    @classmethod
    def non_empty(cls, v: str) -> str:
        """Reject blank titles and trim whitespace."""
        if not (v or "").strip():
            raise ValueError("An exam needs a title.")
        return v.strip()


class ExamUpdate(BaseModel):
    """Partial update for an exam - every field optional, only those sent are changed."""
    title: Optional[str] = None
    description: Optional[str] = None
    question_ids: Optional[List[int]] = None
    time_limit_seconds: Optional[int] = None
    shuffle_questions: Optional[bool] = None
    shuffle_options: Optional[bool] = None
    max_attempts: Optional[int] = None
    pass_mark: Optional[float] = None
    show_answers_after: Optional[bool] = None
    status: Optional[str] = None


class ExamOut(BaseModel):
    """An exam as returned to teachers/students, with computed counts and points."""
    id: int
    course_id: int
    title: str
    description: Optional[str] = None
    question_ids: List[int]
    question_count: int
    # Set when the exam references questions that have since been deleted, so a
    # teacher is told rather than quietly delivering a shorter exam.
    missing_question_count: int = 0
    total_points: int = 0
    time_limit_seconds: Optional[int] = None
    shuffle_questions: bool
    shuffle_options: bool
    max_attempts: int
    pass_mark: float
    show_answers_after: bool
    status: str
    created_at: datetime


class ServedQuestion(BaseModel):
    """A question as a student sees it - no answer key of any kind."""
    id: int
    question_type: str
    prompt: str
    points: int
    difficulty: str
    concept_name: Optional[str] = None
    time_limit_seconds: Optional[int] = None
    options: Optional[List[str]] = None          # single_choice / multi_select
    left_items: Optional[List[str]] = None       # matching
    right_items: Optional[List[str]] = None      # matching


class ExamAttemptOut(BaseModel):
    """A started attempt: the served questions, time remaining and start time."""
    attempt_id: int
    exam_id: int
    title: str
    description: Optional[str] = None
    attempt_number: int
    questions: List[ServedQuestion]
    remaining_seconds: Optional[int] = None
    time_limit_seconds: Optional[int] = None
    started_at: datetime


class SubmitExamRequest(BaseModel):
    """responses is keyed by question id. The value's shape depends on the question:
    an int for single_choice, a list of ints for multi_select, a bool for true_false,
    a string for fill_blank, and {left: right} for matching."""
    responses: Dict[str, Any] = {}


class ExamResultOut(BaseModel):
    """Outcome of a submitted attempt: score, pass/fail, lateness and per-question detail."""
    attempt_id: int
    score: float
    points_earned: float
    points_possible: float
    passed: bool
    pass_mark: float
    late: bool = False
    per_question: List[dict] = []


class ExamAttemptSummary(BaseModel):
    """One row of a teacher's list of a student's attempts on an exam."""
    id: int
    student_id: int
    student_name: Optional[str] = None
    attempt_number: int
    score: Optional[float] = None
    passed: Optional[bool] = None
    submitted_at: Optional[datetime] = None
