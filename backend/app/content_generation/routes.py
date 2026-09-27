import json
from typing import Optional
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import (
    ContentGenerationJob, Course, GeneratedContent, QuizAttempt, User, CLO, Assignment, Rubric, RubricCriterion,
)
from app.content_generation.schemas import (
    GenerateContentRequest, GeneratedContentOut, ReviewContentRequest, EditContentRequest, RefineContentRequest,
    QuizSubmitRequest, QuizResultOut, ContentAttemptSummary, GenerationJobOut, CreatedAssignmentOut,
)
from app.content_generation import service as generation_service
from app.content_generation.jobs import run_generation_job
from app.auth.routes import get_current_user, get_current_teacher, get_current_student
from app.courses.access import assert_course_access
from app.knowledge_graph.services import neo4j_service
from app.rag.retrieval import retrieve_for_concept, format_excerpts
from app.content_processing.pipeline_service import get_course_outline_text
from app.mastery import service as mastery_service
from app.gamification import service as gamification_service
from app.notifications.service import notify_course_students
from app.notifications.types import NotificationType

from app.rag.validation import validate_file_content
from app.upload.services import extract_text_from_file

router = APIRouter(prefix="/courses", tags=["Content Generation"])

# A one-off generation source, not course material - so the limits are tighter than
# the 25MB upload cap. Anything past MAX_SOURCE_CHARS would be truncated by the model
# anyway; truncating here means we can tell the teacher it happened.
SOURCE_EXTENSIONS = {".pdf", ".docx", ".pptx", ".ppt", ".txt"}
MAX_SOURCE_BYTES = 5 * 1024 * 1024
MAX_SOURCE_CHARS = 20000


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _get_owned_content(db: Session, course_id: int, content_id: int, teacher_id: int) -> GeneratedContent:
    item = db.query(GeneratedContent).filter(
        GeneratedContent.id == content_id, GeneratedContent.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
    if item.created_by_teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage content you generated.")
    return item


def _to_out(item: GeneratedContent, db: Session) -> GeneratedContentOut:
    clo_code = None
    if item.clo_id:
        clo = db.query(CLO).filter(CLO.id == item.clo_id).first()
        clo_code = clo.code if clo else None
    return GeneratedContentOut(
        id=item.id, course_id=item.course_id, concept_node_id=item.concept_node_id,
        concept_name=item.concept_name, content_type=item.content_type, title=item.title,
        payload=json.loads(item.payload_json), status=item.status,
        difficulty=item.difficulty or "Medium",
        grounded_excerpts=item.grounded_excerpts or 0,
        language=item.language or "English",
        clo_id=item.clo_id, clo_code=clo_code,
        created_by_teacher_id=item.created_by_teacher_id, reviewed_by_id=item.reviewed_by_id,
        reviewed_at=item.reviewed_at, review_notes=item.review_notes, created_at=item.created_at,
    )


def _lookup_concept_node(catalog_id: int, concept_node_id: str) -> dict:
    """Looks the concept up from the graph rather than trusting client-supplied text -
    the frontend only needs to send the id."""
    graph = neo4j_service.get_catalog_graph(catalog_id)
    node = next((n for n in graph.get("nodes", []) if n.get("id") == concept_node_id), None)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Concept not found in this course's concept graph.")
    return node


def _resolve_target_concept(catalog_id: int, payload: GenerateContentRequest) -> dict:
    """Resolve which concept(s) the material is actually about.

    Returns {node_id, name, description, parent_name, parent_description, combine}.

    The client only ever sends the concept the teacher is looking at; the parent is
    resolved here from Neo4j, so a parent node id never has to exist on the frontend.
    Edge direction is prerequisite -> dependent, so a parent is the SOURCE of an edge
    pointing at this concept.
    """
    node = _lookup_concept_node(catalog_id, payload.concept_node_id)
    parents = neo4j_service.get_concept_parents(catalog_id, payload.concept_node_id)
    parent = parents[0] if parents else None
    concept_name = node.get("name") or payload.concept_name
    concept_desc = node.get("description") or ""

    if payload.target in ("parent", "combined") and not parent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{concept_name}' has no prerequisite concept in this course's concept "
                "graph, so there is nothing to combine it with or generate in its place."
            ),
        )

    if payload.target == "parent":
        # The parent replaces the concept entirely; nothing is passed as orientation.
        return {
            "node_id": parent["id"], "name": parent["name"],
            "description": parent.get("description") or "",
            "parent_name": "", "parent_description": "", "combine": False,
        }

    return {
        # Combined material is still filed against the concept the teacher chose, not
        # the parent: that is where they will look for it, and it is the concept whose
        # mastery the material is meant to move.
        "node_id": payload.concept_node_id,
        "name": concept_name,
        "description": concept_desc,
        "parent_name": parent["name"] if parent else "",
        "parent_description": (parent.get("description") or "") if parent else "",
        "combine": payload.target == "combined",
    }


