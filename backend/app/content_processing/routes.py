import logging
from typing import List

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.connection import get_db
from app.database.models import Course, GraphBuildJob, GraphRevision, User
from app.content_processing.schemas import (
    TriggerPipelineRequest,
    GraphBuildJobResponse,
    GraphRevisionResponse,
    TeacherReviewRequest,
)
from app.content_processing.pipeline_service import run_pipeline_sync
from app.knowledge_graph import revision_service
from app.courses.access import assert_course_access
from app.auth.routes import get_current_teacher, get_current_user

logger = logging.getLogger("conceptintel.content_processing")

router = APIRouter(prefix="/content-processing", tags=["Content Processing"])


def _resolve_catalog_id(course: Course) -> int:
    return course.catalog_id if course.catalog_id is not None else course.id


def _try_trigger_airflow(job_id: int) -> bool:
    """Attempts to trigger the Airflow DAG run for this job. Returns True if Airflow
    accepted the run, False if it's unreachable/not set up (caller should fall back
    to running the pipeline inline via BackgroundTasks)."""
    if not settings.AIRFLOW_BASE_URL:
        return False
    try:
        url = f"{settings.AIRFLOW_BASE_URL}/dags/{settings.AIRFLOW_DAG_ID}/dagRuns"
        response = httpx.post(
            url,
            json={"conf": {"job_id": job_id}},
            auth=(settings.AIRFLOW_USERNAME, settings.AIRFLOW_PASSWORD),
            timeout=5.0,
        )
        response.raise_for_status()
        return True
    except Exception as e:
        logger.warning("Airflow unreachable, falling back to BackgroundTasks: %s", str(e))
        return False


@router.post("/trigger/{course_id}", response_model=GraphBuildJobResponse, status_code=status.HTTP_202_ACCEPTED)
def trigger_pipeline(
    course_id: int,
    body: TriggerPipelineRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """
    Kicks off the reviewed content pipeline (OCR'd text - already stored on each
    UploadedFile - -> AI cleaning/structuring -> diff against the catalog's shared
    graph -> teacher review -> coordinator approval -> merge). Requires at least one
    uploaded file for this course with status 'Completed'.
    """
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    NON_TERMINAL_STATUSES = ("Queued", "ExtractingText", "CleaningAndStructuring", "Diffing",
                             "AwaitingTeacherReview", "AwaitingCoordinatorApproval")
    existing = (
        db.query(GraphBuildJob)
        .filter(GraphBuildJob.course_id == course_id, GraphBuildJob.status.in_(NON_TERMINAL_STATUSES))
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A pipeline run (job #{existing.id}, status '{existing.status}') is already in "
                   f"progress for this course. Wait for it to finish, or review/reject it, before starting another."
        )

    job = GraphBuildJob(
        catalog_id=_resolve_catalog_id(course),
        course_id=course_id,
        triggered_by_teacher_id=current_teacher.id,
        teacher_notes=body.teacher_notes,
        status="Queued",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    if _try_trigger_airflow(job.id):
        job.airflow_run_id = f"manual__job_{job.id}"
        db.commit()
    else:
        background_tasks.add_task(run_pipeline_sync, job.id)

    return job


@router.get("/jobs/{job_id}", response_model=GraphBuildJobResponse)
def get_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Poll the status of a pipeline run (Queued -> ExtractingText ->
    CleaningAndStructuring -> Diffing -> AwaitingTeacherReview ->
    AwaitingCoordinatorApproval -> Merged / Rejected / Failed)."""
    job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    course = db.query(Course).filter(Course.id == job.course_id).first()
    if course:
        assert_course_access(db, course, current_user)
    return job


@router.get("/jobs/course/{course_id}", response_model=List[GraphBuildJobResponse])
def list_jobs_for_course(course_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all pipeline runs ever triggered for a course, newest first."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)
    return (
        db.query(GraphBuildJob)
        .filter(GraphBuildJob.course_id == course_id)
        .order_by(GraphBuildJob.created_at.desc())
        .all()
    )


@router.get("/jobs/{job_id}/revision", response_model=GraphRevisionResponse)
def get_job_revision(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Convenience lookup: given a job id, fetch the revision (diff) it produced."""
    revision = db.query(GraphRevision).filter(GraphRevision.job_id == job_id).order_by(GraphRevision.id.desc()).first()
    if not revision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No revision yet for this job - it may still be running, or failed before reaching the diff stage."
        )
    job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
    if job:
        course = db.query(Course).filter(Course.id == job.course_id).first()
        if course:
            assert_course_access(db, course, current_user)
    return revision_service.serialize_revision(revision)


@router.post("/revisions/{revision_id}/teacher-review", response_model=GraphRevisionResponse)
def review_revision(
    revision_id: int,
    body: TeacherReviewRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """
    The uploading teacher (or any teacher of the course) reviews the proposed diff -
    confirming (optionally after editing it) sends it to the course coordinator for
    final approval; rejecting ends it here without ever touching Neo4j.
    """
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if revision:
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        if job:
            course = db.query(Course).filter(Course.id == job.course_id).first()
            if course:
                assert_course_access(db, course, current_teacher)

    revision = revision_service.teacher_review(
        db, revision_id,
        teacher_id=current_teacher.id,
        action=body.action,
        edited_diff=body.edited_diff,
        notes=body.notes,
    )
    return revision_service.serialize_revision(revision)
