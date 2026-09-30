"""
One-off script to add the new column this change needs on an EXISTING table:
  - assignments.source_content_id  (links an Assignment back to the AI-drafted
    GeneratedContent row it was created from, if any - see
    content_generation/routes.py create_assignment_from_content)

Without this, GeneratedContent.status == "Approved" was the only signal the
frontend had for "has this draft already become a real Assignment?" - which is
ambiguous (status is also set to Approved by other paths) and left at least
one real draft stuck: marked Approved with no Assignment ever created, and no
way back into the Create Assignment button that could fix it.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which can't add a column to a table that already exists. Mirrors
scripts/add_question_bank_clo_column.py's style. Safe to run more than once -
the ALTER uses IF NOT EXISTS.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_assignment_source_content_column.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE assignments "
            "ADD COLUMN IF NOT EXISTS source_content_id INTEGER REFERENCES generated_content(id);"
        ))
        conn.commit()

    print("Ensured assignments.source_content_id exists.")
    print("Done.")


if __name__ == "__main__":
    main()
