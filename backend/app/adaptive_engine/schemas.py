from typing import Optional
from pydantic import BaseModel


class RecommendedMaterial(BaseModel):
    content_id: int
    content_type: str
    title: str


class RevisionPlanItem(BaseModel):
    concept_node_id: str
    concept_name: str
    mastery_score: float
    is_foundational: bool  # true if other concepts depend on this one as a prerequisite
    dependents_count: int
    reason: str
    recommended_materials: list[RecommendedMaterial]


class RevisionPlanOut(BaseModel):
    course_id: int
    overall_progress: Optional[float]
    plan: list[RevisionPlanItem]
