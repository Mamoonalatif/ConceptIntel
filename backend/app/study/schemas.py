# Pydantic request/response models for the Learn, Test and Match study endpoints.
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator


class LearnQueueItem(BaseModel):
    """One card/question in a Learn round, with its current Leitner box."""
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
    """Counts summarising a study set: total, new, due, mastered and resting items."""
    total: int
    new: int
    due: int
    mastered: int
    resting: int


class LearnQueueOut(BaseModel):
    """The Learn queue sent to the client, with set info and progress."""
    content_id: int
    title: str
    content_type: str
    queue: List[LearnQueueItem]
    progress: LearnProgress


class LearnAnswer(BaseModel):
    """One answer in a Learn round: which item and whether it was right."""
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
        """Require 1-200 answers per round."""
        if not v:
            raise ValueError("answers must contain at least one item")
        if len(v) > 200:
            raise ValueError("too many answers in a single round (max 200)")
        return v


class LearnResultOut(BaseModel):
    """Result of a submitted Learn round: score, counts and updated progress."""
    score: float
    items_total: int
    items_correct: int
    progress: LearnProgress


class TestQuestionOut(BaseModel):
    """A test question as shown to the student (no correct_index)."""
    source_index: int
    question: str
    options: List[str]
    explanation: str = ""
    # correct_index is deliberately NOT sent to the client - see the route.


class TestOut(BaseModel):
    """A generated test: set info, attempt token (carries the seed) and questions."""
    content_id: int
    title: str
    attempt_token: str
    questions: List[TestQuestionOut]


class SubmitTestRequest(BaseModel):
    """Student's test submission: the token and one selected option index per question."""
    attempt_token: str
    answers: List[int]   # selected option index per question, -1 for skipped


class TestResultOut(BaseModel):
    """Graded test result with per-question feedback."""
    score: float
    correct_count: int
    total_count: int
    per_question: List[dict]


class MatchPairOut(BaseModel):
    """One term/definition pair for the Match drill."""
    index: int
    term: str
    definition: str


class MatchSetOut(BaseModel):
    """The pairs served for a Match drill."""
    content_id: int
    title: str
    pairs: List[MatchPairOut]


class SubmitMatchRequest(BaseModel):
    """Client-reported outcome of a Match drill."""
    pairs_total: int
    pairs_matched: int
    duration_seconds: int

    @field_validator("duration_seconds")
    @classmethod
    def sane_duration(cls, v: int) -> int:
        """Clamp the client-reported duration to 0..3600 seconds."""
        # Client-reported, so bounded rather than trusted: anything above an hour is
        # a stuck timer, not a real drill.
        return max(0, min(3600, v))


class StudySessionOut(BaseModel):
    """A saved study run (mode, score, counts, time) for history views."""
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
