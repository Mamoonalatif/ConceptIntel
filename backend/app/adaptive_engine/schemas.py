# Pydantic response models describing a revision plan (list of weak concepts + materials).
from typing import Optional
from pydantic import BaseModel


class RecommendedMaterial(BaseModel):
    """An approved study material suggested for a weak concept."""
    content_id: int
    content_type: str
    title: str


class RevisionPlanItem(BaseModel):
    """One weak concept in the plan, with why it matters and what to study."""
    concept_node_id: str
    concept_name: str
    mastery_score: float
    is_foundational: bool  # true if other concepts depend on this one as a prerequisite
    dependents_count: int
    reason: str
    recommended_materials: list[RecommendedMaterial]


class RevisionPlanOut(BaseModel):
    """The full plan returned to the client: course, overall progress, ordered items."""
    course_id: int
    overall_progress: Optional[float]
    plan: list[RevisionPlanItem]
