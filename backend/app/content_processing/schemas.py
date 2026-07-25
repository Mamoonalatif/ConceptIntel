from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class TriggerPipelineRequest(BaseModel):
    # Optional free-text hint from the teacher (e.g. "these are CLOs for chapters 3-5,
    # treat as authoritative outcomes") - folded into the Kimi cleaning/structuring prompt.
    teacher_notes: Optional[str] = None


class GraphBuildJobResponse(BaseModel):
    id: int
    catalog_id: int
    course_id: int
    triggered_by_teacher_id: int
    status: str
    teacher_notes: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ConceptDiffItem(BaseModel):
    name: str
    description: str
    difficulty: str
    importance_score: int = 5
    learning_outcomes: str = ""
    prerequisites: List[str] = []
    is_new: bool = True  # False if it matched an existing concept already in the catalog graph


class GraphDiff(BaseModel):
    concepts: List[ConceptDiffItem] = []
    new_concept_count: int = 0
    matched_existing_count: int = 0
    new_relationship_count: int = 0


class GraphRevisionResponse(BaseModel):
    id: int
    job_id: int
    catalog_id: int
    is_initial: bool
    diff: GraphDiff
    submitted_by_teacher_id: int
    status: str
    teacher_reviewed_by_id: Optional[int] = None
    teacher_reviewed_at: Optional[datetime] = None
    teacher_edit_notes: Optional[str] = None
    coordinator_id: Optional[int] = None
    coordinator_decision_at: Optional[datetime] = None
    coordinator_notes: Optional[str] = None
    created_at: datetime


class TeacherReviewRequest(BaseModel):
    action: str  # "confirm" or "reject"
    edited_diff: Optional[GraphDiff] = None  # if provided, replaces the proposed diff before it moves on
    notes: Optional[str] = None


class CoordinatorDecisionRequest(BaseModel):
    action: str  # "approve" or "reject"
    notes: Optional[str] = None
