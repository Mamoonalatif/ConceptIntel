"""
One-off script to add the two new columns this change needs on EXISTING tables:
  - generated_content.clo_id       (link generated content to a CLO)
  - assignment_submissions.rubric_scores_json  (per-criterion rubric breakdown)

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates the brand-new tables this change also adds (clos, plos,
graduate_attributes, clo_plo_map, plo_ga_map, concept_clo_map, rubrics,
rubric_criteria, clo_attainment, clo_attainment_evidence) automatically. Only
these two ALTERs need a manual script, mirroring scripts/add_difficulty_column.py's
style. Safe to run more than once - both ALTERs use IF NOT EXISTS.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_clo_and_rubric_columns.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    # Creates every brand-new table this change adds - only the ALTERs below are
    # something create_all() can't do on its own.
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE generated_content "
            "ADD COLUMN IF NOT EXISTS clo_id INTEGER REFERENCES clos(id);"
        ))
        conn.execute(text(
            "ALTER TABLE assignment_submissions "
            "ADD COLUMN IF NOT EXISTS rubric_scores_json TEXT;"
        ))
        conn.commit()

    print("Ensured generated_content.clo_id and assignment_submissions.rubric_scores_json exist.")
    print("Ensured all CLO/PLO/GA/Rubric tables exist.")
    print("Done.")


if __name__ == "__main__":
    main()
