from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CourseCreate(BaseModel):
    catalog_id: UUID
    teacher_id: UUID
    semester: str
    description: str = Field(min_length=20, max_length=100)
    max_students: Optional[int] = Field(default=None, gt=0)
    course_start_date: date
    course_duration_months: int = Field(gt=0)
    enrollment_start_date: date
    enrollment_end_date: date


class CourseUpdate(BaseModel):
    semester: Optional[str] = None
    description: Optional[str] = Field(default=None, min_length=20, max_length=100)
    max_students: Optional[int] = Field(default=None, gt=0)
    course_start_date: Optional[date] = None
    course_duration_months: Optional[int] = Field(default=None, gt=0)
    enrollment_start_date: Optional[date] = None
    enrollment_end_date: Optional[date] = None


class CourseOut(BaseModel):
    id: UUID
    catalog_id: UUID
    catalog_name: str
    catalog_code: str
    prerequisite_name: Optional[str] = None
    teacher_id: UUID
    teacher_name: str
    semester: str
    description: str
    max_students: Optional[int] = None
    course_start_date: date
    course_duration_months: int
    course_end_date: date
    enrollment_start_date: date
    enrollment_end_date: date
    enrollment_code: str
    invite_link: Optional[str] = None
    status: Literal["draft", "open", "closed"]
    enrolled_count: int
    created_at: datetime
    updated_at: datetime


class EnrollRequest(BaseModel):
    code: str
    student_id: UUID


class EnrollmentOut(BaseModel):
    id: UUID
    course_id: UUID
    student_id: UUID
    enrolled_at: datetime

    class Config:
        from_attributes = True
