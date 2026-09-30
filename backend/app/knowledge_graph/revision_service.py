# Graph revision workflow: AI-extracted concepts are diffed against the live graph, reviewed by a teacher,
# approved by a coordinator, and only then merged into Neo4j. Manual graph edits follow the same
# propose -> coordinator-decision path. Nothing reaches Neo4j without approval.
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import Course, GraphBuildJob, GraphRevision, GraphEditProposal
from app.knowledge_graph.services import neo4j_service, _find_existing_match
from app.content_processing.schemas import GraphDiff, ConceptDiffItem
from app.notifications.service import create_notification
from app.notifications.types import NotificationType
from app.rag.embeddings import embed_texts

logger = logging.getLogger("conceptintel.graph_revision")


def _semantic_text(name: str, description: str) -> str:
    """Builds the "name. description" string that is embedded for semantic comparison."""
    return f"{name.strip()}. {(description or '').strip()}".strip(". ").strip()


def _semantic_dedup(
    items: List[ConceptDiffItem], existing_nodes: List[Dict[str, Any]],
) -> tuple[List[ConceptDiffItem], Dict[str, str]]:
    """Catches same-meaning concepts phrased differently - e.g. "Derivative" vs
    "Differentiation" - which the lexical/normalized check in compute_diff's phase 1
    cannot: that one only matches spelling/casing/punctuation variants of the SAME
    wording, not different wording for the same idea.

    Embeds each surviving candidate's "name. description" and compares it, via
    cosine similarity, against a pool that starts as the existing graph's own
    concepts and grows with every candidate accepted as genuinely new - so a
    duplicate pair that both appear for the first time in this same run (two
    different chunks, two different wordings) is caught too, not just duplicates
    of something already in the graph.

    Returns (kept_items, remap) where `remap` maps a dropped candidate's name to
    the existing/earlier concept it was merged into - the caller uses this to
    repoint name_mapping (and therefore prerequisite resolution) at the survivor.
    Best-effort: if embedding fails (e.g. no API key configured), every candidate
    is kept as-is rather than blocking the whole pipeline run over dedup quality.
    """
    if not items:
        return items, {}

    existing_texts = [_semantic_text(n.get("name", ""), n.get("description", "") or "") for n in existing_nodes]
    existing_pool_names = [n.get("name", "") for n in existing_nodes]
    candidate_texts = [_semantic_text(i.name, i.description) for i in items]

    try:
        existing_vectors = embed_texts(existing_texts) if existing_texts else []
        candidate_vectors = embed_texts(candidate_texts)
    except Exception as e:
        logger.warning(f"Semantic dedup skipped (embedding failed): {e}")
        return items, {}

    pool_vectors: List[List[float]] = list(existing_vectors)
    pool_names: List[str] = list(existing_pool_names)
    kept: List[ConceptDiffItem] = []
    remap: Dict[str, str] = {}
    threshold = settings.CONCEPT_SEMANTIC_DEDUP_THRESHOLD

    for item, vec in zip(items, candidate_vectors):
        match_name: Optional[str] = None
        if pool_vectors:
            sims = np.asarray(pool_vectors, dtype=np.float32) @ np.asarray(vec, dtype=np.float32)
            best_idx = int(np.argmax(sims))
            if float(sims[best_idx]) >= threshold:
                match_name = pool_names[best_idx]

        if match_name and match_name != item.name:
            logger.info(f"Semantic dedup: '{item.name}' merged into existing/earlier '{match_name}'")
            remap[item.name] = match_name
        else:
            kept.append(item)
            pool_vectors.append(vec)
            pool_names.append(item.name)

    return kept, remap


