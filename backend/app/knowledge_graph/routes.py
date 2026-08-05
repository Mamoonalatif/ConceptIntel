from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Course, CourseCatalog, UploadedFile, User, GraphRevision, GraphBuildJob, GraphEditProposal
from app.knowledge_graph.schemas import ConceptNodeCreate, ConceptNodeUpdate, RelationshipCreate, GraphResponse, CourseGraphStatusResponse, EditProposalResponse
from app.knowledge_graph.services import neo4j_service, trigger_concept_extraction
from app.auth.routes import get_current_teacher, get_current_user, get_current_course_coordinator, CourseScope
from app.courses.access import assert_course_access
from app.notifications.service import create_notification
from app.notifications.types import NotificationType
from app.email_service import send_notification_email
from app.knowledge_graph import revision_service
from app.content_processing.schemas import GraphRevisionResponse, CoordinatorDecisionRequest

router = APIRouter(prefix="/graph", tags=["Knowledge Graph"])


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
    Students may only view it once a Course Coordinator has approved it; teachers/
    admin/coordinators can always see it (they need to review/build it before
    approval)."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    assert_course_access(db, course, current_user)

    assert_course_access(db, course, current_user)

    if current_user.role.lower() == "student" and course.graph_status != "Approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This course's knowledge graph is pending coordinator approval."
        )

    # Return graph representation from Neo4j, keyed by the shared catalog_id
    return neo4j_service.get_catalog_graph(_resolve_catalog_id(course))


@router.post("/course/{course_id}/approve", response_model=CourseGraphStatusResponse)
def approve_course_graph(
    course_id: int,
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Course Coordinator (or admin) approves a course's knowledge graph, making it
    visible to enrolled students. This is the legacy/manual approval switch, kept
    for the direct-build path - the reviewed pipeline instead uses the per-revision
    approve/reject endpoints below, which also flip this same flag once merged."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if scope.course_ids is not None and course.id not in scope.course_ids:
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
            title="Knowledge graph approved",
            message=f"The knowledge graph for {course.name} was approved and is now visible to students.",
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
    """Course Coordinator (or admin) rejects a course's knowledge graph - it remains
    hidden from students until re-approved."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if scope.course_ids is not None and course.id not in scope.course_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned as this course's Course Coordinator."
        )
    course.graph_status = "Rejected"
    db.commit()
    db.refresh(course)
    try:
        create_notification(
            db, course.teacher_id, NotificationType.GRAPH_REJECTED,
            title="Knowledge graph rejected",
            message=f"The knowledge graph for {course.name} was rejected. Please review and rebuild it.",
            link=f"/course/{course.id}/graph",
        )
        teacher = db.query(User).filter(User.id == course.teacher_id).first()
        if teacher:
            send_notification_email(
                teacher.email, teacher.full_name,
                title="Knowledge graph rejected",
                message=f"The knowledge graph for {course.name} was rejected by a course coordinator. Please review and rebuild it.",
                link=f"/course/{course.id}/graph",
            )
    except Exception as e:
        print(f"Warning: failed to create graph-rejected notification: {str(e)}")
    return course


@router.post("/build/{course_id}", status_code=status.HTTP_202_ACCEPTED)
def build_course_graph_manually(
    course_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Legacy/manual path: immediately extracts concepts from all uploaded texts for
    the course and writes them straight into the shared catalog graph, with no
    review step. Useful for quick local testing. For the full OCR -> Kimi -> diff ->
    teacher review -> coordinator approval flow, use
    POST /api/content-processing/trigger/{course_id} instead."""
    # Ensure course exists and belongs to the teacher
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    # Fetch completed files
    completed_files = db.query(UploadedFile).filter(
        UploadedFile.course_id == course_id,
        UploadedFile.status == "Completed"
    ).all()

    if not completed_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files have been parsed successfully for this course. Please upload documents first."
        )

    # Join text from all files
    combined_text = "\n\n".join([f.extracted_text for f in completed_files if f.extracted_text])

    if not combined_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Extracted text is empty. Make sure uploaded documents contain readable content."
        )

    catalog_id = _resolve_catalog_id(course)
    catalog = db.query(CourseCatalog).filter(CourseCatalog.id == catalog_id).first()
    trigger_concept_extraction(
        catalog_id,
        combined_text,
        course_name=catalog.name if catalog else course.name,
        course_code=catalog.code if catalog else course.code,
    )

    return {"message": "Knowledge graph successfully built from uploaded content."}


