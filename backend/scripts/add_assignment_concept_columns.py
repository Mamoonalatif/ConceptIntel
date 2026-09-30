"""
One-off script to add `concept_node_id`/`concept_name` columns to `assignments`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates brand-new tables automatically but cannot add a column to
an already-existing table (`assignments`). This script is the manual migration step
for these two columns, mirroring `scripts/add_difficulty_column.py`'s style. Safe to
run more than once - the ALTERs use IF NOT EXISTS.

Both columns are nullable and left NULL for every pre-existing row: a plain,
manually-created assignment genuinely has no concept origin, so NULL is the correct
(not a placeholder) value there - only assignments created via the AI/content-
generation "create-assignment" flow from now on will have these populated.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_assignment_concept_columns.py

or as a module:

    python -m scripts.add_assignment_concept_columns
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    # Creates any brand-new tables create_all CAN handle on its own; only the
    # ALTERs below are something it can't.
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS concept_node_id VARCHAR;"
        ))
        conn.execute(text(
            "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS concept_name VARCHAR;"
        ))
        conn.commit()
        result = conn.execute(text(
            "SELECT COUNT(*) FILTER (WHERE concept_node_id IS NOT NULL), COUNT(*) FROM assignments;"
        ))
        with_concept, total = result.fetchone()

    print("Ensured assignments.concept_node_id / concept_name columns exist.")
    print(f"{with_concept}/{total} existing assignments already have a concept link (expected: 0).")
    print("Done.")


if __name__ == "__main__":
    main()
