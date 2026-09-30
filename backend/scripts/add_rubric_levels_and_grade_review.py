"""
One-off script for two related changes to the assignments/rubric schema:

1. Creates the new `rubric_levels` table (RubricLevel model) - a brand-new table,
   so `Base.metadata.create_all()` handles it with no ALTER needed. Each
   RubricCriterion can now carry a real analytic-rubric grid (e.g. Excellent/
   Good/Fair/Poor, each with its own fixed points and description) instead of
   being a single free-form point count.

2. Adds `grade_status` and `grading_locked_at` to `assignment_submissions` - the
   review gate an AI grade previously did not have (it used to write straight to
   `grade`/`feedback` and notify the student immediately), and a single-flight
   guard against a double "Grade" click running two AI passes concurrently. No
   Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`,
   which cannot add a column to an already-existing table - so this ALTER is a
   manual migration step, mirroring `scripts/add_material_kind_column.py`'s style.
   Safe to run more than once - the ALTERs use IF NOT EXISTS.

BACKFILL for existing rows: a submission that already has a grade was, under the
old behavior, already shown to its student as final - so it is backfilled to
grade_status='Approved', not 'PendingReview' (which would silently hide a grade
a student has already seen). A never-graded submission gets the default
'Ungraded'.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_rubric_levels_and_grade_review.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)  # creates rubric_levels

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE assignment_submissions "
            "ADD COLUMN IF NOT EXISTS grade_status VARCHAR NOT NULL DEFAULT 'Ungraded';"
        ))
        conn.execute(text(
            "ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS grading_locked_at TIMESTAMP;"
        ))
        conn.commit()

        conn.execute(text(
            "UPDATE assignment_submissions SET grade_status = 'Approved' "
            "WHERE grade IS NOT NULL AND grade_status = 'Ungraded';"
        ))
        conn.commit()

        rows = conn.execute(text(
            "SELECT grade_status, COUNT(*) FROM assignment_submissions GROUP BY grade_status ORDER BY 1;"
        )).fetchall()
        level_count = conn.execute(text("SELECT COUNT(*) FROM rubric_levels;")).scalar()

    print("Ensured rubric_levels table exists.")
    print("Ensured assignment_submissions.grade_status/grading_locked_at columns exist.")
    print(f"rubric_levels rows: {level_count}")
    if rows:
        print("assignment_submissions.grade_status distribution:")
        for value, count in rows:
            print(f"  {value}: {count}")
    else:
        print("No assignment_submissions rows yet.")
    print("Done.")


if __name__ == "__main__":
    main()
