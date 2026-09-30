# Concept-graph API routes (mounted at /graph): view the graph, approve/reject it, and propose edits.
# Every change is only a *proposal* stored in the DB; a course coordinator must approve it before it is
# written to Neo4j (see revision_service.py).
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Course, CourseCatalog, User, GraphRevision, GraphBuildJob, GraphEditProposal, CLO, ConceptCLOMap
from app.knowledge_graph.schemas import (
    ConceptNodeCreate, ConceptNodeUpdate, RelationshipCreate, GraphResponse,
    CourseGraphStatusResponse, EditProposalResponse, MaterialGenerateRequest, MaterialEditRequest,
)
from app.knowledge_graph.services import neo4j_service
from app.auth.routes import get_current_teacher, get_current_user, get_current_course_coordinator, CourseScope
from app.courses.access import assert_course_access
from app.notifications.service import create_notification
from app.notifications.types import NotificationType
from app.knowledge_graph import revision_service
from app.content_processing.schemas import GraphRevisionResponse, CoordinatorDecisionRequest
from app.content_processing.pipeline_service import get_course_outline_text
from app.content_generation.service import generate_concept_material, edit_concept_material
from app.rag.retrieval import retrieve_for_concept, format_excerpts

router = APIRouter(prefix="/graph", tags=["Concept Graph"])


def _resolve_catalog_id(course: Course) -> int:
    """
    Concept nodes are keyed by catalog_id so the graph is shared across every
    section/teacher of the same catalog course. Courses created before catalog
    linkage existed (or created without picking a catalog entry) fall back to
    using their own Course.id as a standalone "catalog" - they just don't share
    a graph with anyone else, which matches their previous (pre-sharing) behavior.
    """
    return course.catalog_id if course.catalog_id is not None else course.id


@router.get("/course/{course_id}", response_model=GraphResponse)
def get_graph_by_course(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve the shared concept graph for the catalog course behind this section.
    Students don't view/interact with the raw graph directly (they work with it
    indirectly, via generated study materials, mastery tracking, and the Adaptive
    Engine's revision plan) - teachers/admin/coordinators can always see it, since
    they need to review/build it before approval."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    assert_course_access(db, course, current_user)

    if current_user.role.lower() == "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Students don't have direct access to the concept graph.",
        )

    # Return graph representation from Neo4j, keyed by the shared catalog_id
    try:
        return neo4j_service.get_catalog_graph(_resolve_catalog_id(course), strict=True)
    except ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The knowledge graph database (Neo4j) is unreachable right now. Please retry in a moment.",
        )


@router.post("/course/{course_id}/approve", response_model=CourseGraphStatusResponse)
def approve_course_graph(
    course_id: int,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator (or admin) approves a course's concept graph, making it
    visible to enrolled students. This is the legacy/manual approval switch, kept
    for the direct-build path - the reviewed pipeline instead uses the per-revision
    approve/reject endpoints below, which also flip this same flag once merged."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if scope.catalog_ids is not None and course.catalog_id not in scope.catalog_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned as this course's Course Coordinator."
        )
    course.graph_status = "Approved"
    db.commit()
    db.refresh(course)
    try:
        create_notification(
            db, course.teacher_id, NotificationType.GRAPH_APPROVED,
            title="Concept graph approved",
            message=f"The concept graph for {course.name} was approved and is now visible to students.",
            link=f"/course/{course.id}/graph",
        )
    except Exception as e:
        print(f"Warning: failed to create graph-approved notification: {str(e)}")
    return course


@router.post("/course/{course_id}/reject", response_model=CourseGraphStatusResponse)
def reject_course_graph(
    course_id: int,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator (or admin) rejects a course's concept graph - it remains
    hidden from students until re-approved."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if scope.catalog_ids is not None and course.catalog_id not in scope.catalog_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned as this course's Course Coordinator."
        )
    course.graph_status = "Rejected"
    db.commit()
    db.refresh(course)
    try:
        # create_notification already emails the teacher in a background thread -
        # a second, synchronous send_notification_email call used to run here too,
        # blocking this request on Gmail SMTP for an email already being sent.
        create_notification(
            db, course.teacher_id, NotificationType.GRAPH_REJECTED,
            title="Concept graph rejected",
            message=f"The concept graph for {course.name} was rejected. Please review and rebuild it.",
            link=f"/course/{course.id}/graph",
        )
    except Exception as e:
        print(f"Warning: failed to create graph-rejected notification: {str(e)}")
    return course


