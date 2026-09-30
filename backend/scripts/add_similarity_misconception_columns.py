"""
One-off script to add three columns to `assignment_submissions`:

  * extracted_text       - cached plain text of the submitted file (similarity checks)
  * similarity_json      - similar-assignment report for the teacher
  * misconceptions_json  - AI-detected misconceptions, saved when a grade is approved

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`,
which cannot add columns to an existing table - so this is a manual migration step
(same style as `scripts/add_pending_result_column.py`). Safe to run more than once.

Run from the `backend/` directory with the project's virtualenv, e.g.:

    .venv\Scripts\python.exe scripts\add_similarity_misconception_columns.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    """Adds the three new nullable TEXT columns if they do not exist yet."""
    models.Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for col in ("extracted_text", "similarity_json", "misconceptions_json"):
            conn.execute(text(f"ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS {col} TEXT"))
            print(f"ensured column assignment_submissions.{col}")


if __name__ == "__main__":
    main()
