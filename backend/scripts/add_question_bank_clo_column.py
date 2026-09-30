"""
One-off script to add the new column this change needs on an EXISTING table:
  - question_bank_items.clo_id   (link a bank question to a CLO, feeding
    CLOAttainment/PLOAttainment when an exam built from it is graded)

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which can't add a column to a table that already exists. Mirrors
scripts/add_clo_and_rubric_columns.py's style. Safe to run more than once - the
ALTER uses IF NOT EXISTS.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_question_bank_clo_column.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE question_bank_items "
            "ADD COLUMN IF NOT EXISTS clo_id INTEGER REFERENCES clos(id);"
        ))
        conn.commit()

    print("Ensured question_bank_items.clo_id exists.")
    print("Done.")


if __name__ == "__main__":
    main()
