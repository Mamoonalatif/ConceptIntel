# Graph-build pipeline: three stages (extract text -> AI structuring -> diff and propose).
# Each stage opens its own DB session, updates GraphBuildJob.status, and marks the job Failed on error.
# Run by the Airflow DAG task-by-task, or all at once via run_pipeline_sync.
import logging
from typing import Any, Dict, List

from app.database.connection import SessionLocal
from app.database.models import GraphBuildJob, UploadedFile, CourseCatalog
from app.content_processing import generation_service
from app.knowledge_graph import revision_service
from app.knowledge_graph.services import neo4j_service

logger = logging.getLogger("conceptintel.pipeline")


def _get_job_or_raise(db, job_id: int) -> GraphBuildJob:
    """Loads a GraphBuildJob by id or raises ValueError if it does not exist."""
    job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
    if not job:
        raise ValueError(f"GraphBuildJob {job_id} not found")
    return job


def _update_status(db, job: GraphBuildJob, new_status: str) -> None:
    """Sets the job status and commits so pollers see the new stage."""
    job.status = new_status
    db.commit()


def _fail_job(job_id: int, error_message: str) -> None:
    """Marks a job Failed (with a truncated error message) using a fresh session, since the stage session may be broken."""
    db = SessionLocal()
    try:
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == job_id).first()
        if job:
            job.status = "Failed"
            job.error_message = error_message[:2000]
            db.commit()
    finally:
        db.close()


def get_course_outline_text(db, course_id: int, max_chars: int = 8000) -> str:
    """The course outline(s) for a course, concatenated.

    Returned separately from the teaching material and never mixed into it. An
    outline is a scope document: it says which topics the course covers and in what
    order. Fed to extraction as *material*, it produced concepts like "Credit Hours",
    "Code PHY", "TEXT AND MATERIAL" and "Halliday" (a textbook author) - it names
    administrative fields and bibliography entries with exactly the same syntax it
    names real topics, and the extractor cannot tell them apart. Fed as scope
    context instead, the same document becomes the single most useful signal for
    deciding which concepts belong in the graph at all.
    """
    outlines = db.query(UploadedFile).filter(
        UploadedFile.course_id == course_id,
        UploadedFile.status == "Completed",
        UploadedFile.material_kind == "outline",
    ).all()
    text = "\n\n".join(f.extracted_text for f in outlines if f.extracted_text)
    return text[:max_chars]


def stage_extract_text(job_id: int) -> str:
    """Stage 1: gather already-extracted text (OCR'd at upload time if needed) from
    every successfully processed file uploaded for this course.

    Only material_kind='material' files are returned. Course outlines are excluded
    here and re-introduced in stage 2 as scope context - see get_course_outline_text().
    """
    db = SessionLocal()
    try:
        job = _get_job_or_raise(db, job_id)
        _update_status(db, job, "ExtractingText")

        files = db.query(UploadedFile).filter(
            UploadedFile.course_id == job.course_id,
            UploadedFile.status == "Completed",
            UploadedFile.material_kind == "material",
        ).all()
        combined = "\n\n".join(f.extracted_text for f in files if f.extracted_text)

        if not combined.strip():
            outline_only = db.query(UploadedFile).filter(
                UploadedFile.course_id == job.course_id,
                UploadedFile.status == "Completed",
                UploadedFile.material_kind == "outline",
            ).count()
            if outline_only:
                raise ValueError(
                    f"This course has {outline_only} course outline file(s) but no teaching "
                    "material. A concept graph is built from lecture content, not from the "
                    "outline - the outline only defines the scope. Upload slides, notes or "
                    "textbook chapters as 'Course material' and try again."
                )
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
    """Stage 2: the generation model cleans OCR/typo noise and extracts structured concepts, one
    result per text chunk - scoped to this job's course name/code, and grounded
    against concepts that already exist in the catalog's shared graph so it can
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
        course_outline = get_course_outline_text(db, job.course_id)

        return generation_service.structure_full_text(
            combined_text,
            course_name=course_name,
            course_code=course_code,
            teacher_notes=job.teacher_notes,
            existing_concept_names=existing_concept_names,
            course_outline=course_outline,
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
