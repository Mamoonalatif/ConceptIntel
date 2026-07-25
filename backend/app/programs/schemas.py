from typing import Optional
from pydantic import BaseModel


class ProgramCreate(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None


class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None


class ProgramResponse(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True