@router.post("/{course_id}/content/generate", response_model=GeneratedContentOut, status_code=status.HTTP_201_CREATED)
def generate_content(
    course_id: int,
    payload: GenerateContentRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Generates one learning-material item (flashcards/MCQs/quiz/study guide) for
    a single knowledge-graph concept and stores it as PendingReview - nothing is
    visible to students until a teacher approves it (see the /review endpoint)."""
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")
    if not course.catalog_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This course has no catalog entry / concept graph yet.")

    target = _resolve_target_concept(course.catalog_id, payload)
    node_id = target["node_id"]
    concept_name = target["name"]
    description = target["description"]
    parent_name = target["parent_name"]

    # Ground the generation in the course's own uploaded material. Deliberately
    # best-effort: a course with nothing uploaded yet, or an embedding backend that is
    # briefly unavailable, should still be able to generate from the concept
    # description rather than failing the request outright.
    # A document supplied with this request wins outright: the teacher picked it for
    # THIS generation, so retrieving the course's own material as well would only
    # dilute it. Same rule as the async path in jobs.py.
    source_text = (payload.source_text or "").strip()
    excerpts = ""
    excerpt_count = 0
    if not source_text and payload.use_course_material:
        try:
            hits = retrieve_for_concept(db, course_id, concept_name, description)
            # Combined material teaches the prerequisite too, so it needs that
            # concept's excerpts as well - otherwise the foundation half is written
            # from the model's general knowledge while the rest is grounded.
            if target["combine"] and parent_name:
                seen = {h.get("chunk_id") for h in hits}
                for h in retrieve_for_concept(db, course_id, parent_name, target["parent_description"]):
                    if h.get("chunk_id") not in seen:
                        hits.append(h)
                        seen.add(h.get("chunk_id"))
            excerpts = format_excerpts(hits)
            excerpt_count = len(hits)
        except Exception as e:
            print(f"Warning: retrieval failed for concept '{concept_name}', generating ungrounded: {str(e)}")

    # A combined set covers two concepts, so its title has to say so - otherwise a
    # teacher's library shows two identically-named sets that behave differently.
    subject = f"{parent_name} + {concept_name}" if target["combine"] and parent_name else concept_name
    # The course outline is scope, not source material. It never enters RAG (see
    # app/rag/pipeline.py) precisely because its chunks match every query; passed here
    # whole, the same document tells the model which aspects of the concept this course
    # actually reaches. Concept extraction already uses it the same way.
    course_outline = ""
    try:
        course_outline = get_course_outline_text(db, course_id)
    except Exception as e:
        print(f"Warning: could not load the course outline for course {course_id}: {str(e)}")

    # The single CLO the teacher explicitly picked for THIS item (the "Link to CLO"
    # dropdown) - fetched once here so flashcards/MCQ/study-guide generation can
    # actually target it, not just record it on the row after the fact.
    target_clo = None
    if payload.clo_id:
        clo_row = db.query(CLO).filter(CLO.id == payload.clo_id, CLO.catalog_id == course.catalog_id).first()
        if clo_row:
            target_clo = {"code": clo_row.code, "title": clo_row.title, "description": clo_row.description or ""}

    shared = dict(
        difficulty=payload.difficulty,
        rag_context=excerpts,
        parent_concept=parent_name,
        parent_description=target["parent_description"],
        combine_with_parent=target["combine"],
        course_outline=course_outline,
        language=payload.language,
        source_text=source_text,
    )

    try:
        if payload.content_type == "flashcard":
            result = generation_service.generate_flashcards(
                concept_name, description, payload.card_count, clo=target_clo, **shared
            )
            title = f"Flashcards: {subject}"
        elif payload.content_type in ("mcq", "quiz"):
            result = generation_service.generate_mcq(
                concept_name, description, payload.question_count,
                question_styles=payload.question_styles,
                import_existing=payload.import_existing and bool(source_text),
                clo=target_clo, **shared
            )
            title = f"{'Quiz' if payload.content_type == 'quiz' else 'Practice MCQs'}: {subject}"
        elif payload.content_type == "assignment":
            clos = [
                {"code": c.code, "title": c.title}
                for c in db.query(CLO).filter(CLO.catalog_id == course.catalog_id).order_by(CLO.code.asc()).all()
            ]
            result = generation_service.generate_assignment(
                concept_name, description, clos=clos, criteria_count=payload.criteria_count, **shared
            )
            title = f"Assignment: {subject}"
        else:  # study_guide
            result = generation_service.generate_study_guide(
                concept_name, description, clo=target_clo, **shared
            )
            title = f"Study Guide: {subject}"
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    item = GeneratedContent(
        course_id=course_id, catalog_id=course.catalog_id,
        concept_node_id=node_id, concept_name=concept_name,
        content_type=payload.content_type, title=title, payload_json=json.dumps(result),
        difficulty=payload.difficulty,
        # A supplied document counts as one grounding source, otherwise the library
        # would badge a document-grounded set "Ungrounded".
        grounded_excerpts=excerpt_count or (1 if source_text else 0),
        language=payload.language,
        clo_id=payload.clo_id,
        created_by_teacher_id=current_teacher.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(item, db)


@router.post("/{course_id}/content/generate-async", response_model=GenerationJobOut, status_code=status.HTTP_202_ACCEPTED)
def generate_content_async(
    course_id: int,
    payload: GenerateContentRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Queues a generation job and returns immediately with its id.

    This is the path the UI uses. The synchronous /content/generate endpoint is kept
    for scripts and for the in-graph quick action, but a 30-90 second HTTP request is
    the wrong shape for the main flow: it makes the teacher watch a spinner, loses the
    work on a refresh, and can be killed by a gateway timeout AFTER the model has
    already been paid for.

    Validation that can fail fast (course ownership, concept exists, prerequisite
    present) happens HERE rather than in the job, so an impossible request is rejected
    while the teacher is still looking at the form instead of surfacing minutes later
    as a failed job.
    """
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")
    if not course.catalog_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This course has no catalog entry / concept graph yet.")

    # Raises 400/404 on an impossible request before anything is queued.
    target = _resolve_target_concept(course.catalog_id, payload)

    job = ContentGenerationJob(
        course_id=course_id,
        teacher_id=current_teacher.id,
        status="Queued",
        stage="Queued",
        concept_node_id=target["node_id"],
        concept_name=target["name"],
        content_type=payload.content_type,
        difficulty=payload.difficulty,
        request_json=json.dumps(payload.model_dump()),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_generation_job, job.id)
    return GenerationJobOut.model_validate(job)


@router.post("/{course_id}/content/extract-source", status_code=status.HTTP_200_OK)
def extract_source_text(
    course_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Pulls the text out of a document a teacher wants to generate from, without
    adding it to the course.

    Deliberately NOT an upload: this file is a one-off source for a single generation,
    not course material. Storing it would put it in the RAG index, in the files list,
    and in the concept-extraction corpus - none of which the teacher asked for by
    dropping a worksheet into a generate dialog. The extracted text goes back to the
    client, rides along in the generation request, and is never persisted anywhere but
    that job's own record.
    """
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")

    extension = Path(file.filename or "").suffix.lower()
    if extension not in SOURCE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Use one of: {', '.join(sorted(SOURCE_EXTENSIONS))}",
        )

    content = file.file.read()
    if len(content) > MAX_SOURCE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds the {MAX_SOURCE_BYTES // (1024 * 1024)}MB limit for a generation source.",
        )
    try:
        validate_file_content(content, extension)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # extract_text_from_file dispatches on extension and needs a real path (PDFs and
    # images go through PyMuPDF/EasyOCR), so the bytes land in a temp file that is
    # deleted before this returns.
    with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        text, used_ocr = extract_text_from_file(tmp_path, extension.lstrip("."))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not read that file: {e}",
        )
    finally:
        tmp_path.unlink(missing_ok=True)

    text = (text or "").strip()
    if len(text) < 40:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Almost no text could be read from that file. If it's a scanned "
                "document, the OCR pass found nothing usable."
            ),
        )

    truncated = len(text) > MAX_SOURCE_CHARS
    return {
        "filename": file.filename,
        "characters": len(text),
        "truncated": truncated,
        "used_ocr": used_ocr,
        "source_text": text[:MAX_SOURCE_CHARS],
    }


@router.get("/{course_id}/content/jobs", response_model=list[GenerationJobOut])
def list_generation_jobs(
    course_id: int,
    active_only: bool = False,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """This teacher's recent generation jobs for the course.

    Scoped to the caller, not the course: a job is a personal piece of work in
    progress, and one teacher does not need to watch another's queue.
    """
    _get_course_or_404(db, course_id)
    q = db.query(ContentGenerationJob).filter(
        ContentGenerationJob.course_id == course_id,
        ContentGenerationJob.teacher_id == current_teacher.id,
    )
    if active_only:
        q = q.filter(ContentGenerationJob.status.in_(("Queued", "Running")))
    rows = q.order_by(ContentGenerationJob.created_at.desc()).limit(max(1, min(limit, 100))).all()
    return [GenerationJobOut.model_validate(r) for r in rows]


@router.get("/{course_id}/content/jobs/{job_id}", response_model=GenerationJobOut)
def get_generation_job(
    course_id: int,
    job_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Polled by the progress modal until the job leaves Queued/Running."""
    job = db.query(ContentGenerationJob).filter(
        ContentGenerationJob.id == job_id,
        ContentGenerationJob.course_id == course_id,
        ContentGenerationJob.teacher_id == current_teacher.id,
    ).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation job not found")
    return GenerationJobOut.model_validate(job)


@router.get("/{course_id}/content-concepts")
def list_generatable_concepts(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Concepts available to generate content for, shaped for a picker.

    Returns each concept with its direct prerequisites already resolved, so the UI can
    offer "generate for the parent concept instead" without a second round-trip per
    concept, and can disable that option for concepts that have no parent.

    Sorted by importance so the most foundational concepts head the list, which is
    almost always what a teacher wants to build material for first.
    """
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    if not course.catalog_id:
        return []

    graph = neo4j_service.get_catalog_graph(course.catalog_id)
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    # prerequisite -> dependent, so the parents of X are the sources of edges into X.
    parents_by_child: dict[str, list[str]] = {}
    for e in edges:
        parents_by_child.setdefault(e["target"], []).append(e["source"])

    by_id = {n.get("id"): n for n in nodes}
    out = []
    for n in nodes:
        parent_ids = parents_by_child.get(n.get("id"), [])
        parents = [
            {"id": pid, "name": by_id[pid].get("name")}
            for pid in parent_ids if pid in by_id
        ]
        out.append({
            "id": n.get("id"),
            "name": n.get("name"),
            "description": n.get("description") or "",
            "difficulty": n.get("difficulty") or "Medium",
            "importance_score": n.get("importance_score") or 5,
            "parents": parents,
            "has_parent": bool(parents),
        })
    out.sort(key=lambda c: (-(c["importance_score"] or 0), (c["name"] or "").lower()))
    return out


@router.get("/{course_id}/content", response_model=list[GeneratedContentOut])
def list_content(
    course_id: int,
    content_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Teachers/oversight roles see every item regardless of status; students only
    ever see Approved items - the review gate is enforced here, not just in the UI."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    query = db.query(GeneratedContent).filter(GeneratedContent.course_id == course_id)
    if content_type:
        query = query.filter(GeneratedContent.content_type == content_type)
    if current_user.role.lower() == "student":
        query = query.filter(GeneratedContent.status == "Approved")
    items = query.order_by(GeneratedContent.created_at.desc()).all()
    return [_to_out(i, db) for i in items]


@router.get("/{course_id}/content/{content_id}", response_model=GeneratedContentOut)
def get_content(
    course_id: int,
    content_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    item = db.query(GeneratedContent).filter(
        GeneratedContent.id == content_id, GeneratedContent.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
    if current_user.role.lower() == "student" and item.status != "Approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This content hasn't been approved yet.")
    return _to_out(item, db)


@router.get("/{course_id}/content/{content_id}/attempts", response_model=list[ContentAttemptSummary])
def list_content_attempts(
    course_id: int,
    content_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Every student attempt at one generated quiz/MCQ set.

    Teacher-only: it names students and exposes their scores. correct_count is
    recomputed from the stored answers against the live answer key rather than being
    read from a stored counter, so an item edited after students sat it reports what
    those answers are worth NOW - which is the number a teacher is actually asking
    about when they open this.
    """
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course."
        )

    item = db.query(GeneratedContent).filter(
        GeneratedContent.id == content_id, GeneratedContent.course_id == course_id
    ).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")

    try:
        questions = json.loads(item.payload_json).get("questions") or []
    except (json.JSONDecodeError, TypeError):
        questions = []

    rows = (
        db.query(QuizAttempt, User.full_name)
        .join(User, QuizAttempt.student_id == User.id)
        .filter(QuizAttempt.content_id == content_id)
        .order_by(QuizAttempt.completed_at.desc())
        .all()
    )

    out = []
    for attempt, name in rows:
        try:
            answers = json.loads(attempt.answers_json) or []
        except (json.JSONDecodeError, TypeError):
            answers = []
        correct = sum(
            1 for q, a in zip(questions, answers) if a == q.get("correct_index")
        )
        out.append(ContentAttemptSummary(
            id=attempt.id, student_id=attempt.student_id, student_name=name,
            score=attempt.score, correct_count=correct,
            total_count=len(questions) or len(answers),
            completed_at=attempt.completed_at,
        ))
    return out


@router.patch("/{course_id}/content/{content_id}", response_model=GeneratedContentOut)
def edit_content(
    course_id: int,
    content_id: int,
    payload: EditContentRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Teacher correction pass before approving - e.g. fixing a wrong MCQ answer
    or rewording a flashcard, without a full AI regeneration."""
    item = _get_owned_content(db, course_id, content_id, current_teacher.id)
    if payload.title is not None:
        item.title = payload.title
    if payload.payload is not None:
        item.payload_json = json.dumps(payload.payload)
    db.commit()
    db.refresh(item)
    return _to_out(item, db)


@router.post("/{course_id}/content/{content_id}/refine", response_model=GeneratedContentOut)
def refine_content(
    course_id: int,
    content_id: int,
    payload: RefineContentRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """AI-refine a still-pending draft with a targeted instruction (e.g. "add a
    citations criterion") - as opposed to PATCH's direct manual field edit, or
    re-running /generate from scratch. Currently only implemented for
    content_type="assignment"; other types can be added the same way once there's
    a matching refine_* service function for them."""
    item = _get_owned_content(db, course_id, content_id, current_teacher.id)
    if item.content_type != "assignment":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI refinement is currently only available for assignment drafts.",
        )

    current_draft = json.loads(item.payload_json)
    try:
        refined = generation_service.refine_assignment_draft(current_draft, payload.instruction)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    item.title = refined.get("title") or item.title
    item.payload_json = json.dumps(refined)
    db.commit()
    db.refresh(item)
    return _to_out(item, db)


@router.post("/{course_id}/content/{content_id}/review", response_model=GeneratedContentOut)
def review_content(
    course_id: int,
    content_id: int,
    decision: ReviewContentRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Teacher approves or rejects a generated item - approval is what makes it
    visible to students (see list_content's student-side status filter)."""
    course = _get_course_or_404(db, course_id)
    item = _get_owned_content(db, course_id, content_id, current_teacher.id)
    if item.content_type == "assignment" and decision.approve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST .../content/{content_id}/create-assignment to approve an assignment draft - "
                   "approving it here would mark it Approved without ever creating the real Assignment/Rubric.",
        )
    item.status = "Approved" if decision.approve else "Rejected"
    item.reviewed_by_id = current_teacher.id
    item.review_notes = decision.notes
    from datetime import datetime
    item.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(item)

    if decision.approve:
        try:
            notify_course_students(
                db, course_id, NotificationType.NEW_COURSE_CONTENT,
                title=f"New {item.content_type.replace('_', ' ')}: {item.concept_name}",
                message=f"'{item.title}' is now available in {course.name}.",
                link=f"/course/{course_id}",
            )
        except Exception as e:
            print(f"Warning: failed to notify students of new content: {str(e)}")

    return _to_out(item, db)


@router.post("/{course_id}/content/{content_id}/create-assignment", response_model=CreatedAssignmentOut, status_code=status.HTTP_201_CREATED)
def create_assignment_from_content(
    course_id: int,
    content_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Turns an "assignment"-type generated draft into a real Assignment + a
    Published Rubric, the same one-rubric-per-assignment shared across every
    student's submission that app/assignments/routes.py grades against. The
    draft itself (title/instructions/points/criteria) was AI-written and is
    already sitting in front of the teacher in the content library for review
    before this is clicked - this action is the "approve" step, same as
    /review is for every other content type, just producing a different kind
    of row."""
    from datetime import datetime

    course = _get_course_or_404(db, course_id)
    item = _get_owned_content(db, course_id, content_id, current_teacher.id)
    if item.content_type != "assignment":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This content item is not an assignment draft.")

    draft = json.loads(item.payload_json)
    assignment = Assignment(
        course_id=course_id, teacher_id=current_teacher.id,
        title=draft["title"], description=draft["instructions"],
        points=round(draft.get("points") or 0) or None,
        concept_node_id=item.concept_node_id, concept_name=item.concept_name,
    )
    db.add(assignment)
    db.flush()

    clo_by_code = {c.code: c.id for c in db.query(CLO).filter(CLO.catalog_id == item.catalog_id).all()}
    rubric = Rubric(assignment_id=assignment.id, created_by_id=current_teacher.id, status="Published")
    db.add(rubric)
    db.flush()
    for i, c in enumerate(draft.get("criteria") or []):
        db.add(RubricCriterion(
            rubric_id=rubric.id, title=c["title"], description=c.get("description"),
            max_points=max(0.0, float(c.get("max_points") or 0)),
            clo_id=clo_by_code.get(c.get("clo_code")), order_index=i,
        ))

    # Approving the draft this way is equivalent to /review's approve=True for
    # every other content type - the item is no longer just a pending draft,
    # it has become a real assignment.
    item.status = "Approved"
    item.reviewed_by_id = current_teacher.id
    item.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    db.refresh(rubric)

    # Unlike every other content type's /review approve=True path, this endpoint
    # never notified students at all - an AI-drafted assignment went live silently
    # while a manually-created one (assignments/routes.py create_assignment)
    # always notifies. Match that behavior.
    try:
        notify_course_students(
            db, course_id, NotificationType.ASSIGNMENT_POSTED,
            title=f"New assignment: {assignment.title}",
            message=f"'{assignment.title}' has been posted in {course.name}.",
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to notify students of new assignment {assignment.id}: {str(e)}")

    return CreatedAssignmentOut(assignment_id=assignment.id, course_id=course_id, rubric_id=rubric.id)


@router.delete("/{course_id}/content/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_content(
    course_id: int,
    content_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    item = _get_owned_content(db, course_id, content_id, current_teacher.id)
    db.delete(item)
    db.commit()
    return None


@router.post("/{course_id}/content/{content_id}/attempt", response_model=QuizResultOut)
def submit_quiz_attempt(
    course_id: int,
    content_id: int,
    payload: QuizSubmitRequest,
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """Mechanical (no AI call) grading of an MCQ/quiz attempt - the answer key is
    already stored in the item's payload. Score feeds ConceptMastery exactly like
    Assignment Evaluation does, so quiz completion also counts as observation
    evidence for the Adaptive Engine and Gamification."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_student)

    item = db.query(GeneratedContent).filter(
        GeneratedContent.id == content_id, GeneratedContent.course_id == course_id
    ).first()
    if not item or item.status != "Approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found or not yet approved.")
    if item.content_type not in ("mcq", "quiz"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This content item isn't a quiz.")

    questions = json.loads(item.payload_json)["questions"]
    if len(payload.answers) != len(questions):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Expected {len(questions)} answers, got {len(payload.answers)}.")

    per_question = []
    correct_count = 0
    for q, selected in zip(questions, payload.answers):
        is_correct = selected == q["correct_index"]
        if is_correct:
            correct_count += 1
        per_question.append({
            "question": q["question"], "your_answer": selected,
            "correct_index": q["correct_index"], "correct": is_correct, "explanation": q["explanation"],
        })

    score = round((correct_count / len(questions)) * 100, 1) if questions else 0.0

    db.add(QuizAttempt(
        content_id=content_id, student_id=current_student.id, course_id=course_id,
        answers_json=json.dumps(payload.answers), score=score,
    ))

    mastery_service.record_evidence(
        db, current_student.id, course_id, item.catalog_id,
        item.concept_node_id, item.concept_name, score,
        source_type="quiz", source_id=item.id,
    )
    gamification_service.award_points(
        db, current_student.id, course_id, round(score / 10),
        reason=f"Completed quiz: {item.title}", source_type="quiz", source_id=item.id,
    )

    db.commit()

    return QuizResultOut(score=score, correct_count=correct_count, total_count=len(questions), per_question=per_question)
