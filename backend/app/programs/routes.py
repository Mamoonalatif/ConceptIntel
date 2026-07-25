from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Program, CourseCatalog, User
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
