from datetime import date
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional

DESCRIPTION_MIN_WORDS = 5
DESCRIPTION_MAX_WORDS = 250


def check_description_word_count(v: str) -> str:
    word_count = len(v.split())
    if not (DESCRIPTION_MIN_WORDS <= word_count <= DESCRIPTION_MAX_WORDS):
        raise ValueError(f"Description must be between {DESCRIPTION_MIN_WORDS} and {DESCRIPTION_MAX_WORDS} words")
    return v


# --- Course Catalog (predefined offerings; admin-managed) ---

class CourseCatalogCreate(BaseModel):
    name: str
    code: str
    prerequisite_catalog_id: Optional[int] = None


class CourseCatalogUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    prerequisite_catalog_id: Optional[int] = None


class CourseCatalogResponse(BaseModel):
    id: int
    name: str
    code: str
    prerequisite_catalog_id: Optional[int] = None

    class Config:
        from_attributes = True


# --- Course instances ---

class CourseCreate(BaseModel):
    """Teacher-facing create payload. Teachers pick a predefined catalog entry rather
    than typing a freeform name/code, and cannot set the prerequisite mapping directly -
    it is derived server-side from the catalog entry (see courses/routes.py)."""
    catalog_id: int
    semester: str
    description: str
    enrollment_start: date
    enrollment_end: date
    start_date: date
    end_date: date
    max_students: Optional[int] = None

    @field_validator("description")
    @classmethod
    def check_description_length(cls, v: str) -> str:
        return check_description_word_count(v)

    @model_validator(mode="after")
    def check_date_ordering(self):
        if self.enrollment_start < date.today():
            raise ValueError("enrollment_start must not be in the past")
        if self.enrollment_start >= self.enrollment_end:
            raise ValueError("enrollment_start must be before enrollment_end")
        if self.enrollment_end > self.start_date:
            raise ValueError("enrollment_end must be before or equal to start_date")
        if self.start_date < date.today():
            raise ValueError("start_date must not be in the past")
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class CourseUpdate(BaseModel):
    """Teacher-facing update payload. Teachers may adjust the catalog selection,
    schedule/enrollment window, description, capacity, and status - but not the
    derived prerequisite mapping."""
    catalog_id: Optional[int] = None
    semester: Optional[str] = None
    description: Optional[str] = None
    enrollment_start: Optional[date] = None
    enrollment_end: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    max_students: Optional[int] = None
    status: Optional[str] = None  # "Draft", "Open", "Closed"

    @field_validator("description")
    @classmethod
    def check_description_length(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return check_description_word_count(v)

    @model_validator(mode="after")
    def check_date_ordering(self):
        # Only validate orderings where both sides of the comparison are present on
        # this partial update; full cross-field consistency against the DB row is
        # enforced in the route handler after merging with existing values.
        if self.enrollment_start and self.enrollment_start < date.today():
            raise ValueError("enrollment_start must not be in the past")
        if self.enrollment_start and self.enrollment_end and self.enrollment_start >= self.enrollment_end:
            raise ValueError("enrollment_start must be before enrollment_end")
        if self.enrollment_end and self.start_date and self.enrollment_end > self.start_date:
            raise ValueError("enrollment_end must be before or equal to start_date")
        if self.start_date and self.start_date < date.today():
            raise ValueError("start_date must not be in the past")
        if self.start_date and self.end_date and self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class CourseLookupResponse(BaseModel):
    """Minimal, read-only preview shape - deliberately excludes capacity, dates,
    teacher, or any other sensitive course detail."""
    name: str
    code: Optional[str] = None


class CourseResponse(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    semester: str
    enrollment_code: str
    max_students: Optional[int] = None
    status: str
    teacher_id: int
    prerequisite_course_id: Optional[int] = None
    catalog_id: Optional[int] = None
    description: Optional[str] = None
    enrollment_start: Optional[date] = None
    enrollment_end: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    graph_status: str = "Pending"

    class Config:
        from_attributes = True


# --- Admin-facing course management (full control) ---

class AdminCourseUpdate(BaseModel):
    """Admin-facing update payload - unlike CourseUpdate, admins may reassign the
    catalog entry (which changes name/code) and adjust the prerequisite mapping directly."""
    catalog_id: Optional[int] = None
    semester: Optional[str] = None
    description: Optional[str] = None
    enrollment_start: Optional[date] = None
    enrollment_end: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    max_students: Optional[int] = None
    status: Optional[str] = None
    prerequisite_course_id: Optional[int] = None
