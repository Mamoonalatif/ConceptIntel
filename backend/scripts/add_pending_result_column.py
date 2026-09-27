"""
One-off script to add `assignment_submissions.pending_result_json`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`,
which cannot add a column to an already-existing table - so this ALTER is a
manual migration step, mirroring `scripts/add_rubric_levels_and_grade_review.py`'s
style. Safe to run more than once - the ALTER uses IF NOT EXISTS.

WHY THIS EXISTS
----------------
The grade review-gate (grade_status: Ungraded -> PendingReview -> Approved,
see AssignmentSubmission in app/database/models.py) defers ConceptMastery
recording to the approve step, not the initial AI grading pass - but
ConceptMastery needs the AI result's `concept_scores`, and nothing on
AssignmentSubmission previously stored that. `rubric_scores_json` only ever
held the per-criterion breakdown, not per-concept scores. This column holds
the full raw grading result as JSON while a grade sits in PendingReview, so
approve_grade can actually finish the job grade_submission started.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_pending_result_column.py
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
            "ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS pending_result_json TEXT;"
        ))
        conn.commit()

    print("Ensured assignment_submissions.pending_result_json column exists.")
    print("Done.")


if __name__ == "__main__":
    main()
