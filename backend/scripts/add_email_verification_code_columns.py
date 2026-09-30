"""
One-off script adding the typed-verification-code columns to the existing
email_verification_tokens table (no Alembic here; create_all can't alter tables).
Safe to re-run. From backend/:  .venv\Scripts\python.exe scripts\add_email_verification_code_columns.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine


def main():
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS code_hash VARCHAR;"))
        conn.execute(text("ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;"))
        conn.commit()
    print("Done.")


if __name__ == "__main__":
    main()
