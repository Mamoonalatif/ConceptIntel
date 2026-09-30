"""
One-off script to add the `difficulty` column to `generated_content`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates brand-new tables automatically but cannot add a column to
an already-existing table (`generated_content`). This script is the manual migration
step for that one column, mirroring `scripts/add_avatar_column.py`'s style. Safe to
run more than once - the ALTER uses IF NOT EXISTS.

Existing rows are backfilled to 'Medium' rather than left NULL, because the column is
declared NOT NULL in the model and every pre-existing item was generated before a
difficulty could be chosen.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_difficulty_column.py

or as a module:

    python -m scripts.add_difficulty_column
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    # Creates any brand-new tables (e.g. generated_games, game_plays) that
    # create_all CAN handle on its own; only the ALTER below is something it can't.
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE generated_content "
            "ADD COLUMN IF NOT EXISTS difficulty VARCHAR NOT NULL DEFAULT 'Medium';"
        ))
        # Added in the same change: how many retrieved course-material excerpts the
        # item was grounded in. 0 for every pre-existing row, which is accurate -
        # they were all generated before retrieval was wired into generation.
        conn.execute(text(
            "ALTER TABLE generated_content "
            "ADD COLUMN IF NOT EXISTS grounded_excerpts INTEGER NOT NULL DEFAULT 0;"
        ))
        conn.commit()
        result = conn.execute(text(
            "SELECT difficulty, COUNT(*) FROM generated_content GROUP BY difficulty ORDER BY 1;"
        ))
        rows = result.fetchall()

    print("Ensured generated_content.difficulty column exists (default 'Medium').")
    if rows:
        print("Current distribution:")
        for value, count in rows:
            print(f"  {value}: {count}")
    else:
        print("No generated_content rows yet.")
    print("Done.")


if __name__ == "__main__":
    main()
