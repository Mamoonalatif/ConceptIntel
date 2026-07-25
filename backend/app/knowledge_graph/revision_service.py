import json
import logging
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.models import Course, GraphBuildJob, GraphRevision, GraphEditProposal
from app.knowledge_graph.services import neo4j_service, _find_existing_match
from app.content_processing.schemas import GraphDiff, ConceptDiffItem

logger = logging.getLogger("conceptintel.graph_revision")


def compute_diff(catalog_id: int, chunk_extractions: List[Dict[str, Any]]) -> GraphDiff:
    """
    Aggregates concepts extracted (by Kimi) across all chunks of one pipeline run,
    dedupes them against each other AND against what's already in the catalog's
    live Neo4j graph, and returns a diff describing what would change if approved.
    Nothing is written to Neo4j here - this is a preview only.
    """
    existing_names = neo4j_service.get_existing_concept_names(catalog_id)
    seen_in_this_run: List[str] = []
    items: List[ConceptDiffItem] = []
    new_count = 0
    matched_count = 0
    relationship_count = 0

    # Phase 1: dedupe concepts across chunks and against the existing graph
    name_mapping: Dict[str, str] = {}
    for extraction in chunk_extractions:
        for concept in extraction.get("concepts", []):
            raw_name = concept.get("name", "").strip()
            if not raw_name:
                continue

            matched = _find_existing_match(raw_name, existing_names) or _find_existing_match(raw_name, seen_in_this_run)
            if matched:
                name_mapping[raw_name] = matched
                matched_count += 1
                continue

            canonical = raw_name
            name_mapping[raw_name] = canonical
            seen_in_this_run.append(canonical)
            new_count += 1

            items.append(ConceptDiffItem(
                name=canonical,
                description=concept.get("description", "")[:500],
                difficulty=concept.get("difficulty", "Medium"),
                importance_score=concept.get("importance_score", 5),
                learning_outcomes=concept.get("learning_outcomes", "")[:300],
                prerequisites=[],  # filled in phase 2
                is_new=True,
            ))

    # Phase 2: resolve prerequisite links against the canonical names decided above
    item_by_name = {item.name: item for item in items}
    all_known = existing_names + seen_in_this_run
    for extraction in chunk_extractions:
        for concept in extraction.get("concepts", []):
            raw_name = concept.get("name", "").strip()
            canonical = name_mapping.get(raw_name)
            if not canonical or canonical not in item_by_name:
                continue  # matched an already-existing concept - no new node to attach prereqs to

            for prereq_raw in concept.get("prerequisites", []):
                prereq_canonical = name_mapping.get(prereq_raw) or _find_existing_match(prereq_raw, all_known)
                if prereq_canonical and prereq_canonical != canonical:
                    if prereq_canonical not in item_by_name[canonical].prerequisites:
                        item_by_name[canonical].prerequisites.append(prereq_canonical)
                        relationship_count += 1

    return GraphDiff(
        concepts=items,
        new_concept_count=new_count,
        matched_existing_count=matched_count,
        new_relationship_count=relationship_count,
    )


def create_revision(db: Session, job: GraphBuildJob, catalog_id: int, diff: GraphDiff) -> GraphRevision:
    """Persists a proposed diff as PendingTeacherReview. Nothing is written to Neo4j."""
    is_initial = len(neo4j_service.get_existing_concept_names(catalog_id)) == 0

    revision = GraphRevision(
        job_id=job.id,
        catalog_id=catalog_id,
        is_initial=is_initial,
        diff_json=diff.model_dump_json(),
        submitted_by_teacher_id=job.triggered_by_teacher_id,
        status="PendingTeacherReview",
    )
    db.add(revision)
    db.commit()
    db.refresh(revision)
    return revision


