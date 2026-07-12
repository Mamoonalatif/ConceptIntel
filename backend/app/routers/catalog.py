from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import CourseCatalog
from app.db.session import get_db
from app.schemas.catalog import CatalogEntryCreate, CatalogEntryOut, CatalogEntryUpdate

router = APIRouter(prefix="/catalog", tags=["catalog"])

# The 3 courses in the FYP scope (Scope Document §2) — seeded by
# backend/db/schema.sql. Coordinators/HOD/Admin may edit them but not delete them.
PROTECTED_CATALOG_IDS = {
    UUID("11111111-1111-1111-1111-111111111111"),
    UUID("22222222-2222-2222-2222-222222222222"),
    UUID("33333333-3333-3333-3333-333333333333"),
}


def _to_out(entry: CourseCatalog) -> CatalogEntryOut:
    return CatalogEntryOut(
        id=entry.id,
        name=entry.name,
        code=entry.code,
        prerequisite_id=entry.prerequisite_id,
        coordinator_id=entry.coordinator_id,
        coordinator_name=entry.coordinator.name if entry.coordinator else None,
    )


@router.get("", response_model=list[CatalogEntryOut])
def list_catalog(db: Session = Depends(get_db)):
    entries = db.query(CourseCatalog).order_by(CourseCatalog.created_at).all()
    return [_to_out(e) for e in entries]


@router.post("", response_model=CatalogEntryOut)
def create_catalog_entry(payload: CatalogEntryCreate, db: Session = Depends(get_db)):
    """
    Adding a brand new course to the catalog (growing the department's
    offerings) is an HOD/Admin decision — enforced in the frontend UI for now
    since there's no auth session yet to check roles against here.
    """
    if db.query(CourseCatalog).filter(CourseCatalog.code == payload.code).first():
        raise HTTPException(400, "A course with that code already exists")
    entry = CourseCatalog(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _to_out(entry)


@router.patch("/{catalog_id}", response_model=CatalogEntryOut)
def update_catalog_entry(catalog_id: UUID, payload: CatalogEntryUpdate, db: Session = Depends(get_db)):
    entry = db.get(CourseCatalog, catalog_id)
    if not entry:
        raise HTTPException(404, "Course not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return _to_out(entry)


@router.delete("/{catalog_id}", status_code=204)
def delete_catalog_entry(catalog_id: UUID, db: Session = Depends(get_db)):
    if catalog_id in PROTECTED_CATALOG_IDS:
        raise HTTPException(403, "Default in-scope courses cannot be deleted")
    entry = db.get(CourseCatalog, catalog_id)
    if not entry:
        raise HTTPException(404, "Course not found")
    db.delete(entry)
    db.commit()