def compute_diff(catalog_id: int, chunk_extractions: List[Dict[str, Any]]) -> GraphDiff:
    """
    Aggregates concepts extracted (by the generation model) across all chunks of one pipeline run,
    dedupes them against each other AND against what's already in the catalog's
    live Neo4j graph, and returns a diff describing what would change if approved.
    Nothing is written to Neo4j here - this is a preview only.

    Two dedup passes, deliberately in this order:
      1. Lexical (name-only, via _find_existing_match) - cheap, catches spelling/
         casing/punctuation variants of the SAME wording.
      2. Semantic (via _semantic_dedup, embeddings) - catches same-MEANING concepts
         phrased with different wording, which pass 1 cannot see at all since it
         never looks at descriptions.
    """
    existing_nodes = neo4j_service.get_catalog_graph(catalog_id).get("nodes", [])
    existing_names = [n.get("name", "") for n in existing_nodes]
    seen_in_this_run: List[str] = []
    items: List[ConceptDiffItem] = []
    new_count = 0
    matched_count = 0
    relationship_count = 0

    # Phase 1: dedupe concepts across chunks and against the existing graph (lexical)
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

    # Phase 1b: dedupe the survivors again, semantically this time
    items, semantic_remap = _semantic_dedup(items, existing_nodes)
    if semantic_remap:
        new_count -= len(semantic_remap)
        matched_count += len(semantic_remap)
        for raw_name, canonical in list(name_mapping.items()):
            if canonical in semantic_remap:
                name_mapping[raw_name] = semantic_remap[canonical]

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

        # Best-effort: tag the concepts just merged with whichever CLOs already
        # exist for this catalog (e.g. from the outline's own "Course Learning
        # Outcomes" section, auto-extracted when it was uploaded - see
        # app/outcomes/services.py / app/upload/routes.py). A catalog with no CLOs
        # yet, or a transient AI failure, must not block the graph merge itself.
        try:
            from app.outcomes.services import auto_tag_untagged_concepts
            auto_tag_untagged_concepts(db, revision.catalog_id)
        except Exception as e:
            logger.warning("CLO auto-tagging skipped for catalog %s after merge: %s", revision.catalog_id, e)

        job = db.query(GraphBuildJob).filter(GraphBuildJob.id == revision.job_id).first()
        if job:
            job.status = "Merged"
            # The merged graph is keyed on catalog_id, so it becomes visible to EVERY
            # course section teaching this subject - not just the one that happened to
            # trigger the job. Flag them all, otherwise a sibling section shows
            # "Pending" forever while already serving the approved graph.
            db.query(Course).filter(Course.catalog_id == revision.catalog_id).update(
                {"graph_status": "Approved"}, synchronize_session=False
            )
            if job.course_id:
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

    # Tell the teacher who submitted it. Without this a rejection is completely
    # silent - the teacher has no way to learn their graph was turned down, or why.
    # Best-effort: a notification failure must not undo an already-merged graph.
    try:
        recipient_id = revision.submitted_by_teacher_id or revision.teacher_reviewed_by_id
        if recipient_id:
            note_suffix = f" Coordinator's note: {notes}" if notes else ""
            if approve:
                create_notification(
                    db, recipient_id, NotificationType.GRAPH_REVISION_APPROVED,
                    title="Concept graph approved",
                    message=f"Your proposed concepts were approved and merged into the shared concept graph.{note_suffix}",
                    link="/teacher",
                )
            else:
                create_notification(
                    db, recipient_id, NotificationType.GRAPH_REVISION_REJECTED,
                    title="Concept graph rejected",
                    message=f"Your proposed concepts were not approved by the course coordinator.{note_suffix}",
                    link="/teacher",
                )
    except Exception as e:
        print(f"Warning: failed to notify teacher of revision {revision.id} decision: {e}")

    return revision


def merge_diff_into_graph(catalog_id: int, diff: GraphDiff) -> None:
    """Writes an approved diff's concepts and prerequisite relationships into Neo4j.

    Two batched statements, not one round trip per item: the graph database is
    remote, so a large revision (79 concepts + 117 links) issued individually took
    ~56s and blew straight past the frontend's HTTP timeout - the coordinator was
    shown a failure for a merge that was still running. See the bulk methods in
    knowledge_graph/services.py.

    Nodes are still written before relationships, since a PREREQUISITE can only be
    matched once both of its endpoints exist.
    """
    concept_rows = [
        {
            "name": item.name,
            "description": item.description,
            "difficulty": item.difficulty,
            "importance_score": item.importance_score,
            "learning_outcomes": item.learning_outcomes,
        }
        for item in diff.concepts
    ]
    neo4j_service.create_concept_nodes_bulk(catalog_id, concept_rows)

    relationship_rows = [
        {"source_name": prereq_name, "target_name": item.name}
        for item in diff.concepts
        for prereq_name in item.prerequisites
    ]
    neo4j_service.create_prerequisite_relationships_bulk(catalog_id, relationship_rows)


def propose_edit(
    db: Session, catalog_id: int, course_id: int, teacher_id: int,
    operation: str, payload: Dict[str, Any]
) -> GraphEditProposal:
    """
    Records one manual graph edit (add/update/delete a node, add/delete a
    relationship) made by a teacher in the Concept Graph UI as Pending -
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
            material=payload.get("material"),
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
    elif operation == "update_material":
        neo4j_service.update_concept_material(catalog_id, payload["node_id"], payload["material"])
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

    # Same reasoning as coordinator_decide: without this the proposing teacher never
    # learns their edit was rejected. Best-effort - an already-applied edit must not
    # be undone by a notification failure.
    try:
        if proposal.teacher_id:
            note_suffix = f" Coordinator's note: {notes}" if notes else ""
            operation_label = proposal.operation.replace("_", " ")
            if approve:
                create_notification(
                    db, proposal.teacher_id, NotificationType.GRAPH_EDIT_APPROVED,
                    title="Graph edit approved",
                    message=f"Your '{operation_label}' edit was approved and applied to the shared concept graph.{note_suffix}",
                    link="/teacher",
                )
            else:
                create_notification(
                    db, proposal.teacher_id, NotificationType.GRAPH_EDIT_REJECTED,
                    title="Graph edit rejected",
                    message=f"Your '{operation_label}' edit was not approved by the course coordinator.{note_suffix}",
                    link="/teacher",
                )
    except Exception as e:
        print(f"Warning: failed to notify teacher of edit proposal {proposal.id} decision: {e}")

    return proposal


# Serializers: convert DB rows (with JSON text columns) into plain dicts matching the response schemas.
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
