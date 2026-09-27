from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator


class ExamSettings(BaseModel):
    time_limit_seconds: Optional[int] = None
    shuffle_questions: bool = True
    shuffle_options: bool = True
    max_attempts: int = 1           # 0 = unlimited
    pass_mark: float = 50.0
    show_answers_after: bool = True

    @field_validator("time_limit_seconds")
    @classmethod
    def sane_limit(cls, v: Optional[int]) -> Optional[int]:
        if v is None or v == 0:
            return None
        if not (60 <= v <= 6 * 3600):
            raise ValueError("An exam time limit must be between 1 minute and 6 hours")
        return v

    @field_validator("max_attempts")
    @classmethod
    def sane_attempts(cls, v: int) -> int:
        if not (0 <= v <= 20):
            raise ValueError("max_attempts must be between 0 (unlimited) and 20")
        return v

    @field_validator("pass_mark")
    @classmethod
    def sane_pass_mark(cls, v: float) -> float:
        if not (0 <= v <= 100):
            raise ValueError("pass_mark must be a percentage between 0 and 100")
        return round(float(v), 2)


class ExamIn(ExamSettings):
    title: str
    description: Optional[str] = None
    question_ids: List[int] = []

    @field_validator("title")
    @classmethod
    def non_empty(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("An exam needs a title.")
        return v.strip()


class ExamUpdate(BaseModel):
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
    attempt_id: int
    score: float
    points_earned: float
    points_possible: float
    passed: bool
    pass_mark: float
    late: bool = False
    per_question: List[dict] = []


class ExamAttemptSummary(BaseModel):
    id: int
    student_id: int
    student_name: Optional[str] = None
    attempt_number: int
    score: Optional[float] = None
    passed: Optional[bool] = None
    submitted_at: Optional[datetime] = None
