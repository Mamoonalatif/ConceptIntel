# Pydantic models for academic programs (degree programs that group course catalog entries).
from typing import Optional
from pydantic import BaseModel


# Payload for creating a program.
class ProgramCreate(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None


# Partial update; all fields optional.
class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None


# Program returned to clients.
class ProgramResponse(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True