def teacher_review(db: Session, revision_id: int, teacher_id: int, action: str,
                    edited_diff: GraphDiff = None, notes: str = None) -> GraphRevision:
    """
    The teacher who uploaded the material (or any teacher of the course) reviews the
    proposed diff - confirming it (optionally after editing it) sends it on to the
    course coordinator for final approval; rejecting it ends the revision here.
    """
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    if revision.status != "PendingTeacherReview":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Revision is not awaiting teacher review (current status: {revision.status})."
        )

    job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()

    if action == "reject":
        revision.status = "Rejected"
        if job:
            job.status = "Rejected"
    elif action == "confirm":
        if edited_diff is not None:
            revision.diff_json = edited_diff.model_dump_json()
        revision.status = "PendingCoordinatorApproval"
        if job:
            job.status = "AwaitingCoordinatorApproval"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="action must be 'confirm' or 'reject'.")

    revision.teacher_reviewed_by_id = teacher_id
    revision.teacher_reviewed_at = datetime.utcnow()
    revision.teacher_edit_notes = notes

    db.commit()
    db.refresh(revision)
    return revision


def coordinator_decide(db: Session, revision_id: int, approve: bool, coordinator_id: int, notes: str = None) -> GraphRevision:
    """
    Final step. On approval, the diff is actually merged into Neo4j here - this is
    the only place unreviewed pipeline output ever reaches the graph database.
    """
    revision = db.query(GraphRevision).filter(GraphRevision.id == revision_id).first()
    if not revision:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    if revision.status != "PendingCoordinatorApproval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Revision is not awaiting coordinator approval (current status: {revision.status})."
        )

    if approve:
        diff = GraphDiff.model_validate_json(revision.diff_json)
        merge_diff_into_graph(revision.catalog_id, diff)
        revision.status = "Approved"

        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        if job:
            job.status = "Merged"
            course = db.query(Course).filter(Course.id == job.course_id).first()
            if course:
                course.graph_status = "Approved"
    else:
        revision.status = "Rejected"
        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        if job:
            job.status = "Rejected"

    revision.coordinator_id = coordinator_id
    revision.coordinator_decision_at = datetime.utcnow()
    revision.coordinator_notes = notes

    db.commit()
    db.refresh(revision)
    return revision


def merge_diff_into_graph(catalog_id: int, diff: GraphDiff) -> None:
    """Writes an approved diff's concepts and prerequisite relationships into Neo4j."""
    for item in diff.concepts:
        neo4j_service.create_concept_node(
            catalog_id=catalog_id,
            name=item.name,
            description=item.description,
            difficulty=item.difficulty,
            importance_score=item.importance_score,
            learning_outcomes=item.learning_outcomes,
        )
    for item in diff.concepts:
        for prereq_name in item.prerequisites:
            neo4j_service.create_prerequisite_relationship(catalog_id, prereq_name, item.name)