def _get_owned_course(db: Session, course_id: int, current_teacher: User) -> Course:
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

    proposal = revision_service.propose_edit(
        db, catalog_id, course_id, current_teacher.id, "update_node",
        {
            "node_id": node_id,
            "name": name, "description": description, "difficulty": difficulty,
            # Current (pre-edit) values, captured here purely so the coordinator's
            # review queue can show a real before/after diff - not read by
            # _apply_edit_operation, which only needs the new values above.
            "old_name": target_node.get("name"),
            "old_description": target_node.get("description"),
            "old_difficulty": target_node.get("difficulty"),
        },
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
    """Return analytics stats for a course's shared knowledge graph."""
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


# ─────────────────────────────────────────────
#  REVISION REVIEW WORKFLOW
#  (proposals produced by app/content_processing/pipeline_service.py)
# ─────────────────────────────────────────────

@router.get("/revisions/pending")
def list_pending_revisions(
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Every revision currently awaiting coordinator approval, across all courses -
    the queue a course coordinator works through. Each entry is enriched with the
    course/catalog name so the UI doesn't need a second round-trip per row."""
    revisions = (
        db.query(GraphRevision)
        .filter(GraphRevision.status == "PendingCoordinatorApproval")
        .order_by(GraphRevision.created_at.asc())
        .all()
    )
    results = []
    for revision in revisions:
        catalog = db.query(CourseCatalog).filter(CourseCatalog.id == revision.catalog_id).first()
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        submitted_by = db.query(User).filter(User.id == revision.submitted_by_teacher_id).first()
        entry = revision_service.serialize_revision(revision)
        entry["course_name"] = catalog.name if catalog else f"Course #{revision.catalog_id}"
        entry["course_code"] = catalog.code if catalog else None
        entry["course_id"] = job.course_id if job else None
        entry["submitted_by_name"] = submitted_by.full_name if submitted_by else "Unknown"
        results.append(entry)
    return results


@router.get("/revisions/{revision_id}", response_model=GraphRevisionResponse)
def get_revision(
    revision_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """View a proposed graph revision (diff) and its current review status."""
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
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
    revision = revision_service.coordinator_decide(
        db, revision_id, approve=False, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_revision(revision)


# ─────────────────────────────────────────────
#  MANUAL EDIT APPROVAL WORKFLOW
#  (single node/relationship edits made directly in the Knowledge Graph UI -
#  every one of these needs course coordinator sign-off before it reaches Neo4j,
#  same as the AI-pipeline revisions above)
# ─────────────────────────────────────────────

@router.get("/edit-proposals/pending")
def list_pending_edit_proposals(
    db: Session = Depends(get_db),
    scope: CourseScope = Depends(get_current_course_coordinator)
):
    """Every manual graph edit currently awaiting coordinator approval, across all
    courses. Each entry is enriched with course/teacher names for the UI."""
    proposals = (
        db.query(GraphEditProposal)
        .filter(GraphEditProposal.status == "Pending")
        .order_by(GraphEditProposal.created_at.asc())
        .all()
    )
    results = []
    for proposal in proposals:
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
    proposal = revision_service.decide_edit_proposal(
        db, proposal_id, approve=False, coordinator_id=scope.user.id, notes=decision.notes
    )
    return revision_service.serialize_edit_proposal(proposal)
