from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ── Graduate Attributes (global) ──────────────────────────────────────────
class GACreate(BaseModel):
    code: str
    title: str
    description: Optional[str] = None


class GAOut(BaseModel):
    id: int
    code: str
    title: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Program Learning Outcomes ─────────────────────────────────────────────
class PLOCreate(BaseModel):
    program_id: int
    code: str
    title: str
    description: Optional[str] = None


class PLOOut(BaseModel):
    id: int
    program_id: int
    code: str
    title: str
    description: Optional[str] = None
    ga_ids: list[int] = []
    created_at: datetime

    class Config:
        from_attributes = True


class PLOGALinkRequest(BaseModel):
    ga_ids: list[int]  # full replace of this PLO's GA links


# ── Course Learning Outcomes ──────────────────────────────────────────────
class CLOCreate(BaseModel):
    catalog_id: int
    code: str
    title: str
    description: Optional[str] = None


class CLOOut(BaseModel):
    id: int
    catalog_id: int
    code: str
    title: str
    description: Optional[str] = None
    plo_ids: list[int] = []
    created_by_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class CLOPLOLinkRequest(BaseModel):
    plo_ids: list[int]  # full replace of this CLO's PLO links


class ConceptCLOLinkRequest(BaseModel):
    concept_node_id: str
    concept_name: str
    clo_ids: list[int]  # full replace of this concept's CLO links


class ConceptCLOMapOut(BaseModel):
    concept_node_id: str
    concept_name: str
    clo_ids: list[int]


# ── Outcome chain / attainment ────────────────────────────────────────────
class OutcomeChainNode(BaseModel):
    """One CLO with its resolved PLO/GA chain, for the knowledge-graph "outcomes
    layer" and for the content-generation / rubric-criterion CLO dropdowns."""
    clo: CLOOut
    plos: list[PLOOut] = []
    gas: list[GAOut] = []


class CLOAttainmentOut(BaseModel):
    clo_id: int
    clo_code: str
    clo_title: str
    attainment_score: float
    evidence_count: int


class PLOAttainmentOut(BaseModel):
    plo_id: int
    plo_code: str
    plo_title: str
    attainment_score: float
    evidence_count: int


# ── AI-assisted extraction from the course outline ────────────────────────
class CLOAutoExtractResponse(BaseModel):
    """Result of POST /outcomes/clos/auto-extract - what was created/linked, so the
    curriculum editor can see (and then review/edit via the normal CLO endpoints)
    exactly what the AI pass did, rather than it happening invisibly."""
    created_clos: list[CLOOut] = []
    skipped_existing_count: int = 0
    plo_links_created: int = 0
    concepts_tagged: int = 0
