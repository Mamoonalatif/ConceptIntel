"""CLO / PLO / GA outcome chain: Postgres is the source of truth (CRUD + mapping
tables, see app/database/models.py), Neo4j is a mirror so the knowledge graph
itself can render/traverse Concept -> CLO -> PLO -> GA, not just PREREQUISITE
edges between concepts. Every write here does both: it commits the Postgres rows
first (so the CRUD API is correct even if Neo4j is unreachable, matching the
existing "best effort" Neo4j convention elsewhere in this app - see
Neo4jService.__init__ / knowledge_graph/services.py), then mirrors into Neo4j.
"""
import re
import logging
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.knowledge_graph.services import neo4j_service

logger = logging.getLogger("conceptintel.outcomes")


def _normalize_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _clo_node_id(clo_id: int) -> str:
    return f"clo_{clo_id}"


def _plo_node_id(plo_id: int) -> str:
    return f"plo_{plo_id}"


def _ga_node_id(ga_id: int) -> str:
    return f"ga_{ga_id}"


def sync_ga_node(ga_id: int, code: str, title: str, description: str = "") -> None:
    neo4j_service.query(
        """
        MERGE (g:GA {id: $id})
        SET g.code = $code, g.title = $title, g.description = $description
        """,
        {"id": _ga_node_id(ga_id), "code": code, "title": title, "description": description or ""},
    )


def sync_plo_node(plo_id: int, program_id: int, code: str, title: str, description: str = "") -> None:
    neo4j_service.query(
        """
        MERGE (p:PLO {id: $id})
        SET p.program_id = $program_id, p.code = $code, p.title = $title, p.description = $description
        """,
        {
            "id": _plo_node_id(plo_id), "program_id": program_id,
            "code": code, "title": title, "description": description or "",
        },
    )


def sync_clo_node(clo_id: int, catalog_id: int, code: str, title: str, description: str = "") -> None:
    neo4j_service.query(
        """
        MERGE (c:CLO {id: $id})
        SET c.catalog_id = $catalog_id, c.code = $code, c.title = $title, c.description = $description
        """,
        {
            "id": _clo_node_id(clo_id), "catalog_id": catalog_id,
            "code": code, "title": title, "description": description or "",
        },
    )


def delete_ga_node(ga_id: int) -> None:
    neo4j_service.query("MATCH (g:GA {id: $id}) DETACH DELETE g", {"id": _ga_node_id(ga_id)})


def delete_plo_node(plo_id: int) -> None:
    neo4j_service.query("MATCH (p:PLO {id: $id}) DETACH DELETE p", {"id": _plo_node_id(plo_id)})


def delete_clo_node(clo_id: int) -> None:
    neo4j_service.query("MATCH (c:CLO {id: $id}) DETACH DELETE c", {"id": _clo_node_id(clo_id)})


def sync_plo_ga_links(plo_id: int, ga_ids: List[int]) -> None:
    """Full replace: drop every existing MAPS_TO edge from this PLO, then recreate
    from the given list - matches the "full replace" semantics of the CRUD routes
    (PLOGALinkRequest.ga_ids), so Neo4j never accumulates stale links a teacher
    already removed via the API."""
    plo_node = _plo_node_id(plo_id)
    neo4j_service.query(
        "MATCH (p:PLO {id: $id})-[r:MAPS_TO]->(:GA) DELETE r",
        {"id": plo_node},
    )
    if not ga_ids:
        return
    neo4j_service.query(
        """
        UNWIND $ga_ids AS ga_id
        MATCH (p:PLO {id: $plo_id})
        MATCH (g:GA {id: ga_id})
        MERGE (p)-[:MAPS_TO]->(g)
        """,
        {"plo_id": plo_node, "ga_ids": [_ga_node_id(g) for g in ga_ids]},
    )


def sync_clo_plo_links(clo_id: int, plo_ids: List[int]) -> None:
    clo_node = _clo_node_id(clo_id)
    neo4j_service.query(
        "MATCH (c:CLO {id: $id})-[r:MAPS_TO]->(:PLO) DELETE r",
        {"id": clo_node},
    )
    if not plo_ids:
        return
    neo4j_service.query(
        """
        UNWIND $plo_ids AS plo_id
        MATCH (c:CLO {id: $clo_id})
        MATCH (p:PLO {id: plo_id})
        MERGE (c)-[:MAPS_TO]->(p)
        """,
        {"clo_id": clo_node, "plo_ids": [_plo_node_id(p) for p in plo_ids]},
    )


