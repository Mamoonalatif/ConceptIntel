from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database.models import (
    Course, Assignment, AssignmentSubmission, Announcement, Material, Meeting,
    Comment, CourseCoordinatorAssignment, Enrollment, UploadedFile, ContentChunk,
)


def delete_course_cascade(db: Session, course: Course) -> None:
    """Deletes a course and every row that references it.

    Deliberately avoids `db.delete(course)` (the ORM-cascade path) - it lazy-
    loads relationships to cascade them, and at least one related table in
    this database has a column type psycopg2/SQLAlchemy can't decode
    (`InvalidRequestError: Unknown PG numeric type`), which blows up that
    lazy load. Every dependent table is instead cleared with a plain bulk
    DELETE (no ORM object loading), in FK dependency order, then the course
    row itself is bulk-deleted the same way.

    `graph_build_jobs` and `graph_edit_proposals` also FK to courses.id at the
    database level but have no SQLAlchemy model in this codebase (schema
    drift from a feature that isn't wired into the ORM yet) - deleted via raw
    SQL since there's no model to query/delete through.
    """
    db.execute(
        text("DELETE FROM graph_revisions WHERE job_id IN (SELECT id FROM graph_build_jobs WHERE course_id = :cid)"),
        {"cid": course.id},
    )
    db.execute(text("DELETE FROM graph_build_jobs WHERE course_id = :cid"), {"cid": course.id})
    db.execute(text("DELETE FROM graph_edit_proposals WHERE course_id = :cid"), {"cid": course.id})

    assignment_ids = [row.id for row in db.query(Assignment.id).filter(Assignment.course_id == course.id).all()]
    if assignment_ids:
        db.query(AssignmentSubmission).filter(
            AssignmentSubmission.assignment_id.in_(assignment_ids)
        ).delete(synchronize_session=False)
    db.query(Assignment).filter(Assignment.course_id == course.id).delete(synchronize_session=False)
    db.query(Announcement).filter(Announcement.course_id == course.id).delete(synchronize_session=False)
    db.query(Material).filter(Material.course_id == course.id).delete(synchronize_session=False)
    db.query(Meeting).filter(Meeting.course_id == course.id).delete(synchronize_session=False)
    db.query(Comment).filter(Comment.course_id == course.id).delete(synchronize_session=False)
    db.query(CourseCoordinatorAssignment).filter(
        CourseCoordinatorAssignment.course_id == course.id
    ).delete(synchronize_session=False)

    file_ids = [row.id for row in db.query(UploadedFile.id).filter(UploadedFile.course_id == course.id).all()]
    if file_ids:
        db.query(ContentChunk).filter(ContentChunk.file_id.in_(file_ids)).delete(synchronize_session=False)
    db.query(ContentChunk).filter(ContentChunk.course_id == course.id).delete(synchronize_session=False)
    db.query(UploadedFile).filter(UploadedFile.course_id == course.id).delete(synchronize_session=False)
    db.query(Enrollment).filter(Enrollment.course_id == course.id).delete(synchronize_session=False)

    db.query(Course).filter(Course.id == course.id).delete(synchronize_session=False)
    db.commit()
