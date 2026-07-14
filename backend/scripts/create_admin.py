"""
One-off script to seed an admin user directly into the database.

Admin accounts are never created via a public API endpoint - this script is the
only supported way to provision one. Run it from the `backend/` directory with
the project's virtualenv, e.g.:

    backend\\.venv\\Scripts\\python.exe scripts\\create_admin.py \\
        --email admin@conceptintel.edu --full-name "System Admin" --password "S3cure!Pass"

Arguments can also be supplied via environment variables instead of flags:
    ADMIN_EMAIL, ADMIN_FULL_NAME, ADMIN_PASSWORD

Usage examples:
    python scripts/create_admin.py --email a@b.com --full-name "Jane Admin" --password "Str0ng!Pw"
    ADMIN_EMAIL=a@b.com ADMIN_FULL_NAME="Jane Admin" ADMIN_PASSWORD="Str0ng!Pw" python scripts/create_admin.py
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.connection import SessionLocal, engine
from app.database import models
from app.database.models import User
from app.auth.utils import hash_password


def main():
    parser = argparse.ArgumentParser(description="Seed an admin user.")
    parser.add_argument("--email", default=os.environ.get("ADMIN_EMAIL"))
    parser.add_argument("--full-name", default=os.environ.get("ADMIN_FULL_NAME"))
    parser.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD"))
    args = parser.parse_args()

    if not args.email or not args.full_name or not args.password:
        parser.error("--email, --full-name, and --password (or ADMIN_EMAIL/ADMIN_FULL_NAME/ADMIN_PASSWORD env vars) are required")

    # Ensure tables exist (safe/idempotent - matches app.main startup behavior)
    models.Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == args.email).first()
        if existing:
            print(f"A user with email {args.email} already exists (role={existing.role}). Aborting.")
            return

        admin_user = User(
            email=args.email,
            hashed_password=hash_password(args.password),
            full_name=args.full_name,
            role="admin",
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        print(f"Admin user created: id={admin_user.id} email={admin_user.email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
