"""
One-off script to add the new columns/table this change needs on EXISTING tables:
  - users.totp_secret        (pending/confirmed TOTP secret, base32)
  - users.is_2fa_enabled     (whether login actually requires a code)
  - users.backup_codes_json  (hashed one-time backup codes)
  - users.token_version      (bumped to revoke every outstanding access/refresh token)
  - users.is_verified        (email ownership confirmed - see EmailVerificationToken)
  - email_verification_tokens (new table, created by create_all() below)

users.is_verified is added with DEFAULT TRUE specifically so every EXISTING account
(which never went through this flow) keeps working without interruption - only
accounts self-registered AFTER this migration start out unverified (the ORM's
Python-side default=False on User.is_verified overrides the column's DB default for
every INSERT going forward; see app/database/models.py).

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()`
on startup, which can't add a column to a table that already exists. Mirrors
scripts/add_question_bank_clo_column.py's style. Safe to run more than once - the
ALTERs use IF NOT EXISTS.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_2fa_columns.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    """Applies the schema change described in the module docstring to the existing database, then prints a summary."""
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR;"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE;"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes_json TEXT;"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;"
        ))
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT TRUE;"
        ))
        conn.commit()

    print("Ensured users.totp_secret / is_2fa_enabled / backup_codes_json / token_version / is_verified exist.")
    print("Ensured email_verification_tokens table exists.")
    print("Done.")


if __name__ == "__main__":
    main()