def sync_concept_clo_links(catalog_id: int, concept_node_id: str, clo_ids: List[int]) -> None:
    """Full replace of one concept's ADDRESSES edges to CLO nodes. The Concept node
    itself must already exist (created by the concept-extraction/graph-review
    pipeline) - if it doesn't, the MATCH below simply matches nothing and the
    relationship is silently skipped, same graceful-degradation convention as the
    rest of Neo4jService when the driver or a node is unavailable."""
    neo4j_service.query(
        "MATCH (:Concept {catalog_id: $catalog_id, id: $node_id})-[r:ADDRESSES]->(:CLO) DELETE r",
        {"catalog_id": catalog_id, "node_id": concept_node_id},
    )
    if not clo_ids:
        return
    neo4j_service.query(
        """
        UNWIND $clo_ids AS clo_id
        MATCH (concept:Concept {catalog_id: $catalog_id, id: $node_id})
        MATCH (c:CLO {id: clo_id})
        MERGE (concept)-[:ADDRESSES]->(c)
        """,
        {
            "catalog_id": catalog_id, "node_id": concept_node_id,
            "clo_ids": [_clo_node_id(c) for c in clo_ids],
        },
    )


def get_catalog_outcomes_graph(catalog_id: int) -> Dict[str, Any]:
    """Every CLO for this catalog subject plus the PLO/GA chain each one maps to,
    and which concepts address each CLO - the "outcomes layer" the knowledge graph
    UI overlays on top of the plain Concept/PREREQUISITE graph."""
    clo_rows = neo4j_service.query(
        "MATCH (c:CLO {catalog_id: $catalog_id}) RETURN c.id AS id, c.code AS code, c.title AS title",
        {"catalog_id": catalog_id},
    )
    if not clo_rows:
        return {"clos": [], "plos": [], "gas": [], "clo_plo_edges": [], "plo_ga_edges": [], "concept_clo_edges": []}

    clo_ids = [r["id"] for r in clo_rows]
    plo_edges = neo4j_service.query(
        """
        MATCH (c:CLO)-[:MAPS_TO]->(p:PLO) WHERE c.id IN $clo_ids
        RETURN c.id AS clo_id, p.id AS plo_id, p.code AS plo_code, p.title AS plo_title
        """,
        {"clo_ids": clo_ids},
    )
    plo_ids = list({r["plo_id"] for r in plo_edges})
    ga_edges = neo4j_service.query(
        """
        MATCH (p:PLO)-[:MAPS_TO]->(g:GA) WHERE p.id IN $plo_ids
        RETURN p.id AS plo_id, g.id AS ga_id, g.code AS ga_code, g.title AS ga_title
        """,
        {"plo_ids": plo_ids},
    ) if plo_ids else []
    concept_edges = neo4j_service.query(
        """
        MATCH (concept:Concept {catalog_id: $catalog_id})-[:ADDRESSES]->(c:CLO)
        RETURN concept.id AS concept_node_id, concept.name AS concept_name, c.id AS clo_id
        """,
        {"catalog_id": catalog_id},
    )

    return {
        "clos": clo_rows,
        "plos": [{"id": r["plo_id"], "code": r["plo_code"], "title": r["plo_title"]} for r in plo_edges],
        "gas": [{"id": r["ga_id"], "code": r["ga_code"], "title": r["ga_title"]} for r in ga_edges],
        "clo_plo_edges": [{"clo_id": r["clo_id"], "plo_id": r["plo_id"]} for r in plo_edges],
        "plo_ga_edges": [{"plo_id": r["plo_id"], "ga_id": r["ga_id"]} for r in ga_edges],
        "concept_clo_edges": concept_edges,
    }


def recompute_plo_attainment(db: Session, student_id: int, clo_id: int) -> None:
    """Rolls a student's CLO-level attainment up to every PLO that CLO supports -
    the reporting half of the CLO -> PLO chain CLOPLOMap otherwise only encodes
    for tagging. Called right after CLOAttainment is written/updated (see
    app/assignments/routes.py grade_submission). Caller commits.

    Each PLO's score is a plain average of the student's CLOAttainment.
    attainment_score across every CLO mapped to that PLO for which the student
    actually has evidence - a mapped CLO with zero evidence yet is left out
    rather than dragging the average toward zero for a topic they simply haven't
    been assessed on."""
    from app.database.models import CLOAttainment, CLOPLOMap, PLOAttainment

    plo_ids = [m.plo_id for m in db.query(CLOPLOMap).filter(CLOPLOMap.clo_id == clo_id).all()]
    for plo_id in plo_ids:
        clo_ids_for_plo = [m.clo_id for m in db.query(CLOPLOMap).filter(CLOPLOMap.plo_id == plo_id).all()]
        scores = [
            a.attainment_score for a in db.query(CLOAttainment).filter(
                CLOAttainment.student_id == student_id,
                CLOAttainment.clo_id.in_(clo_ids_for_plo),
            ).all()
        ]
        if not scores:
            continue
        avg = sum(scores) / len(scores)
        row = db.query(PLOAttainment).filter(
            PLOAttainment.student_id == student_id, PLOAttainment.plo_id == plo_id,
        ).first()
        if row is None:
            db.add(PLOAttainment(student_id=student_id, plo_id=plo_id, attainment_score=avg, evidence_count=len(scores)))
        else:
            row.attainment_score = avg
            row.evidence_count = len(scores)


