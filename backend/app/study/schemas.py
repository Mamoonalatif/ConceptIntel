from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, field_validator


class LearnQueueItem(BaseModel):
    kind: str                      # "card" | "question"
    index: int                     # position in the source payload
    prompt: str
    answer: Optional[str] = None   # cards only
    options: Optional[List[str]] = None        # questions only
    correct_index: Optional[int] = None        # questions only
    explanation: Optional[str] = None
    box: int = 0
    times_seen: int = 0


class LearnProgress(BaseModel):
    total: int
    new: int
    due: int
    mastered: int
    resting: int


class LearnQueueOut(BaseModel):
    content_id: int
    title: str
    content_type: str
    queue: List[LearnQueueItem]
    progress: LearnProgress


class LearnAnswer(BaseModel):
    item_index: int
    correct: bool


class SubmitLearnRequest(BaseModel):
    """A whole Learn round, submitted in one call.

    Batched rather than one request per card on purpose: drilling is fast and a
    per-card round trip would either stall the UI or fire dozens of writes. The
    client answers locally and posts the round when it ends.
    """
    answers: List[LearnAnswer]
    duration_seconds: Optional[int] = None

    @field_validator("answers")
    @classmethod
    def non_empty(cls, v: List[LearnAnswer]) -> List[LearnAnswer]:
        if not v:
            raise ValueError("answers must contain at least one item")
        if len(v) > 200:
            raise ValueError("too many answers in a single round (max 200)")
        return v


class LearnResultOut(BaseModel):
    score: float
    items_total: int
    items_correct: int
    progress: LearnProgress


class TestQuestionOut(BaseModel):
    source_index: int
    question: str
    options: List[str]
    explanation: str = ""
    # correct_index is deliberately NOT sent to the client - see the route.


class TestOut(BaseModel):
    content_id: int
    title: str
    attempt_token: str
    questions: List[TestQuestionOut]


class SubmitTestRequest(BaseModel):
    attempt_token: str
    answers: List[int]   # selected option index per question, -1 for skipped


class TestResultOut(BaseModel):
    score: float
    correct_count: int
    total_count: int
    per_question: List[dict]


class MatchPairOut(BaseModel):
    index: int
    term: str
    definition: str


class MatchSetOut(BaseModel):
    content_id: int
    title: str
    pairs: List[MatchPairOut]


class SubmitMatchRequest(BaseModel):
    pairs_total: int
    pairs_matched: int
    duration_seconds: int

    @field_validator("duration_seconds")
    @classmethod
    def sane_duration(cls, v: int) -> int:
        # Client-reported, so bounded rather than trusted: anything above an hour is
        # a stuck timer, not a real drill.
        return max(0, min(3600, v))


class StudySessionOut(BaseModel):
    id: int
    mode: str
    score: float
    items_total: int
    items_correct: int
    duration_seconds: Optional[int] = None
    concept_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class StudyOverviewOut(BaseModel):
    """Per-content-set study state, for listing what is worth drilling next."""
    content_id: int
    title: str
    content_type: str
    concept_name: str
    difficulty: str
    total_items: int
    mastered: int
    due: int
    supports_match: bool
