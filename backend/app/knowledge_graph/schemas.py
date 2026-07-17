from pydantic import BaseModel, Field
from typing import List, Optional, Any


class ConceptNode(BaseModel):
    id: str
    name: str
    description: str
    difficulty: str
    course_id: int
    importance_score: Optional[int] = 5
    learning_outcomes: Optional[str] = ""


class ConceptNodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    difficulty: Optional[str] = None
    importance_score: Optional[int] = None
    learning_outcomes: Optional[str] = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str


class GraphResponse(BaseModel):
    nodes: List[Any]
    edges: List[Any]


class CourseGraphStatusResponse(BaseModel):
    id: int
    graph_status: str

    class Config:
        from_attributes = True


class RelationshipCreate(BaseModel):
    course_id: int
    source_name: str
    target_name: str


class GraphStats(BaseModel):
    node_count: int
    edge_count: int
    easy_count: int
    medium_count: int
    hard_count: int


class ConceptSearchResult(BaseModel):
    id: str
    name: str
    difficulty: str
    description: str
