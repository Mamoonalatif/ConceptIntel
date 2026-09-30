"""
One-off script to add the `program_id` column to `course_catalog` and backfill it.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()` on
startup, which creates brand-new tables (like `programs`) automatically but cannot add
a column to an already-existing table (`course_catalog`). This script is the manual
migration step for that one column, mirroring `scripts/create_admin.py`'s style. Safe
to run more than once - the ALTER uses IF NOT EXISTS and the seeding/backfill only
touch rows that still need it.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_program_column.py

or as a module:

    python -m scripts.add_program_column
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import SessionLocal, engine
from app.database import models
from app.database.models import Program, CourseCatalog

DEFAULT_PROGRAM_NAME = "Computer Science"


def main():
    # Ensure tables exist first (creates `programs`, `program_coordinator_assignments`,
    # `course_coordinator_assignments`, etc. - all brand-new tables `create_all` can
    # handle on its own; only the ALTER below is something it can't do).
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE course_catalog ADD COLUMN IF NOT EXISTS program_id INTEGER REFERENCES programs(id);"
        ))
        conn.commit()
    print("Ensured course_catalog.program_id column exists.")

    db = SessionLocal()
    try:
        program = db.query(Program).filter(Program.name == DEFAULT_PROGRAM_NAME).first()
        if program:
            print(f"Program '{DEFAULT_PROGRAM_NAME}' already exists (id={program.id}).")
        else:
            program = Program(
                name=DEFAULT_PROGRAM_NAME,
                description="Default program - every course on the platform currently belongs to it.",
            )
            db.add(program)
            db.commit()
            db.refresh(program)
            print(f"Created Program '{DEFAULT_PROGRAM_NAME}' (id={program.id}).")

        unscoped_entries = db.query(CourseCatalog).filter(CourseCatalog.program_id.is_(None)).all()
        for entry in unscoped_entries:
            entry.program_id = program.id
        if unscoped_entries:
            db.commit()
        print(
            f"Backfilled {len(unscoped_entries)} course_catalog row(s) with no program "
            f"to '{DEFAULT_PROGRAM_NAME}' (id={program.id})."
        )
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
