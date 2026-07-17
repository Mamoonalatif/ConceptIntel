"""
One-off script to drop every table and recreate an empty schema.

This is destructive and irreversible - it deletes ALL data (users, courses,
enrollments, uploaded files, everything). Only run it when you actually want to
wipe the database back to a blank slate.

Run it from the `backend/` directory with the project's virtualenv:

    backend\\.venv\\Scripts\\python.exe scripts\\reset_db.py

Pass --seed-catalog to also re-seed the 3 predefined courses (Applied Physics,
Digital Logic Design, Calculus & Analytical Geometry) after recreating the schema:

    backend\\.venv\\Scripts\\python.exe scripts\\reset_db.py --seed-catalog

Note: this only drops/creates tables - it does NOT recreate an admin account.
Run scripts/create_admin.py afterward if you need one.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.connection import engine, SessionLocal
from app.database import models


def main():
    parser = argparse.ArgumentParser(description="Drop and recreate all database tables.")
    parser.add_argument("--seed-catalog", action="store_true", help="Re-seed the 3 predefined courses after recreating tables.")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    args = parser.parse_args()

    if not args.yes:
        confirm = input("This will PERMANENTLY delete all data in the database. Type 'yes' to continue: ")
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            return

    print("Dropping all tables...")
    models.Base.metadata.drop_all(bind=engine)
    print("Recreating empty schema...")
    models.Base.metadata.create_all(bind=engine)
    print("Done - database is now empty.")

    if args.seed_catalog:
        db = SessionLocal()
        try:
            physics = models.CourseCatalog(name="Applied Physics", code="PHY101")
            db.add(physics)
            db.flush()
            dld = models.CourseCatalog(name="Digital Logic Design", code="DLD201", prerequisite_catalog_id=physics.id)
            db.add(dld)
            calculus = models.CourseCatalog(name="Calculus & Analytical Geometry", code="MTH101")
            db.add(calculus)
            db.commit()
            print("Seeded predefined course catalog.")
        finally:
            db.close()


if __name__ == "__main__":
    main()
