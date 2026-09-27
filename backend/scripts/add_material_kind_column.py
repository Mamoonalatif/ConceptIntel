"""
One-off script to add the `material_kind` column to `uploaded_files`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates brand-new tables automatically but cannot add a column to
an already-existing table (`uploaded_files`). This script is the manual migration
step for that one column, mirroring `scripts/add_avatar_column.py`'s style. Safe to
run more than once - the ALTER uses IF NOT EXISTS.

`material_kind` separates the two kinds of thing a teacher uploads:

  "material" - lecture slides, notes, textbook chapters. Chunked and embedded, and
               retrieved to ground content generation and assignment grading.
  "outline"  - the course outline / syllabus. NOT embedded, on purpose: an outline
               is a table of contents, so its chunks are shallow and topically match
               almost any query, which lets them crowd genuine explanatory passages
               out of the top-k. It is passed to the model as structured context
               instead.

Every existing row is backfilled to 'material', which is what they all were.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_material_kind_column.py

or as a module:

    python -m scripts.add_material_kind_column
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
            "ALTER TABLE uploaded_files "
            "ADD COLUMN IF NOT EXISTS material_kind VARCHAR NOT NULL DEFAULT 'material';"
        ))
        conn.commit()
        rows = conn.execute(text(
            "SELECT material_kind, COUNT(*) FROM uploaded_files GROUP BY material_kind ORDER BY 1;"
        )).fetchall()

    print("Ensured uploaded_files.material_kind column exists (default 'material').")
    if rows:
        print("Current distribution:")
        for value, count in rows:
            print(f"  {value}: {count}")
    else:
        print("No uploaded_files rows yet.")
    print("Done.")


if __name__ == "__main__":
    main()