def auto_extract_clos_for_course(db: Session, course_id: int, created_by_id: int) -> Dict[str, Any]:
    """AI-extracts Course Learning Outcomes from this course's own uploaded outline
    (many syllabi already state them explicitly - see ai_service.extract_clos_from_outline),
    creates any that don't already exist for this catalog subject, and best-effort
    maps new CLOs to the program's existing PLOs. Same direct-write CLO/PLO-link
    calls a curriculum editor's own UI action would make - nothing is auto-approved
    differently, it is just as editable afterward via the outcomes CRUD endpoints.

    Best-effort by design: called automatically right after an outline file finishes
    processing (see app/upload/routes.py) as well as from the manual "auto-extract"
    endpoint, so a course with no outline text yet, or a transient AI failure, must
    return quietly rather than raise and break an unrelated upload.

    Returns {"created": [CLO,...], "skipped_existing": int, "plo_links_created": int}.
    """
    from app.content_processing.pipeline_service import get_course_outline_text
    from app.database.models import CLO, PLO, CLOPLOMap, Course
    from app.outcomes import ai_service

    empty = {"created": [], "skipped_existing": 0, "plo_links_created": 0}

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        return empty
    catalog_id = course.catalog_id if course.catalog_id is not None else course.id

    try:
        outline_text = get_course_outline_text(db, course_id)
    except Exception as e:
        logger.warning("Could not load outline for course %s to auto-extract CLOs: %s", course_id, e)
        return empty
    if not outline_text.strip():
        return empty

    existing = db.query(CLO).filter(CLO.catalog_id == catalog_id).all()
    existing_keys = {_normalize_title(c.title) for c in existing}
    existing_codes = {c.code for c in existing}
    existing_for_prompt = [{"code": c.code, "title": c.title} for c in existing]

    try:
        extracted = ai_service.extract_clos_from_outline(outline_text, existing_for_prompt)
    except RuntimeError as e:
        logger.warning("CLO auto-extraction skipped for course %s: %s", course_id, e)
        return empty

    created: List = []
    skipped = 0
    next_num = len(existing) + 1
    for item in extracted:
        title = (item.get("title") or "").strip()
        if not title or _normalize_title(title) in existing_keys:
            skipped += 1
            continue
        code = (item.get("code") or "").strip() or f"CLO{next_num}"
        while code in existing_codes:
            next_num += 1
            code = f"CLO{next_num}"
        next_num += 1

        clo = CLO(
            catalog_id=catalog_id, code=code, title=title,
            description=(item.get("description") or None), created_by_id=created_by_id,
        )
        db.add(clo)
        db.flush()  # populate clo.id before Neo4j sync / PLO mapping below
        existing_keys.add(_normalize_title(title))
        existing_codes.add(code)
        created.append(clo)

    try:
        db.commit()
    except Exception as e:
        # A race between two near-simultaneous triggers for the same catalog (two
        # sibling-section teachers re-uploading close together, or a double-clicked
        # manual endpoint) can have both read the same "next free CLO code" snapshot
        # and both try to insert it - the second commit hits CLO's unique
        # (catalog_id, code) constraint. Must roll back and return quietly like
        # every other failure path here, not leave the session in Postgres's
        # aborted-transaction state for the caller's next query to trip over.
        logger.warning("Failed to save auto-extracted CLOs for course %s (rolled back): %s", course_id, e)
        db.rollback()
        return empty
    for clo in created:
        db.refresh(clo)
        try:
            sync_clo_node(clo.id, clo.catalog_id, clo.code, clo.title, clo.description or "")
        except Exception as e:
            logger.warning("Failed to sync auto-extracted CLO %s into Neo4j: %s", clo.id, e)

    # Best-effort: map new CLOs to the program's existing PLOs, if the catalog
    # subject belongs to a program that already has some defined. Never invents a
    # new PLO - see ai_service.suggest_clo_plo_links.
    plo_links_created = 0
    if created:
        catalog_entry = course.catalog_entry
        program_id = catalog_entry.program_id if catalog_entry else None
        plos = db.query(PLO).filter(PLO.program_id == program_id).all() if program_id else []
        if plos:
            try:
                clo_payload = [{"id": c.id, "code": c.code, "title": c.title, "description": c.description or ""} for c in created]
                plo_payload = [{"id": p.id, "code": p.code, "title": p.title, "description": p.description or ""} for p in plos]
                mapping = ai_service.suggest_clo_plo_links(clo_payload, plo_payload)
                for clo_id, plo_ids in mapping.items():
                    if not plo_ids:
                        continue
                    for plo_id in plo_ids:
                        db.add(CLOPLOMap(clo_id=clo_id, plo_id=plo_id))
                        plo_links_created += 1
                    try:
                        sync_clo_plo_links(clo_id, plo_ids)
                    except Exception as e:
                        logger.warning("Failed to sync CLO->PLO links for CLO %s into Neo4j: %s", clo_id, e)
                db.commit()
            except RuntimeError as e:
                logger.warning("CLO->PLO auto-mapping skipped for course %s: %s", course_id, e)
            except Exception as e:
                # Same "must never leave an aborted session behind" reasoning as the
                # CLO-creation commit above - CLOPLOMap's unique (clo_id, plo_id)
                # constraint can be hit if the AI ever returns a duplicate plo_id
                # (ai_service.suggest_clo_plo_links dedupes now, but this is the
                # backstop, not the only line of defense).
                logger.warning("Failed to save CLO->PLO links for course %s (rolled back): %s", course_id, e)
                db.rollback()

    return {"created": created, "skipped_existing": skipped, "plo_links_created": plo_links_created}


