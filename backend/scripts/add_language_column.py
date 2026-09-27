"""
One-off script to add the `language` column to `generated_content`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates brand-new tables automatically but cannot add a column to
an already-existing table. This is the manual migration step for that one column,
mirroring `scripts/add_difficulty_column.py`. Safe to run more than once - the ALTER
uses IF NOT EXISTS.

Existing rows are backfilled to 'English' rather than left NULL: every item generated
before this column existed was written in English, because there was no way to ask
for anything else.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_language_column.py

or as a module:

    python -m scripts.add_language_column
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    # Creates any brand-new tables create_all CAN handle on its own; only the ALTER
    # below is something it cannot.
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE generated_content "
            "ADD COLUMN IF NOT EXISTS language VARCHAR NOT NULL DEFAULT 'English';"
        ))
        conn.commit()
        rows = conn.execute(text(
            "SELECT language, COUNT(*) FROM generated_content GROUP BY language ORDER BY 2 DESC;"
        )).fetchall()

    print("Ensured generated_content.language column exists (default 'English').")
    if rows:
        print("Current distribution:")
        for value, count in rows:
            print(f"  {value}: {count}")
    else:
        print("No generated_content rows yet.")
    print("Done.")


if __name__ == "__main__":
    main()
