"""Background execution of a content-generation request.

Runs inside FastAPI's BackgroundTasks, the same mechanism the upload pipeline uses,
so no extra infrastructure is required to make generation asynchronous.

WHY THE STAGE STRING MATTERS
----------------------------
The job writes a human-readable `stage` before each slow step. A modal that says
"Finding relevant course material" and then "Writing 8 flashcards" tells a teacher
that something is happening and roughly how far along it is; a spinner tells them
nothing, and after 60 seconds of nothing people reload and lose the work. Each stage
is committed immediately so the polling endpoint can actually see it.

FAILURE IS A RESULT, NOT AN EXCEPTION
-------------------------------------
Nothing here is allowed to raise into the background-task runner, because a task that
dies leaves the job stuck on "Running" forever with no way for the teacher to find
out. Every failure path ends with the job marked Failed, the reason stored, and a
notification sent.
"""
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from app.content_generation import service as generation_service
from app.content_processing.pipeline_service import get_course_outline_text
from app.database.connection import SessionLocal
from app.database.models import ContentGenerationJob, Course, GeneratedContent, CLO
from app.knowledge_graph.services import neo4j_service
from app.notifications.service import create_notification
from app.notifications.types import NotificationType
from app.rag.retrieval import format_excerpts, retrieve_for_concept

logger = logging.getLogger("conceptintel.content_generation.jobs")


def _set_stage(db, job: ContentGenerationJob, stage: str, status: Optional[str] = None) -> None:
    """Writes the human-readable progress stage (and optionally status) and commits so pollers see it."""
    job.stage = stage
    if status:
        job.status = status
    db.commit()