def auto_tag_untagged_concepts(db: Session, catalog_id: int) -> int:
    """Tags every concept-graph node in this catalog that has zero CLOs so far,
    using every CLO currently on record for this catalog (see
    ai_service.suggest_concept_clo_links). Existing manual links on a concept are
    never touched - only concepts with zero CLOs so far are auto-tagged.

    Best-effort by design: called automatically right after a graph revision is
    merged into Neo4j (see app/knowledge_graph/revision_service.py) as well as
    from the manual "auto-extract" endpoint, so a catalog with no CLOs yet, an
    empty/unreachable graph, or a transient AI failure must return quietly.

    Returns how many concepts were newly tagged.
    """
    from app.database.models import CLO, ConceptCLOMap
    from app.outcomes import ai_service

    all_clos = db.query(CLO).filter(CLO.catalog_id == catalog_id).all()
    if not all_clos:
        return 0

    try:
        graph_nodes = neo4j_service.get_catalog_graph(catalog_id).get("nodes", [])
    except Exception as e:
        logger.warning("Could not load concept graph for catalog %s to auto-tag CLOs: %s", catalog_id, e)
        return 0
    if not graph_nodes:
        return 0

    already_tagged = {
        r[0] for r in db.query(ConceptCLOMap.concept_node_id)
        .filter(ConceptCLOMap.catalog_id == catalog_id).distinct()
    }
    untagged = [
        {"node_id": n["id"], "name": n["name"], "description": n.get("description") or ""}
        for n in graph_nodes if n["id"] not in already_tagged
    ]
    if not untagged:
        return 0

    concepts_tagged = 0
    try:
        clo_payload = [{"id": c.id, "code": c.code, "title": c.title} for c in all_clos]
        mapping = ai_service.suggest_concept_clo_links(untagged, clo_payload)
        node_by_id = {n["node_id"]: n for n in untagged}
        for node_id, clo_ids in mapping.items():
            if not clo_ids or node_id not in node_by_id:
                continue
            for clo_id in clo_ids:
                db.add(ConceptCLOMap(
                    catalog_id=catalog_id, concept_node_id=node_id,
                    concept_name=node_by_id[node_id]["name"], clo_id=clo_id,
                ))
            try:
                sync_concept_clo_links(catalog_id, node_id, clo_ids)
            except Exception as e:
                logger.warning("Failed to sync concept->CLO links for '%s' into Neo4j: %s", node_id, e)
            concepts_tagged += 1
        db.commit()
    except RuntimeError as e:
        logger.warning("Concept->CLO auto-tagging skipped for catalog %s: %s", catalog_id, e)
    except Exception as e:
        # ConceptCLOMap's unique (catalog_id, concept_node_id, clo_id) constraint can
        # be hit the same way as the CLO/PLO commits above. This function is called
        # automatically right after a graph revision merge (revision_service.py
        # coordinator_decide) - an uncaught IntegrityError here previously left that
        # caller's db session in an aborted state, turning the REST of that request
        # (the revision/job/course status updates that follow) into a 500, even
        # though the actual graph merge into Neo4j had already succeeded.
        logger.warning("Concept->CLO auto-tagging failed for catalog %s (rolled back): %s", catalog_id, e)
        db.rollback()

    return concepts_tagged
