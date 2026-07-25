import logging
from typing import Any, Dict, List

from app.database.connection import SessionLocal
from app.database.models import GraphBuildJob, UploadedFile, CourseCatalog
from app.content_processing import kimi_service
from app.knowledge_graph import revision_service
from app.knowledge_graph.services import neo4j_service

logger = logging.getLogger("conceptintel.pipeline")


def _get_job_or_raise(db, job_id: int) -> GraphBuildJob:
    job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
    if not job:
        raise ValueError(f"GraphBuildJob {job_id} not found")
    return job


def _update_status(db, job: GraphBuildJob, new_status: str) -> None:
    job.status = new_status
    db.commit()


def _fail_job(job_id: int, error_message: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
        if job:
            job.status = "Failed"
            job.error_message = error_message[:2000]
            db.commit()
    finally:
        db.close()


def stage_extract_text(job_id: int) -> str:
    """Stage 1: gather already-extracted text (OCR'd at upload time if needed) from
    every successfully processed file uploaded for this course."""
    db = SessionLocal()
    try:
        job = _get_job_or_raise(db, job_id)
        _update_status(db, job, "ExtractingText")

        files = db.query(UploadedFile).filter(
            UploadedFile.course_id == job.course_id,
            UploadedFile.status == "Completed"
        ).all()
        combined = "\n\n".join(f.extracted_text for f in files if f.extracted_text)

        if not combined.strip():
            raise ValueError(
                "No extracted text available - make sure at least one uploaded file "
                "for this course has finished processing (status 'Completed')."
            )
        return combined
    except Exception as e:
        logger.error("Pipeline stage_extract_text failed for job %d: %s", job_id, str(e))
        _fail_job(job_id, str(e))
        raise
    finally:
        db.close()


def stage_clean_and_structure(job_id: int, combined_text: str) -> List[Dict[str, Any]]:
    """Stage 2: Kimi K2 cleans OCR/typo noise and extracts structured concepts, one
    result per text chunk - scoped to this job's course name/code, and grounded
    against concepts that already exist in the catalog's shared graph so Kimi can
    recognize reworded duplicates up front rather than relying purely on the
    post-hoc dedup in revision_service.compute_diff()."""
    db = SessionLocal()
    try:
        job = _get_job_or_raise(db, job_id)
        _update_status(db, job, "CleaningAndStructuring")

        catalog = db.query(CourseCatalog).filter(CourseCatalog.id == job.catalog_id).first()
        course_name = catalog.name if catalog else f"Course #{job.catalog_id}"
        course_code = catalog.code if catalog else None
        existing_concept_names = neo4j_service.get_existing_concept_names(job.catalog_id)

        return kimi_service.structure_full_text(
            combined_text,
            course_name=course_name,
            course_code=course_code,
            teacher_notes=job.teacher_notes,
            existing_concept_names=existing_concept_names,
        )
    except Exception as e:
        logger.error("Pipeline stage_clean_and_structure failed for job %d: %s", job_id, str(e))
        _fail_job(job_id, str(e))
        raise
    finally:
        db.close()


def stage_diff_and_propose(job_id: int, chunk_extractions: List[Dict[str, Any]]) -> int:
    """Stage 3: diff the structured concepts against the catalog's live graph and
    save the proposal for teacher review. Returns the new GraphRevision id."""
    db = SessionLocal()
    try:
        job = _get_job_or_raise(db, job_id)
        _update_status(db, job, "Diffing")

        diff = revision_service.compute_diff(job.catalog_id, chunk_extractions)
        revision = revision_service.create_revision(db, job, job.catalog_id, diff)

        _update_status(db, job, "AwaitingTeacherReview")
        return revision.id
    except Exception as e:
        logger.error("Pipeline stage_diff_and_propose failed for job %d: %s", job_id, str(e))
        _fail_job(job_id, str(e))
        raise
    finally:
        db.close()


def run_pipeline_sync(job_id: int) -> int:
    """
    Runs all three stages back-to-back in-process. Used as the FastAPI
    BackgroundTasks fallback when Airflow isn't configured/reachable, and also
    directly importable by the Airflow DAG (infra/airflow/dags/content_graph_pipeline.py)
    if you'd rather call one task than three.
    """
    text = stage_extract_text(job_id)
    chunk_extractions = stage_clean_and_structure(job_id, text)
    return stage_diff_and_propose(job_id, chunk_extractions)
