from pydantic import BaseModel, Field
from typing import Optional


class GenerateStructureRequest(BaseModel):
    title: str
    subject: str
    description: str = ""
    clos: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)


class CourseModuleSchema(BaseModel):
    id: str
    title: str
    week: int
    topics: list[str]
    duration: str
    description: Optional[str] = None


class GenerateStructureResponse(BaseModel):
    modules: list[CourseModuleSchema]
    clos: list[str]
