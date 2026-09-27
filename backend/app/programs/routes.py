from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Program, CourseCatalog, User, ProgramCoordinatorAssignment
from app.programs.schemas import ProgramCreate, ProgramUpdate, ProgramResponse
from app.auth.routes import get_current_user, get_current_admin

router = APIRouter(prefix="/programs", tags=["Programs"])


def _get_program_or_404(db: Session, program_id: int) -> Program:
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return program


@router.get("", response_model=List[ProgramResponse])
def list_programs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Read-only listing for any authenticated user - used by pickers (catalog entry
    creation, staff scope assignment, etc). Only mutation is admin-only."""
    return db.query(Program).order_by(Program.name).all()


@router.post("", response_model=ProgramResponse, status_code=status.HTTP_201_CREATED)
def create_program(
    program_in: ProgramCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    existing = db.query(Program).filter(Program.name == program_in.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A program with this name already exists.")

    new_program = Program(
        name=program_in.name,
        code=program_in.code,
        description=program_in.description,
    )
    db.add(new_program)
    db.commit()
    db.refresh(new_program)
    return new_program


@router.put("/{id}", response_model=ProgramResponse)
def update_program(
    id: int,
    program_in: ProgramUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    program = _get_program_or_404(db, id)

    update_data = program_in.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] != program.name:
        existing = db.query(Program).filter(Program.name == update_data["name"]).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A program with this name already exists.")

    for field, value in update_data.items():
        setattr(program, field, value)

    db.commit()
    db.refresh(program)
    return program


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_program(
    id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Deleting a program doesn't cascade-delete its catalog entries - they're simply
    unscoped (program_id set to null) rather than left dangling or blocking the
    delete, since a catalog entry can legitimately exist without a program."""
    program = _get_program_or_404(db, id)

    db.query(CourseCatalog).filter(CourseCatalog.program_id == program.id).update(
        {"program_id": None}, synchronize_session=False
    )
    db.delete(program)
    db.commit()
    return None


# --- Program Coordinator scope (which program(s) a coordinator is assigned to) ---
#
# is_program_coordinator (see auth/routes.py StaffAuthoritiesUpdate) only grants the
# AUTHORITY - it was never paired with a way to actually pick which program(s) that
# authority applies to, so a newly-flagged coordinator had no scope at all
# (resolve_program_ids would return an empty set for them, same as "coordinator of
# nothing"). These endpoints are that missing piece, admin-only since there's no
# role above Program Coordinator to delegate this to (mirrors how Course Coordinator
# assignment is Program-Coordinator-only in courses/routes.py).

class ProgramCoordinatorAssignRequest(BaseModel):
    user_id: int


class ProgramCoordinatorEntry(BaseModel):
    id: int
    full_name: str
    email: str

    class Config:
        from_attributes = True


@router.post("/{id}/coordinators", response_model=ProgramCoordinatorEntry, status_code=status.HTTP_201_CREATED)
def assign_program_coordinator(
    id: int,
    payload: ProgramCoordinatorAssignRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Adds this program to the target user's coordinator scope. Additive, not
    replace-all - unlike Course Coordinator (scoped to exactly one course), a
    Program Coordinator can legitimately oversee more than one program."""
    program = _get_program_or_404(db, id)
    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not target_user.is_program_coordinator:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grant this user Program Coordinator authority first (Manage Coordinator Authorities), then assign a program.",
        )

    existing = db.query(ProgramCoordinatorAssignment).filter(
        ProgramCoordinatorAssignment.user_id == target_user.id,
        ProgramCoordinatorAssignment.program_id == program.id,
    ).first()
    if not existing:
        db.add(ProgramCoordinatorAssignment(user_id=target_user.id, program_id=program.id))
        db.commit()
    return target_user


@router.delete("/{id}/coordinators/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_program_coordinator(
    id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    assignment = db.query(ProgramCoordinatorAssignment).filter(
        ProgramCoordinatorAssignment.user_id == user_id,
        ProgramCoordinatorAssignment.program_id == id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program coordinator assignment not found")
    db.delete(assignment)
    db.commit()
    return None


@router.get("/{id}/coordinators", response_model=List[ProgramCoordinatorEntry])
def list_program_coordinators(
    id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    _get_program_or_404(db, id)
    return (
        db.query(User)
        .join(ProgramCoordinatorAssignment, ProgramCoordinatorAssignment.user_id == User.id)
        .filter(ProgramCoordinatorAssignment.program_id == id)
        .all()
    )
