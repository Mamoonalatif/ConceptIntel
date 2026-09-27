from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SubmissionSummary(BaseModel):
    id: int
    file_filename: str
    submitted_at: datetime
    is_late: bool
    grade: Optional[float] = None
    feedback: Optional[str] = None
    # "Ungraded" | "PendingReview" | "Approved" - see AssignmentSubmission.grade_status.
    # A student's own SubmissionSummary always has grade/feedback nulled out unless
    # this is "Approved" (see app/assignments/routes.py _student_facing_submission) -
    # the AI's proposal is only shown here after a teacher approves it.
    grade_status: str = "Ungraded"

    class Config:
        from_attributes = True


class AssignmentResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    teacher_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    points: Optional[int] = None
    attachment_filename: Optional[str] = None
    # Set when this assignment was created from an AI-generated, concept-grounded
    # draft (see content_generation/routes.py create_assignment_from_content) -
    # null for a plain manually-created assignment.
    concept_node_id: Optional[str] = None
    concept_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Populated only for the requesting student - their own submission, if any.
    my_submission: Optional[SubmissionSummary] = None
    # Populated only for the teacher/oversight roles - count of student submissions.
    submission_count: Optional[int] = None

    class Config:
        from_attributes = True


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    points: Optional[int] = None


class ManualGradeUpdate(BaseModel):
    """Lets a teacher override/finalize a grade directly - an explicit human
    decision, so it is applied immediately (grade_status="Approved") with no
    further gate, same as approve_grade below."""
    grade: float
    feedback: str


class RubricCriterionScoreOut(BaseModel):
    """One criterion's result from an AI grading pass - part of a submission's
    rubric_scores. level_id/level_label are set only when the criterion has
    performance levels and the AI picked one (see grading_service.py); a
    criterion with no levels defined is still scored free-form (points_earned
    alone) for backward compatibility with rubrics created before levels existed."""
    criterion_id: int
    title: str
    points_earned: float
    max_points: float
    clo_id: Optional[int] = None
    feedback: str
    level_id: Optional[int] = None
    level_label: Optional[str] = None


class SubmissionResponse(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    file_filename: str
    submitted_at: datetime
    is_late: bool
    grade: Optional[float] = None
    feedback: Optional[str] = None
    # Per-criterion breakdown from the assignment's rubric, if one exists and was
    # used for this grading pass - see RubricCriterionScoreOut. None otherwise.
    rubric_scores: Optional[list[dict]] = None
    grade_status: str = "Ungraded"

    class Config:
        from_attributes = True


class RubricLevelIn(BaseModel):
    """A performance level as the teacher edits/saves it - id present when
    editing an existing level, None for a brand-new row (same convention as
    RubricCriterionIn.id)."""
    id: Optional[int] = None
    label: str
    points: float
    description: Optional[str] = None


class RubricCriterionIn(BaseModel):
    """A criterion as the teacher edits/saves it - id is present when editing an
    existing criterion (from a generated draft or a previous save) so the PUT can
    tell "keep this one" from "this is new", None for a brand-new row."""
    id: Optional[int] = None
    title: str
    description: Optional[str] = None
    max_points: float
    clo_id: Optional[int] = None
    # The performance-level grid for this criterion (e.g. Excellent/Good/Fair/
    # Poor). May be empty for a plain criterion with no levels (grading then
    # falls back to a free-form 0-max_points score) - not required, but the AI
    # draft (see rubric_service.py) always fills this in by default.
    levels: list[RubricLevelIn] = []


class RubricSaveRequest(BaseModel):
    """Full replace of an assignment's rubric criteria - the teacher's save after
    generating/editing a draft. Publishing (status='Published') is what grading
    actually reads; a still-Draft rubric is not yet used to grade. Publishing
    also enforces that criteria sum to the assignment's point value - see
    app/assignments/routes.py save_rubric."""
    criteria: list[RubricCriterionIn]
    status: str = "Published"  # "Draft" | "Published"


class RubricLevelOut(BaseModel):
    id: int
    label: str
    points: float
    description: Optional[str] = None
    order_index: int

    class Config:
        from_attributes = True


class RubricCriterionOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    max_points: float
    clo_id: Optional[int] = None
    clo_code: Optional[str] = None
    order_index: int
    levels: list[RubricLevelOut] = []

    class Config:
        from_attributes = True


class RubricOut(BaseModel):
    id: int
    assignment_id: int
    status: str
    criteria: list[RubricCriterionOut]
    total_points: float
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GradeApproveRequest(BaseModel):
    """Optional edits the teacher makes before approving a PendingReview AI
    grade - the same "review, edit, approve" pattern as every other AI output in
    this app. Omitting a field keeps the AI's own value for it.

    criterion_levels: [{"criterion_id": ..., "level_id": ...}, ...] - overrides
    which level the AI picked for one or more criteria (only meaningful for
    criteria that have levels defined). Points/overall_grade are recomputed
    server-side from the chosen levels, never taken from the client directly -
    same "never trust a point value that didn't come from the rubric itself"
    rule as AI grading.
    """
    criterion_levels: Optional[list[dict]] = None
    overall_feedback: Optional[str] = None
