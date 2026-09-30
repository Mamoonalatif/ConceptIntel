# Pydantic response models for the mastery endpoints (what the API returns as JSON).
from datetime import datetime
from pydantic import BaseModel


class ConceptMasteryOut(BaseModel):
    """One concept's mastery for one student (0-100 score plus how many graded signals fed it)."""
    concept_node_id: str
    concept_name: str
    mastery_score: float
    evidence_count: int
    last_updated: datetime

    class Config:
        from_attributes = True


class MyMasterySummary(BaseModel):
    """A student's mastery rolled up for one enrolled course: overall % plus per-concept rows."""
    course_id: int
    course_name: str
    overall_progress: float | None  # None if no graded evidence yet
    concepts: list[ConceptMasteryOut]
