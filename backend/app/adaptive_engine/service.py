"""The Adaptive Engine - an Observe -> Analyze -> Plan -> Act loop over real data,
deliberately plain deterministic code rather than an LLM call: "which concept
should this student review next" needs to be explainable and reproducible, not a
model's guess. Reuses data already collected by other modules rather than
inventing a new signal:

- Observe: app/mastery/service.py's ConceptMastery (written by Assignment
  Evaluation grading and quiz attempts).
- Analyze: which concepts are below a mastery threshold, and which of those are
  "foundational" (other concepts in the graph depend on them as a prerequisite) -
  foundational gaps block more downstream learning, so they're prioritized first
  even over a slightly weaker but less-depended-on concept.
- Plan: an ordered revision list.
- Act: each plan item links to existing approved study materials for that concept
  (see Content Generation module) if any exist, so the plan is actionable, not
  just a list of weak points.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.database.models import Course, GeneratedContent
from app.mastery import service as mastery_service
from app.knowledge_graph.services import neo4j_service

WEAK_MASTERY_THRESHOLD = 65.0


def _dependents_count(edges: list[dict], concept_node_id: str) -> int:
    """How many concepts have this one as a prerequisite (edge direction is
    source=prerequisite -> target=dependent, see
    knowledge_graph/services.py create_prerequisite_relationship)."""
    return sum(1 for e in edges if e["source"] == concept_node_id)


def build_revision_plan(db: Session, student_id: int, course_id: int, course: Course) -> dict:
    overall_progress = mastery_service.get_course_average_progress(db, student_id, course_id)

    weak_concepts = mastery_service.get_weakest_concepts(
        db, student_id, course_id, limit=50, threshold=WEAK_MASTERY_THRESHOLD,
    )
    if not weak_concepts:
        return {"course_id": course_id, "overall_progress": overall_progress, "plan": []}

    edges = []
    if course.catalog_id:
        graph = neo4j_service.get_catalog_graph(course.catalog_id)
        edges = graph.get("edges", [])

    # Pull every Approved content item for this course once, then group by concept -
    # avoids one query per weak concept.
    approved_by_concept: dict[str, list[GeneratedContent]] = {}
    for item in db.query(GeneratedContent).filter(
        GeneratedContent.course_id == course_id, GeneratedContent.status == "Approved"
    ).all():
        approved_by_concept.setdefault(item.concept_node_id, []).append(item)

    plan_items = []
    for concept in weak_concepts:
        dependents = _dependents_count(edges, concept.concept_node_id)
        is_foundational = dependents > 0

        if is_foundational:
            reason = (
                f"Foundational gap - {dependents} other concept(s) in this course build on "
                f"'{concept.concept_name}', so strengthening it first unblocks the most future learning."
            )
        elif concept.mastery_score < 40:
            reason = f"Significant gap - current mastery is only {round(concept.mastery_score)}/100."
        else:
            reason = f"Below target mastery ({round(concept.mastery_score)}/100, target {int(WEAK_MASTERY_THRESHOLD)}+)."

        materials = approved_by_concept.get(concept.concept_node_id, [])
        plan_items.append({
            "concept_node_id": concept.concept_node_id,
            "concept_name": concept.concept_name,
            "mastery_score": concept.mastery_score,
            "is_foundational": is_foundational,
            "dependents_count": dependents,
            "reason": reason,
            "recommended_materials": [
                {"content_id": m.id, "content_type": m.content_type, "title": m.title} for m in materials
            ],
        })

    # Foundational gaps first (most dependents first among those), then by lowest mastery.
    plan_items.sort(key=lambda p: (not p["is_foundational"], -p["dependents_count"], p["mastery_score"]))

    return {"course_id": course_id, "overall_progress": overall_progress, "plan": plan_items}
