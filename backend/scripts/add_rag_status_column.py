"""
One-off script to add the `rag_status` / `rag_error` columns to `uploaded_files`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which creates brand-new tables automatically but cannot add a column to
an already-existing table (`uploaded_files`). This script is the manual migration
step for these two columns, mirroring `scripts/add_material_kind_column.py`'s style.
Safe to run more than once - the ALTERs use IF NOT EXISTS.

WHY THIS EXISTS
----------------
Before this, `UploadedFile.status` was the only status a teacher could see, and it
only ever reflected TEXT EXTRACTION succeeding - not whether RAG ingestion (chunk +
embed, app/rag/pipeline.py) also succeeded. A file could sit at status="Completed"
while silently having zero embedded chunks (a RAG failure only visible in a server
log), and a teacher had no way to tell. `rag_status` records that outcome
separately: "Pending" | "Completed" | "Failed" | "Skipped" (outlines are deliberately
never embedded - see app/rag/pipeline.py's module docstring).

BACKFILL LOGIC for existing rows
---------------------------------
  material_kind == 'outline'                          -> 'Skipped'
  has >=1 content_chunks row                           -> 'Completed'
  status != 'Completed' (extraction itself never ran)  -> 'Pending'
  status == 'Completed' but extracted_text is blank    -> 'Pending' (nothing to embed)
  status == 'Completed', material file, non-blank text,
    but zero chunks                                    -> 'Failed' (this is exactly
                                                           the previously-invisible gap)

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_rag_status_column.py

or as a module:

    python -m scripts.add_rag_status_column
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
            "ADD COLUMN IF NOT EXISTS rag_status VARCHAR NOT NULL DEFAULT 'Pending';"
        ))
        conn.execute(text(
            "ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS rag_error TEXT;"
        ))
        conn.commit()

        conn.execute(text("""
            UPDATE uploaded_files SET rag_status = 'Skipped'
            WHERE material_kind = 'outline';
        """))
        conn.execute(text("""
            UPDATE uploaded_files uf SET rag_status = 'Completed'
            WHERE uf.material_kind != 'outline'
              AND EXISTS (SELECT 1 FROM content_chunks cc WHERE cc.file_id = uf.id);
        """))
        conn.execute(text("""
            UPDATE uploaded_files SET rag_status = 'Pending'
            WHERE material_kind != 'outline'
              AND (status != 'Completed' OR extracted_text IS NULL OR trim(extracted_text) = '')
              AND rag_status = 'Pending';
        """))
        conn.execute(text("""
            UPDATE uploaded_files uf SET rag_status = 'Failed'
            WHERE uf.material_kind != 'outline'
              AND uf.status = 'Completed'
              AND uf.extracted_text IS NOT NULL AND trim(uf.extracted_text) != ''
              AND NOT EXISTS (SELECT 1 FROM content_chunks cc WHERE cc.file_id = uf.id)
              AND uf.rag_status = 'Pending';
        """))
        conn.commit()

        rows = conn.execute(text(
            "SELECT rag_status, COUNT(*) FROM uploaded_files GROUP BY rag_status ORDER BY 1;"
        )).fetchall()

    print("Ensured uploaded_files.rag_status/rag_error columns exist.")
    if rows:
        print("Current distribution:")
        for value, count in rows:
            print(f"  {value}: {count}")
    else:
        print("No uploaded_files rows yet.")
    print("Done.")


if __name__ == "__main__":
    main()