def propose_edit(
    db: Session, catalog_id: int, course_id: int, teacher_id: int,
    operation: str, payload: Dict[str, Any]
) -> GraphEditProposal:
    """
    Records one manual graph edit (add/update/delete a node, add/delete a
    relationship) made by a teacher in the Knowledge Graph UI as Pending -
    nothing is written to Neo4j here. See decide_edit_proposal for the only
    place a manual edit actually reaches the graph database.
    """
    proposal = GraphEditProposal(
        catalog_id=catalog_id,
        course_id=course_id,
        teacher_id=teacher_id,
        operation=operation,
        payload_json=json.dumps(payload),
        status="Pending",
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal


def _apply_edit_operation(catalog_id: int, operation: str, payload: Dict[str, Any]) -> None:
    """Writes one approved manual edit into Neo4j. Mirrors the same node/relationship
    logic knowledge_graph/routes.py used to run immediately, before edits required
    coordinator approval."""
    if operation == "create_node":
        neo4j_service.create_concept_node(
            catalog_id=catalog_id,
            name=payload["name"],
            description=payload.get("description", ""),
            difficulty=payload.get("difficulty", "Medium"),
            importance_score=payload.get("importance_score", 5),
            learning_outcomes=payload.get("learning_outcomes", ""),
        )
    elif operation == "update_node":
        neo4j_service.update_concept_node(
            catalog_id=catalog_id,
            node_id=payload["node_id"],
            name=payload["name"],
            description=payload["description"],
            difficulty=payload["difficulty"],
        )
    elif operation == "delete_node":
        neo4j_service.delete_concept_node(catalog_id, payload["node_id"])
    elif operation == "create_relationship":
        existing_names = neo4j_service.get_existing_concept_names(catalog_id)
        lower_names = [n.lower().strip() for n in existing_names]
        if payload["source_name"].lower().strip() not in lower_names:
            neo4j_service.create_concept_node(
                catalog_id, payload["source_name"], f"Concept: {payload['source_name']}", "Medium"
            )
        if payload["target_name"].lower().strip() not in lower_names:
            neo4j_service.create_concept_node(
                catalog_id, payload["target_name"], f"Concept: {payload['target_name']}", "Medium"
            )
        neo4j_service.create_prerequisite_relationship(catalog_id, payload["source_name"], payload["target_name"])
    elif operation == "delete_relationship":
        neo4j_service.delete_relationship(catalog_id, payload["source_id"], payload["target_id"])
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown edit operation: {operation}")


def decide_edit_proposal(db: Session, proposal_id: int, approve: bool, coordinator_id: int, notes: str = None) -> GraphEditProposal:
    """
    Course Coordinator approves or rejects one pending manual edit. On approval,
    the edit is applied to Neo4j right here - this is the only place a manual
    edit ever reaches the graph database.
    """
    proposal = db.query(GraphEditProposal).filter(GraphEditProposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edit proposal not found")
    if proposal.status != "Pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Edit proposal is not pending (current status: {proposal.status})."
        )

    payload = json.loads(proposal.payload_json)
    if approve:
        _apply_edit_operation(proposal.catalog_id, proposal.operation, payload)
        proposal.status = "Approved"
    else:
        proposal.status = "Rejected"

    proposal.coordinator_id = coordinator_id
    proposal.coordinator_decision_at = datetime.utcnow()
    proposal.coordinator_notes = notes

    db.commit()
    db.refresh(proposal)
    return proposal


def serialize_edit_proposal(proposal: GraphEditProposal) -> Dict[str, Any]:
    """Builds an EditProposalResponse-shaped dict from a GraphEditProposal row."""
    return {
        "id": proposal.id,
        "catalog_id": proposal.catalog_id,
        "course_id": proposal.course_id,
        "teacher_id": proposal.teacher_id,
        "operation": proposal.operation,
        "payload": json.loads(proposal.payload_json),
        "status": proposal.status,
        "coordinator_id": proposal.coordinator_id,
        "coordinator_decision_at": proposal.coordinator_decision_at,
        "coordinator_notes": proposal.coordinator_notes,
        "created_at": proposal.created_at,
    }


def serialize_revision(revision: GraphRevision) -> Dict[str, Any]:
    """Builds a GraphRevisionResponse-shaped dict from a GraphRevision row."""
    return {
        "id": revision.id,
        "job_id": revision.job_id,
        "catalog_id": revision.catalog_id,
        "is_initial": revision.is_initial,
        "diff": json.loads(revision.diff_json),
        "submitted_by_teacher_id": revision.submitted_by_teacher_id,
        "status": revision.status,
        "teacher_reviewed_by_id": revision.teacher_reviewed_by_id,
        "teacher_reviewed_at": revision.teacher_reviewed_at,
        "teacher_edit_notes": revision.teacher_edit_notes,
        "coordinator_id": revision.coordinator_id,
        "coordinator_decision_at": revision.coordinator_decision_at,
        "coordinator_notes": revision.coordinator_notes,
        "created_at": revision.created_at,
    }
