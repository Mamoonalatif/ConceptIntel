from datetime import datetime
from pydantic import BaseModel


class ConceptMasteryOut(BaseModel):
    concept_node_id: str
    concept_name: str
    mastery_score: float
    evidence_count: int
    last_updated: datetime

    class Config:
        from_attributes = True


class MyMasterySummary(BaseModel):
    course_id: int
    course_name: str
    overall_progress: float | None  # None if no graded evidence yet
    concepts: list[ConceptMasteryOut]