# POST /build/{course_id} used to live here: a legacy path that extracted concepts
# and wrote them STRAIGHT into the shared catalog graph with no review, bypassing
# coordinator approval entirely. Removed deliberately - the shared graph is shared
# across every teacher of a subject, so an unreviewed direct write let one teacher
# change what every other teacher (and AI content generation) sees. All graph
# changes now go through POST /api/content-processing/trigger/{course_id}
# (pipeline -> teacher review -> coordinator approval -> merge) or, for single
# edits, the graph edit-proposal flow below.


def _get_owned_course(db: Session, course_id: int, current_teacher: User) -> Course:
    """Loads the course only if the current teacher owns it, else 404."""
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )
    return course


@router.post("/node/{course_id}", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def create_node(
    course_id: int,
    node_in: ConceptNodeCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Propose a new standalone Concept node. Nothing is written to Neo4j until a
    course coordinator approves this proposal (see /edit-proposals/{id}/approve)."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "create_node",
        {
            "name": node_in.name.strip(),
            "description": node_in.description.strip(),
            "difficulty": node_in.difficulty,
            "importance_score": node_in.importance_score or 5,
            "learning_outcomes": node_in.learning_outcomes or "",
        },
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.put("/node/{course_id}/{node_id}", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def update_node_properties(
    course_id: int,
    node_id: str,
    node_in: ConceptNodeUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Propose an update to an existing Concept node's fields. Nothing is written to
    Neo4j until a course coordinator approves this proposal."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    graph = neo4j_service.get_catalog_graph(catalog_id)
    target_node = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if not target_node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept node '{node_id}' not found in course graph."
        )

    name = node_in.name if node_in.name is not None else target_node.get("name")
    description = node_in.description if node_in.description is not None else target_node.get("description")
    difficulty = node_in.difficulty if node_in.difficulty is not None else target_node.get("difficulty")

    payload = {
        "node_id": node_id,
        "name": name, "description": description, "difficulty": difficulty,
        # Current (pre-edit) values, captured here purely so the coordinator's
        # review queue can show a real before/after diff - not read by
        # _apply_edit_operation, which only needs the new values above.
        "old_name": target_node.get("name"),
        "old_description": target_node.get("description"),
        "old_difficulty": target_node.get("difficulty"),
    }
    if node_in.material is not None:
        payload["material"] = node_in.material

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "update_node", payload,
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.delete("/node/{course_id}/{node_id}", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def delete_node(
    course_id: int,
    node_id: str,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Propose deleting a Concept node and its relationships. Nothing is removed from
    Neo4j until a course coordinator approves this proposal."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    graph = neo4j_service.get_catalog_graph(catalog_id)
    target_node = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if not target_node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept node '{node_id}' not found in course graph."
        )

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "delete_node",
        {
            "node_id": node_id,
            # Captured purely for display in the coordinator's review queue -
            # _apply_edit_operation only needs node_id to run the deletion.
            "name": target_node.get("name"),
            "description": target_node.get("description"),
            "difficulty": target_node.get("difficulty"),
        },
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.post("/node/{course_id}/{node_id}/material/generate", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def generate_node_material(
    course_id: int,
    node_id: str,
    request: MaterialGenerateRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """AI-generate the full, detailed teaching material for a concept node from the
    course's own uploaded content (via RAG retrieval). Nothing is written to Neo4j
    until a course coordinator approves this proposal - same flow as any other node
    edit (see /edit-proposals/{id}/approve)."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    graph = neo4j_service.get_catalog_graph(catalog_id)
    target_node = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if not target_node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept node '{node_id}' not found in course graph."
        )

    rag_context = ""
    try:
        hits = retrieve_for_concept(
            db, course_id, target_node.get("name", ""), target_node.get("description", ""), top_k=14,
        )
        rag_context = format_excerpts(hits, max_chars=10000)
    except Exception as e:
        print(f"Warning: material retrieval failed for node {node_id}: {str(e)}")

    course_outline = ""
    try:
        course_outline = get_course_outline_text(db, course_id)
    except Exception as e:
        print(f"Warning: could not load course outline for course {course_id}: {str(e)}")

    # CLOs already linked to this concept (via the outcomes module's AI-suggested or
    # teacher-confirmed ConceptCLOMap rows) - so the material actually gets written
    # to address them, not just sit next to them in an unrelated table.
    clos = [
        {"code": c.code, "title": c.title, "description": c.description or ""}
        for c in (
            db.query(CLO)
            .join(ConceptCLOMap, ConceptCLOMap.clo_id == CLO.id)
            .filter(ConceptCLOMap.catalog_id == catalog_id, ConceptCLOMap.concept_node_id == node_id)
            .order_by(CLO.code.asc())
            .all()
        )
    ]

    material = generate_concept_material(
        concept_name=target_node.get("name", ""),
        concept_description=target_node.get("description", ""),
        rag_context=rag_context,
        course_outline=course_outline,
        instruction=request.instruction,
        clos=clos,
    )

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "update_material",
        {
            "node_id": node_id,
            "material": material,
            "old_material": target_node.get("material") or "",
        },
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.post("/node/{course_id}/{node_id}/material/edit", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def edit_node_material(
    course_id: int,
    node_id: str,
    request: MaterialEditRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """AI-refine the existing detailed material for a concept node based on a
    targeted teacher instruction (not a full regeneration). Same coordinator-approval
    flow as generate_node_material above."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    graph = neo4j_service.get_catalog_graph(catalog_id)
    target_node = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if not target_node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept node '{node_id}' not found in course graph."
        )

    current_material = target_node.get("material") or ""
    if not current_material.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This node has no material yet - generate it first before refining it.",
        )

    material = edit_concept_material(current_material, request.instruction)

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "update_material",
        {
            "node_id": node_id,
            "material": material,
            "old_material": current_material,
        },
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.post("/relationship", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def create_prerequisite(
    rel: RelationshipCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Propose a new prerequisite relationship. `rel.course_id` identifies the section
    the teacher is working from; nothing is written to Neo4j until a course
    coordinator approves this proposal."""
    course = _get_owned_course(db, rel.course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    proposal = revision_service.propose_edit(
        db, catalog_id, rel.course_id, current_teacher.id, "create_relationship",
        {"source_name": rel.source_name.strip(), "target_name": rel.target_name.strip()},
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.delete("/relationship/{course_id}/{source_id}/{target_id}", status_code=status.HTTP_202_ACCEPTED, response_model=EditProposalResponse)
def delete_prerequisite(
    course_id: int,
    source_id: str,
    target_id: str,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Propose deleting an existing prerequisite relationship. Nothing is removed from
    Neo4j until a course coordinator approves this proposal."""
    course = _get_owned_course(db, course_id, current_teacher)
    catalog_id = _resolve_catalog_id(course)

    graph = neo4j_service.get_catalog_graph(catalog_id)
    source_node = next((n for n in graph["nodes"] if n["id"] == source_id), None)
    target_node = next((n for n in graph["nodes"] if n["id"] == target_id), None)

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "delete_relationship",
        {
            "source_id": source_id, "target_id": target_id,
            # Captured purely for display in the coordinator's review queue -
            # _apply_edit_operation only needs the ids above to run the deletion.
            "source_name": source_node.get("name") if source_node else source_id,
            "target_name": target_node.get("name") if target_node else target_id,
        },
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.get("/stats/{course_id}")
def get_graph_stats(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return analytics stats for a course's shared concept graph."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)
    return neo4j_service.get_graph_stats(_resolve_catalog_id(course))


@router.get("/search/{course_id}")
def search_course_concepts(
    course_id: int,
    q: str = Query(..., min_length=1, description="Search query string"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Search concept nodes for a course by name or description."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)
    results = neo4j_service.search_concepts(_resolve_catalog_id(course), q)
    return {"results": results, "count": len(results)}


def _assert_revision_in_scope(db: Session, revision_id: int, scope: CourseScope) -> None:
    """A catalog-scoped coordinator may only decide on revisions for catalog
    subjects they're actually assigned to - scope.catalog_ids is None only for an
    admin. Without this, any course coordinator could approve/reject another
    coordinator's subject."""
    if scope.catalog_ids is None:
        return
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    if revision.catalog_id not in scope.catalog_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned Course Coordinator for this revision's subject.",
        )


def _assert_edit_proposal_in_scope(db: Session, proposal_id: int, scope: CourseScope) -> None:
    """See _assert_revision_in_scope - same check for manual edit proposals."""
    if scope.catalog_ids is None:
        return
    proposal = db.query(GraphEditProposal).filter(GraphEditProposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edit proposal not found")
    if proposal.catalog_id not in scope.catalog_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned Course Coordinator for this proposal's subject.",
        )


# ─────────────────────────────────────────────
#  REVISION REVIEW WORKFLOW
#  (proposals produced by app/content_processing/pipeline_service.py)
# ─────────────────────────────────────────────

@router.get("/revisions/pending")
def list_pending_revisions(
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Every revision currently awaiting coordinator approval, scoped to the
    catalog subjects this coordinator is actually assigned to (scope.catalog_ids
    is None only for an admin - unrestricted). Each entry is enriched with the
    course/catalog name so the UI doesn't need a second round-trip per row."""
    revisions = (
        db.query(GraphRevision)
        .filter(GraphRevision.status == "PendingCoordinatorApproval")
        .order_by(GraphRevision.created_at.asc())
        .all()
    )
    results = []
    for revision in revisions:
        if scope.catalog_ids is not None and revision.catalog_id not in scope.catalog_ids:
            continue
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        course_id = job.course_id if job else None
        catalog = db.query(CourseCatalog).filter(CourseCatalog.id == revision.catalog_id).first()
        submitted_by = db.query(User).filter(User.id == revision.submitted_by_teacher_id).first()
        entry = revision_service.serialize_revision(revision)
        entry["course_name"] = catalog.name if catalog else f"Course #{revision.catalog_id}"
        entry["course_code"] = catalog.code if catalog else None
        entry["course_id"] = course_id
        entry["submitted_by_name"] = submitted_by.full_name if submitted_by else "Unknown"
        results.append(entry)
    return results


@router.get("/my-submissions")
def list_my_graph_submissions(
    course_id: int = Query(default=None),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Every graph revision and manual edit this teacher has submitted, with its
    current status and the coordinator's decision/notes - the teacher's side of the
    approval workflow. Declared above /revisions/{revision_id} deliberately: FastAPI
    matches routes in declaration order, so a literal path registered after the
    parameterised one would never be reached.

    Optionally narrowed to one course section via ?course_id=, for the course page.
    Revisions are matched on the catalog subject (not the section) because the graph
    itself is catalog-scoped and a revision's course link lives on its build job."""
    catalog_id = None
    if course_id is not None:
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
        assert_course_access(db, course, current_teacher)
        catalog_id = _resolve_catalog_id(course)

    revision_query = db.query(GraphRevision).filter(
        (GraphRevision.submitted_by_teacher_id == current_teacher.id)
        | (GraphRevision.teacher_reviewed_by_id == current_teacher.id)
    )
    if catalog_id is not None:
        revision_query = revision_query.filter(GraphRevision.catalog_id == catalog_id)
    revisions = revision_query.order_by(GraphRevision.created_at.desc()).all()

    proposal_query = db.query(GraphEditProposal).filter(GraphEditProposal.teacher_id == current_teacher.id)
    if course_id is not None:
        proposal_query = proposal_query.filter(GraphEditProposal.course_id == course_id)
    proposals = proposal_query.order_by(GraphEditProposal.created_at.desc()).all()

    # Resolve every referenced catalog and coordinator in one query each rather than
    # per row, so a teacher with a long history doesn't fan out into N+1 lookups.
    catalog_ids = {r.catalog_id for r in revisions} | {p.catalog_id for p in proposals}
    catalogs = {
        c.id: c for c in db.query(CourseCatalog).filter(CourseCatalog.id.in_(catalog_ids)).all()
    } if catalog_ids else {}
    coordinator_ids = {r.coordinator_id for r in revisions if r.coordinator_id} | {
        p.coordinator_id for p in proposals if p.coordinator_id
    }
    coordinators = {
        u.id: u.full_name for u in db.query(User).filter(User.id.in_(coordinator_ids)).all()
    } if coordinator_ids else {}

    def decorate(entry: dict, catalog_id_value: int, coordinator_id_value):
        catalog = catalogs.get(catalog_id_value)
        entry["subject_name"] = catalog.name if catalog else f"Subject #{catalog_id_value}"
        entry["subject_code"] = catalog.code if catalog else None
        entry["coordinator_name"] = coordinators.get(coordinator_id_value)
        return entry

    return {
        "revisions": [
            decorate(revision_service.serialize_revision(r), r.catalog_id, r.coordinator_id)
            for r in revisions
        ],
        "edit_proposals": [
            decorate(revision_service.serialize_edit_proposal(p), p.catalog_id, p.coordinator_id)
            for p in proposals
        ],
    }


@router.get("/revisions/{revision_id}", response_model=GraphRevisionResponse)
def get_revision(
    revision_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """View a proposed graph revision (diff) and its current review status.

    Scoped, not just authenticated: a revision diff is unreleased curriculum work,
    so only the teacher who submitted it, a teacher who actually teaches a section
    of that catalog subject, or an oversight role (admin/coordinator) may read it.
    Without this any logged-in user - including a student in an unrelated course -
    could page through every revision on the platform by guessing IDs.
    """
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    is_oversight = (
        current_user.role.lower() in ("admin", "program_coordinator", "course_coordinator")
        or current_user.is_program_coordinator
        or current_user.is_course_coordinator
    )
    if not is_oversight and revision.submitted_by_teacher_id != current_user.id:
        teaches_subject = (
            db.query(Course)
            .filter(
                Course.teacher_id == current_user.id,
                Course.catalog_id == revision.catalog_id,
            )
            .first()
        )
        if not teaches_subject:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this revision.",
            )

    return revision_service.serialize_revision(revision)


@router.post("/revisions/{revision_id}/approve", response_model=GraphRevisionResponse)
def approve_revision(
    revision_id: int,
    decision: CoordinatorDecisionRequest,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator gives final approval on a teacher-reviewed revision. This
    is the point where the diff actually gets merged into Neo4j - nothing before
    this step touches the graph database."""
    _assert_revision_in_scope(db, revision_id, scope)
    revision = revision_service.coordinator_decide(
        db, revision_id, approve=True, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_revision(revision)


@router.post("/revisions/{revision_id}/reject", response_model=GraphRevisionResponse)
def reject_revision(
    revision_id: int,
    decision: CoordinatorDecisionRequest,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator rejects a teacher-reviewed revision - it never reaches Neo4j."""
    _assert_revision_in_scope(db, revision_id, scope)
    revision = revision_service.coordinator_decide(
        db, revision_id, approve=False, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_revision(revision)


# ─────────────────────────────────────────────
#  MANUAL EDIT APPROVAL WORKFLOW
#  (single node/relationship edits made directly in the Concept Graph UI -
#  every one of these needs course coordinator sign-off before it reaches Neo4j,
#  same as the AI-pipeline revisions above)
# ─────────────────────────────────────────────

@router.get("/edit-proposals/pending")
def list_pending_edit_proposals(
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Every manual graph edit currently awaiting coordinator approval, scoped to
    the catalog subjects this coordinator is assigned to. Each entry is enriched
    with course/teacher names for the UI."""
    proposals = (
        db.query(GraphEditProposal)
        .filter(GraphEditProposal.status == "Pending")
        .order_by(GraphEditProposal.created_at.asc())
        .all()
    )
    results = []
    for proposal in proposals:
        if scope.catalog_ids is not None and proposal.catalog_id not in scope.catalog_ids:
            continue
        course = db.query(Course).filter(Course.id == proposal.course_id).first()
        teacher = db.query(User).filter(User.id == proposal.teacher_id).first()
        entry = revision_service.serialize_edit_proposal(proposal)
        entry["course_name"] = course.name if course else f"Course #{proposal.course_id}"
        entry["course_code"] = course.code if course else None
        entry["teacher_name"] = teacher.full_name if teacher else "Unknown"
        results.append(entry)
    return results


@router.post("/edit-proposals/{proposal_id}/approve", response_model=EditProposalResponse)
def approve_edit_proposal(
    proposal_id: int,
    decision: CoordinatorDecisionRequest,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator approves a pending manual edit - this is the point where
    it actually gets written into Neo4j."""
    _assert_edit_proposal_in_scope(db, proposal_id, scope)
    proposal = revision_service.decide_edit_proposal(
        db, proposal_id, approve=True, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_edit_proposal(proposal)


@router.post("/edit-proposals/{proposal_id}/reject", response_model=EditProposalResponse)
def reject_edit_proposal(
    proposal_id: int,
    decision: CoordinatorDecisionRequest,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator rejects a pending manual edit - it never reaches Neo4j."""
    _assert_edit_proposal_in_scope(db, proposal_id, scope)
    proposal = revision_service.decide_edit_proposal(
        db, proposal_id, approve=False, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_edit_proposal(proposal)
