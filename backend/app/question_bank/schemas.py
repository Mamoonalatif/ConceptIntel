from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator

from app.question_bank.service import QUESTION_TYPES


class QuestionIn(BaseModel):
    question_type: str
    prompt: str
    payload: Dict[str, Any]
    explanation: Optional[str] = None
    difficulty: str = "Medium"
    points: int = 1
    time_limit_seconds: Optional[int] = None
    concept_node_id: Optional[str] = None
    concept_name: Optional[str] = None

    @field_validator("question_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in QUESTION_TYPES:
            raise ValueError(f"question_type must be one of: {', '.join(QUESTION_TYPES)}")
        return v

    @field_validator("prompt")
    @classmethod
    def non_empty_prompt(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("A question needs a prompt.")
        return v.strip()

    @field_validator("difficulty")
    @classmethod
    def valid_difficulty(cls, v: str) -> str:
        cleaned = (v or "Medium").strip().capitalize()
        if cleaned not in ("Easy", "Medium", "Hard"):
            raise ValueError("difficulty must be Easy, Medium or Hard")
        return cleaned

    @field_validator("points")
    @classmethod
    def sane_points(cls, v: int) -> int:
        if not (1 <= v <= 100):
            raise ValueError("points must be between 1 and 100")
        return v

    @field_validator("time_limit_seconds")
    @classmethod
    def sane_limit(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return None
        if not (5 <= v <= 3600):
            raise ValueError("A per-question time limit must be between 5 seconds and 1 hour")
        return v


class QuestionUpdate(BaseModel):
    prompt: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    explanation: Optional[str] = None
    difficulty: Optional[str] = None
    points: Optional[int] = None
    time_limit_seconds: Optional[int] = None
    status: Optional[str] = None


class QuestionOut(BaseModel):
    id: int
    course_id: int
    question_type: str
    question_type_label: str
    prompt: str
    payload: Dict[str, Any]        # includes the answer key - teacher-facing only
    explanation: Optional[str] = None
    difficulty: str
    points: int
    time_limit_seconds: Optional[int] = None
    concept_node_id: Optional[str] = None
    concept_name: Optional[str] = None
    source: str
    status: str
    created_at: datetime


class ImportQuestionsRequest(BaseModel):
    """Lift an existing generated set into the bank as individual questions."""
    content_id: int


class ImportResultOut(BaseModel):
    imported: int
    skipped: int
    message: str


class GenerateQuestionsRequest(BaseModel):
    concept_node_id: str
    question_type: str
    count: int = 5
    difficulty: str = "Medium"

    @field_validator("question_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in QUESTION_TYPES:
            raise ValueError(f"question_type must be one of: {', '.join(QUESTION_TYPES)}")
        return v

    @field_validator("count")
    @classmethod
    def sane_count(cls, v: int) -> int:
        if not (1 <= v <= 20):
            raise ValueError("count must be between 1 and 20")
        return v

    @field_validator("difficulty")
    @classmethod
    def valid_difficulty(cls, v: str) -> str:
        cleaned = (v or "Medium").strip().capitalize()
        if cleaned not in ("Easy", "Medium", "Hard"):
            raise ValueError("difficulty must be Easy, Medium or Hard")
        return cleaned


class QuestionTypeInfo(BaseModel):
    key: str
    label: str
