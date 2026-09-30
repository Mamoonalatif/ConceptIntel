# Pydantic models for the knowledge-graph API (concept nodes, edges, stats, search, edit proposals).
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from datetime import datetime


# A concept as returned to the client.
class ConceptNode(BaseModel):
    id: str
    name: str
    description: str
    difficulty: str
    course_id: int
    importance_score: Optional[int] = 5
    learning_outcomes: Optional[str] = ""
    material: Optional[str] = ""


# Body for adding a concept manually.
class ConceptNodeCreate(BaseModel):
    name: str
    description: str
    difficulty: str = "Medium"
    importance_score: Optional[int] = 5
    learning_outcomes: Optional[str] = ""
    material: Optional[str] = ""


# Body for editing a concept; every field is optional.
class ConceptNodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    difficulty: Optional[str] = None
    importance_score: Optional[int] = None
    learning_outcomes: Optional[str] = None
    material: Optional[str] = None


class MaterialGenerateRequest(BaseModel):
    """Optional steering instruction for AI-generating a concept's detailed material
    from the course's uploaded content (e.g. "focus on worked examples")."""
    instruction: Optional[str] = None


class MaterialEditRequest(BaseModel):
    """A targeted refinement instruction applied to existing material text - not a
    full regeneration."""
    instruction: str


# A prerequisite link between two concept ids.
class GraphEdge(BaseModel):
    id: str
    source: str
    target: str


# Full graph payload: nodes and edges.
class GraphResponse(BaseModel):
    nodes: List[Any]
    edges: List[Any]


# Whether the course graph is built/pending.
class CourseGraphStatusResponse(BaseModel):
    id: int
    graph_status: str

    class Config:
        from_attributes = True


# Body for adding a prerequisite link by concept names.
class RelationshipCreate(BaseModel):
    course_id: int
    source_name: str
    target_name: str


# Counts shown on the analytics/graph dashboards.
class GraphStats(BaseModel):
    node_count: int
    edge_count: int
    easy_count: int
    medium_count: int
    hard_count: int


# One hit from concept search.
class ConceptSearchResult(BaseModel):
    id: str
    name: str
    difficulty: str
    description: str


class EditProposalResponse(BaseModel):
    """A single manual graph edit awaiting (or having received) course coordinator
    approval - see app/knowledge_graph/revision_service.py's propose_edit/decide_edit_proposal."""
    id: int
    catalog_id: int
    course_id: int
    teacher_id: int
    operation: str
    payload: Dict[str, Any]
    status: str
    coordinator_id: Optional[int] = None
    coordinator_decision_at: Optional[datetime] = None
    coordinator_notes: Optional[str] = None
    created_at: datetime
