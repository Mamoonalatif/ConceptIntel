"""
One-off script to add the `avatar_url` column to `users`.

No Alembic in this project - `app/main.py` only calls `Base.metadata.create_all()` on
startup, which creates brand-new tables (like `notification_preferences`,
`chat_messages`) automatically but cannot add a column to an already-existing table
(`users`). This script is the manual migration step for that one column, mirroring
`scripts/add_program_column.py`'s style. Safe to run more than once - the ALTER uses
IF NOT EXISTS.

Run it from the `backend/` directory with the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\add_avatar_column.py

or as a module:

    python -m scripts.add_avatar_column
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database.connection import engine
from app.database import models


def main():
    # Ensure tables exist first (creates `notification_preferences`, `chat_messages`,
    # etc. - all brand-new tables `create_all` can handle on its own; only the ALTER
    # below is something it can't do).
    models.Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;"
        ))
        conn.commit()
    print("Ensured users.avatar_url column exists.")
    print("Done.")


if __name__ == "__main__":
    main()
