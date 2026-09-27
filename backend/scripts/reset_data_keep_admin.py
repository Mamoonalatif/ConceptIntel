"""One-off script: wipe every row of transactional/demo data EXCEPT admin user
accounts, then re-seed the 3 predefined courses (Applied Physics, Digital Logic
Design, Calculus & Analytical Geometry) grouped under a "Computer Science" Program.

This is destructive and irreversible for everything except admin accounts. Run it
from the `backend/` directory with the project's virtualenv:

    backend\\.venv\\Scripts\\python.exe scripts\\reset_data_keep_admin.py

Deliberately imports ONLY app.database.* - never app.content_processing/rag/
assistant/etc, which pull in tiktoken (blocked by an Application Control policy on
some dev machines) - a pure data-reset script has no reason to need those.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.connection import SessionLocal
from app.database import models

# Deleted in dependency order (children before parents) so FK constraints never
# block a delete. Order matters - anything referencing Course/User must go first.
TABLES_TO_WIPE = [
    # Gamification + generated-content tables. These were missing from this list:
    # because no FK in the schema declares ON DELETE CASCADE, leaving them behind
    # made the Course/User deletes below fail with an IntegrityError once a course
    # had any generated content, quiz attempt, game or points row.
    models.LiveQuizAnswer,
    models.LiveQuizParticipant,
    models.LiveQuizSession,
    models.ExamAttempt,
    models.Exam,
    models.QuestionBankItem,
    models.ContentGenerationJob,
    models.StudySession,
    models.StudyCardState,
    models.GamePlay,
    models.GeneratedGame,
    models.QuizAttempt,
    models.GeneratedContent,
    models.StudentBadge,
    models.PointsLedgerEntry,
    models.StudentPoints,
    models.MasteryEvidence,
    models.ConceptMastery,
    models.Comment,
    models.ChatMessage,
    models.GraphEditProposal,
    models.GraphRevision,
    models.GraphBuildJob,
    models.ContentChunk,
    models.UploadedFile,
    models.AssignmentSubmission,
    models.Assignment,
    models.Material,
    models.Meeting,
    models.Announcement,
    models.NotificationPreference,
    models.Notification,
    models.Enrollment,
    models.CourseCoordinatorAssignment,
    models.ProgramCoordinatorAssignment,
    models.Course,
    models.CourseCatalog,
    models.Program,
    models.TeacherRequest,
]


def main():
    parser = argparse.ArgumentParser(description="Wipe all data except admin accounts, then reseed the catalog.")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        admin_count = db.query(models.User).filter(models.User.role == "admin").count()
        non_admin_count = db.query(models.User).filter(models.User.role != "admin").count()
        print(f"Found {admin_count} admin account(s) - these are kept.")
        print(f"Found {non_admin_count} non-admin user(s) - these will be deleted, along with all their data.")

        if not args.yes:
            confirm = input("This will PERMANENTLY delete all data except admin accounts. Type 'yes' to continue: ")
            if confirm.strip().lower() != "yes":
                print("Aborted.")
                return

        for model in TABLES_TO_WIPE:
            count = db.query(model).delete()
            print(f"Deleted {count} row(s) from {model.__tablename__}")

        deleted_users = db.query(models.User).filter(models.User.role != "admin").delete()
        print(f"Deleted {deleted_users} non-admin user(s)")

        db.commit()
        print("Wipe complete.")

        # Re-seed: one Program grouping the 3 predefined catalog courses.
        cs_program = models.Program(name="Computer Science", code="CS", description="BS Computer Science")
        db.add(cs_program)
        db.flush()

        physics = models.CourseCatalog(name="Applied Physics", code="PHY101", program_id=cs_program.id)
        db.add(physics)
        db.flush()

        dld = models.CourseCatalog(
            name="Digital Logic Design", code="DLD201",
            prerequisite_catalog_id=physics.id, program_id=cs_program.id,
        )
        db.add(dld)

        calculus = models.CourseCatalog(
            name="Calculus & Analytical Geometry", code="MTH101", program_id=cs_program.id,
        )
        db.add(calculus)

        db.commit()
        print("Re-seeded: Program 'Computer Science' with 3 catalog courses "
              "(Applied Physics, Digital Logic Design [prereq: Applied Physics], Calculus & Analytical Geometry).")
        print("Note: these are catalog entries, not live Course sections - a teacher account "
              "still needs to create an actual Course instance from each catalog entry.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
