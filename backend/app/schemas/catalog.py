from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class CatalogEntryOut(BaseModel):
    id: UUID
    name: str
    code: str
    prerequisite_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None
    coordinator_name: Optional[str] = None


class CatalogEntryCreate(BaseModel):
    name: str
    code: str
    prerequisite_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None


class CatalogEntryUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    prerequisite_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None
