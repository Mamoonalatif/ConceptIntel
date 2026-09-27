"""
Rebuild `content_chunks` for a new embedding model / dimension, then re-embed every
uploaded file from the text already stored in Postgres.

WHY THIS SCRIPT HAS TO EXIST
----------------------------
There is no Alembic here - `app/main.py` only calls `Base.metadata.create_all()`,
which creates missing tables but never alters an existing column. Editing
`Vector(384)` -> `Vector(1536)` in models.py is therefore a SILENT no-op against a
database that already exists: the app boots normally and then every ingestion INSERT
fails with a pgvector dimension mismatch, inside a broad `except` that only prints.
Uploads would appear to succeed while quietly producing zero chunks.

Postgres also cannot widen a vector column in place while rows exist, so the old
chunks must go first. That is safe: chunks are derived data. The source of truth is
`uploaded_files.extracted_text`, which is already in the database, so NOTHING NEEDS
RE-UPLOADING - this script re-chunks and re-embeds straight from those rows.

WHAT IT DOES
------------
  1. Reports the column's current width against settings.EMBEDDING_DIM.
  2. Deletes every content_chunks row (destructive - prompts unless --yes).
  3. ALTERs the embedding column to settings.EMBEDDING_DIM.
  4. Re-embeds each Completed 'material' file via the normal RAG pipeline.
  5. Creates an HNSW cosine index, which the project has never had - retrieval was
     a full sequential scan before this.

Outline files (material_kind='outline') are skipped by design: they are fed to the
model as structured context, never embedded. See scripts/add_material_kind_column.py.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\reembed_content_chunks.py
    backend\\.venv\\Scripts\\python.exe scripts\\reembed_content_chunks.py --yes
    backend\\.venv\\Scripts\\python.exe scripts\\reembed_content_chunks.py --course-id 3

Unlike the other data scripts this one DOES import app.rag (it needs the real
chunker and embedder). app/rag/chunking.py imports tiktoken, which is blocked by an
Application Control policy on some dev machines - if that import fails here, run the
script on a machine where it is permitted rather than working around it, since a
re-embed must produce byte-identical chunking to normal ingestion.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.config import settings
from app.database.connection import engine, SessionLocal
from app.database import models

INDEX_NAME = "ix_content_chunks_embedding_hnsw"


def current_column_dim(conn) -> int | None:
    """Reads the live declared width of content_chunks.embedding, or None if the
    table/column does not exist yet. format_type renders e.g. 'vector(384)'."""
    row = conn.execute(text(
        "SELECT format_type(a.atttypid, a.atttypmod) "
        "FROM pg_attribute a "
        "WHERE a.attrelid = to_regclass('public.content_chunks') "
        "  AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped;"
    )).fetchone()
    if not row or not row[0]:
        return None
    rendered = row[0]  # "vector(384)"
    if "(" not in rendered:
        return None
    try:
        return int(rendered.split("(")[1].rstrip(")"))
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Rebuild content_chunks at the configured embedding dimension and re-embed all files."
    )
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    parser.add_argument("--course-id", type=int, default=None,
                        help="Only re-embed one course's files (the column ALTER is still global).")
    parser.add_argument("--skip-index", action="store_true",
                        help="Do not create the HNSW index (it can take a while on a big table).")
    args = parser.parse_args()

    target_dim = settings.EMBEDDING_DIM
    print(f"Embedding provider : {settings.EMBEDDING_PROVIDER}")
    print(f"Embedding model    : {settings.EMBEDDING_MODEL}")
    print(f"Target dimension   : {target_dim}")

    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        live_dim = current_column_dim(conn)
        chunk_count = conn.execute(text("SELECT COUNT(*) FROM content_chunks;")).scalar() or 0
    print(f"Live column width  : {live_dim if live_dim is not None else 'unknown'}")
    print(f"Existing chunks    : {chunk_count}")

    if live_dim == target_dim and chunk_count > 0 and not args.course_id:
        print()
        print("Column already matches EMBEDDING_DIM and chunks exist.")
        print("Nothing to migrate. Re-run with --course-id to force a re-embed of one course.")
        return

    print()
    print(f"This DELETES all {chunk_count} content_chunks rows, widens the embedding column "
          f"to vector({target_dim}), and re-embeds every Completed 'material' file from "
          f"uploaded_files.extracted_text. No file needs re-uploading.")
    if not args.yes:
        if input("Type 'yes' to continue: ").strip().lower() != "yes":
            print("Aborted.")
            return

    # --- 1. clear + widen -------------------------------------------------
    # With --course-id only that course's chunks are deleted. Deleting every course's
    # chunks while re-embedding only one would silently wipe every other course's
    # search index - the opposite of what a scoped flag implies. The column ALTER is
    # still global, which is fine: it is a no-op when the width already matches, and
    # a width change genuinely cannot be scoped to one course.
    with engine.connect() as conn:
        if args.course_id:
            deleted = conn.execute(
                text("DELETE FROM content_chunks WHERE course_id = :cid;"),
                {"cid": args.course_id},
            ).rowcount
            conn.commit()
            print(f"Deleted {deleted} existing chunk(s) for course {args.course_id}.")
            if live_dim not in (None, target_dim):
                raise SystemExit(
                    f"Refusing to continue: the embedding column is vector({live_dim}) but "
                    f"EMBEDDING_DIM is {target_dim}. Widening it requires clearing EVERY "
                    f"course's chunks, so re-run without --course-id."
                )
        else:
            conn.execute(text("DELETE FROM content_chunks;"))
            conn.commit()
            print(f"Deleted {chunk_count} existing chunk(s).")

        # Drop the index first if present - it is tied to the old column type.
        conn.execute(text(f"DROP INDEX IF EXISTS {INDEX_NAME};"))
        conn.execute(text(
            f"ALTER TABLE content_chunks ALTER COLUMN embedding TYPE vector({target_dim});"
        ))
        conn.commit()
        print(f"Embedding column is now vector({target_dim}).")

    # Imported late so the destructive steps above are not blocked by an optional
    # dependency, and so the tiktoken policy note in this module's docstring
    # surfaces as a clear failure rather than an import error at startup.
    try:
        from app.rag.pipeline import process_file_for_rag
    except Exception as e:  # noqa: BLE001
        print()
        print(f"FAILED to import the RAG pipeline: {type(e).__name__}: {e}")
        print("The column has been migrated but nothing was re-embedded.")
        print("Fix the import (see this script's docstring re: tiktoken) and re-run.")
        raise SystemExit(1)

    # --- 2. re-embed ------------------------------------------------------
    db = SessionLocal()
    total_chunks = 0
    ok_files = 0
    failed = []
    try:
        query = db.query(models.UploadedFile).filter(
            models.UploadedFile.status == "Completed",
            models.UploadedFile.extracted_text.isnot(None),
            models.UploadedFile.material_kind == "material",
        )
        if args.course_id:
            query = query.filter(models.UploadedFile.course_id == args.course_id)
        files = query.order_by(models.UploadedFile.id).all()

        skipped_outlines = db.query(models.UploadedFile).filter(
            models.UploadedFile.material_kind == "outline"
        ).count()

        print()
        print(f"Re-embedding {len(files)} file(s); skipping {skipped_outlines} outline file(s) by design.")

        courses = {c.id: c.name for c in db.query(models.Course).all()}

        for i, f in enumerate(files, start=1):
            started = time.monotonic()
            try:
                n = process_file_for_rag(
                    db=db,
                    course_id=f.course_id,
                    file_id=f.id,
                    course_name=courses.get(f.course_id, "this course"),
                    file_name=f.filename,
                    raw_text=f.extracted_text or "",
                    file_type=f.file_type,
                    filepath=None,  # text-only re-embed; images were captioned at upload time
                )
                total_chunks += n
                ok_files += 1
                print(f"  [{i}/{len(files)}] {f.filename}: {n} chunk(s) in {time.monotonic() - started:.1f}s")
            except Exception as e:  # noqa: BLE001
                db.rollback()
                failed.append((f.id, f.filename, f"{type(e).__name__}: {e}"))
                print(f"  [{i}/{len(files)}] {f.filename}: FAILED - {type(e).__name__}: {e}")
    finally:
        db.close()

    # --- 3. index ---------------------------------------------------------
    if not args.skip_index and total_chunks > 0:
        print()
        print("Creating HNSW cosine index (this table has never had one - retrieval was a full scan)...")
        started = time.monotonic()
        with engine.connect() as conn:
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} "
                f"ON content_chunks USING hnsw (embedding vector_cosine_ops);"
            ))
            conn.commit()
        print(f"Index {INDEX_NAME} ready in {time.monotonic() - started:.1f}s.")

    print()
    print(f"Re-embedded {ok_files} file(s) into {total_chunks} chunk(s) at {target_dim} dimensions.")
    if failed:
        print(f"{len(failed)} file(s) FAILED and now have no chunks:")
        for fid, name, err in failed:
            print(f"  id={fid} {name}: {err}")
        raise SystemExit(1)
    print("Done.")


if __name__ == "__main__":
    main()