def _fail(db, job: ContentGenerationJob, message: str) -> None:
    """Marks the job Failed with a truncated reason and notifies the teacher (notification errors are swallowed)."""
    job.status = "Failed"
    job.stage = None
    job.error_message = message[:2000]
    job.completed_at = datetime.utcnow()
    db.commit()
    try:
        create_notification(
            db, job.teacher_id, NotificationType.CONTENT_GENERATION_FAILED,
            title="Content generation failed",
            message=f"{job.concept_name or 'Your content'} could not be generated: {message[:160]}",
            link=f"/content-studio?course={job.course_id}",
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not notify teacher %s of generation failure: %s", job.teacher_id, e)


def run_generation_job(job_id: int) -> None:
    """Entry point handed to BackgroundTasks. Never raises."""
    db = SessionLocal()
    try:
        job = db.query(ContentGenerationJob).filter(ContentGenerationJob.id == job_id).first()
        if not job:
            logger.warning("Generation job %s vanished before it ran", job_id)
            return

        try:
            req: Dict[str, Any] = json.loads(job.request_json or "{}")
        except (json.JSONDecodeError, TypeError):
            _fail(db, job, "The saved request for this job is unreadable.")
            return

        course = db.query(Course).filter(Course.id == job.course_id).first()
        if not course or not course.catalog_id:
            _fail(db, job, "This course no longer has a catalog entry / concept graph.")
            return

        _set_stage(db, job, "Looking up the concept", status="Running")

        # Resolved here rather than trusting what the client sent, and re-resolved at
        # run time rather than at enqueue time - the graph can change while a job sits
        # in the queue.
        graph = neo4j_service.get_catalog_graph(course.catalog_id)
        node = next((n for n in graph.get("nodes", []) if n.get("id") == req.get("concept_node_id")), None)
        if not node:
            _fail(db, job, "That concept is no longer in this course's concept graph.")
            return

        parents = neo4j_service.get_concept_parents(course.catalog_id, req["concept_node_id"])
        parent = parents[0] if parents else None
        target = (req.get("target") or "concept").lower()

        if target in ("parent", "combined") and not parent:
            _fail(db, job, f"'{node.get('name')}' has no prerequisite concept to use.")
            return

        if target == "parent":
            node_id = parent["id"]
            concept_name = parent["name"]
            description = parent.get("description") or ""
            parent_name = parent_description = ""
            combine = False
        else:
            node_id = req["concept_node_id"]
            concept_name = node.get("name") or job.concept_name or "this concept"
            description = node.get("description") or ""
            parent_name = parent["name"] if parent else ""
            parent_description = (parent.get("description") or "") if parent else ""
            combine = target == "combined"

        # ── grounding ──
        # A teacher-supplied document wins outright: they picked it for THIS request,
        # so retrieving the course's own material as well would only dilute it.
        source_text = (req.get("source_text") or "").strip()
        excerpts = ""
        excerpt_count = 0
        if source_text:
            _set_stage(db, job, "Reading the document you supplied")
        elif req.get("use_course_material", True):
            _set_stage(db, job, "Finding relevant course material")
            try:
                hits = retrieve_for_concept(db, job.course_id, concept_name, description)
                if combine and parent_name:
                    seen = {h.get("chunk_id") for h in hits}
                    for h in retrieve_for_concept(db, job.course_id, parent_name, parent_description):
                        if h.get("chunk_id") not in seen:
                            hits.append(h)
                            seen.add(h.get("chunk_id"))
                excerpts = format_excerpts(hits)
                excerpt_count = len(hits)
            except Exception as e:  # noqa: BLE001
                logger.warning("Retrieval failed for '%s'; generating ungrounded: %s", concept_name, e)

        course_outline = ""
        try:
            course_outline = get_course_outline_text(db, job.course_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not load the course outline for course %s: %s", job.course_id, e)

        # ── generation ──
        content_type = job.content_type
        count = int(req.get("card_count") or req.get("question_count") or 5)
        subject = f"{parent_name} + {concept_name}" if combine and parent_name else concept_name

        # The single CLO the teacher explicitly picked for THIS item (see routes.py's
        # sync path) - fetched once here so flashcards/MCQ/study-guide generation can
        # actually target it, not just record it on the row after the fact.
        target_clo = None
        clo_id = req.get("clo_id")
        if clo_id:
            clo_row = db.query(CLO).filter(CLO.id == clo_id, CLO.catalog_id == course.catalog_id).first()
            if clo_row:
                target_clo = {"code": clo_row.code, "title": clo_row.title, "description": clo_row.description or ""}

        shared = dict(
            difficulty=job.difficulty,
            rag_context=excerpts,
            parent_concept=parent_name,
            parent_description=parent_description,
            combine_with_parent=combine,
            course_outline=course_outline,
            language=req.get("language") or "English",
            source_text=source_text,
        )

        try:
            if content_type == "flashcard":
                _set_stage(db, job, f"Writing {count} flashcards")
                result = generation_service.generate_flashcards(concept_name, description, count, clo=target_clo, **shared)
                title = f"Flashcards: {subject}"
            elif content_type in ("mcq", "quiz"):
                import_existing = bool(req.get("import_existing")) and bool(source_text)
                _set_stage(
                    db, job,
                    "Reading the questions in your document" if import_existing
                    else f"Writing {count} questions",
                )
                # Style and import are question-only, so they go here rather than into
                # `shared` - the flashcard and study-guide generators take neither.
                result = generation_service.generate_mcq(
                    concept_name, description, count,
                    question_styles=req.get("question_styles") or [],
                    import_existing=import_existing,
                    clo=target_clo,
                    **shared,
                )
                title = f"{'Quiz' if content_type == 'quiz' else 'Practice MCQs'}: {subject}"
            elif content_type == "assignment":
                _set_stage(db, job, "Drafting the assignment brief and rubric")
                clos = [
                    {"code": c.code, "title": c.title}
                    for c in db.query(CLO).filter(CLO.catalog_id == course.catalog_id).order_by(CLO.code.asc()).all()
                ]
                result = generation_service.generate_assignment(
                    concept_name, description, clos=clos, criteria_count=req.get("criteria_count"), **shared
                )
                title = f"Assignment: {subject}"
            else:
                _set_stage(db, job, "Writing the study guide")
                result = generation_service.generate_study_guide(concept_name, description, clo=target_clo, **shared)
                title = f"Study Guide: {subject}"
        except RuntimeError as e:
            _fail(db, job, str(e))
            return

        _set_stage(db, job, "Saving")
        item = GeneratedContent(
            course_id=job.course_id, catalog_id=course.catalog_id,
            concept_node_id=node_id, concept_name=concept_name,
            content_type=content_type, title=title,
            payload_json=json.dumps(result),
            difficulty=job.difficulty,
            # A supplied document counts as one grounding source; without this the
            # library would badge a document-grounded set as "Ungrounded".
            grounded_excerpts=excerpt_count or (1 if source_text else 0),
            language=shared["language"],
            clo_id=req.get("clo_id"),
            created_by_teacher_id=job.teacher_id,
        )
        db.add(item)
        db.flush()

        job.status = "Completed"
        job.stage = None
        job.result_content_id = item.id
        job.completed_at = datetime.utcnow()
        db.commit()

        try:
            create_notification(
                db, job.teacher_id, NotificationType.CONTENT_GENERATION_READY,
                title="Your content is ready",
                message=f'"{title}" has been generated and is waiting for your review.',
                link=f"/content/{job.course_id}/{item.id}",
            )
            db.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("Generated content %s but could not notify: %s", item.id, e)

    except Exception as e:  # noqa: BLE001 - a background task must never die silently
        logger.exception("Generation job %s crashed", job_id)
        try:
            db.rollback()
            job = db.query(ContentGenerationJob).filter(ContentGenerationJob.id == job_id).first()
            if job and job.status not in ("Completed", "Failed"):
                _fail(db, job, f"{type(e).__name__}: {e}")
        except Exception:  # noqa: BLE001
            logger.exception("Could not even mark job %s as failed", job_id)
    finally:
        db.close()
