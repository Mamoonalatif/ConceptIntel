"""
Seeds one scheduled offering per catalog course (Applied Physics, Digital
Logic Design, Calculus & Analytical Geometry) into the `courses` table.

Run once, from the backend/ directory, after schema.sql + seed_users.sql:
    python db/seed_courses.py

Safe to re-run: skips any catalog course that already has an offering for
the given semester.
"""

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.models import Course, CourseCatalog  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.services.course_logic import add_months, generate_enrollment_code, generate_invite_link  # noqa: E402

MOCK_TEACHER_ID = "00000000-0000-0000-0000-000000000001"
SEMESTER = "fall2026"

OFFERINGS = {
    "PHY101": dict(
        description="Introduction to mechanics, waves, and thermodynamics for engineers.",
        max_students=60,
        course_start_date=date(2026, 8, 15),
        course_duration_months=4,
        enrollment_start_date=date(2026, 7, 1),
        enrollment_end_date=date(2026, 8, 10),
    ),
    "PHY102": dict(
        description="Boolean algebra, logic gates, and combinational circuit design.",
        max_students=50,
        course_start_date=date(2026, 8, 15),
        course_duration_months=4,
        enrollment_start_date=date(2026, 7, 1),
        enrollment_end_date=date(2026, 8, 10),
    ),
    "MATH101": dict(
        description="Limits, derivatives, integrals, and analytical geometry foundations.",
        max_students=70,
        course_start_date=date(2026, 8, 15),
        course_duration_months=4,
        enrollment_start_date=date(2026, 7, 1),
        enrollment_end_date=date(2026, 8, 10),
    ),
}


def main():
    db = SessionLocal()
    try:
        for code, details in OFFERINGS.items():
            catalog_entry = db.query(CourseCatalog).filter_by(code=code).first()
            if not catalog_entry:
                print(f"skip {code}: not found in course_catalog")
                continue

            existing = (
                db.query(Course)
                .filter_by(catalog_id=catalog_entry.id, semester=SEMESTER)
                .first()
            )
            if existing:
                print(f"skip {code}: offering already exists for {SEMESTER}")
                continue

            course_end_date = add_months(
                details["course_start_date"], details["course_duration_months"]
            )
            enrollment_code = generate_enrollment_code(code, SEMESTER)

            course = Course(
                catalog_id=catalog_entry.id,
                teacher_id=MOCK_TEACHER_ID,
                semester=SEMESTER,
                description=details["description"],
                max_students=details["max_students"],
                course_start_date=details["course_start_date"],
                course_duration_months=details["course_duration_months"],
                course_end_date=course_end_date,
                enrollment_start_date=details["enrollment_start_date"],
                enrollment_end_date=details["enrollment_end_date"],
                enrollment_code=enrollment_code,
                invite_link=generate_invite_link(enrollment_code),
            )
            db.add(course)
            db.commit()
            print(f"created {code} offering — enrollment code {enrollment_code}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
