"""The shared per-student, per-concept mastery signal - written by whatever grades
a student (Assignment Evaluation today, quizzes later) and read by Gamification,
the Adaptive Engine, and the Analytics Dashboard. See ConceptMastery/MasteryEvidence
in app/database/models.py for why this is two tables, not one."""
from typing import Optional
from sqlalchemy.orm import Session

from app.database.models import ConceptMastery, MasteryEvidence, Enrollment


def record_evidence(
    db: Session,
    student_id: int,
    course_id: int,
    catalog_id: int,
    concept_node_id: str,
    concept_name: str,
    score: float,
    source_type: str,
    source_id: int,
) -> ConceptMastery:
    """Log one graded signal for a single concept and roll it into that student's
    running mastery average for the concept. score is 0-100. Safe to call once per
    concept touched by a single grading event (e.g. once per concept an assignment
    submission was assessed against)."""
    score = max(0.0, min(100.0, score))

    db.add(MasteryEvidence(
        student_id=student_id,
        course_id=course_id,
        concept_node_id=concept_node_id,
        concept_name=concept_name,
        source_type=source_type,
        source_id=source_id,
        score=score,
    ))

    mastery = (
        db.query(ConceptMastery)
        .filter(
            ConceptMastery.student_id == student_id,
            ConceptMastery.catalog_id == catalog_id,
            ConceptMastery.concept_node_id == concept_node_id,
        )
        .first()
    )
    if mastery is None:
        mastery = ConceptMastery(
            student_id=student_id,
            course_id=course_id,
            catalog_id=catalog_id,
            concept_node_id=concept_node_id,
            concept_name=concept_name,
            mastery_score=score,
            evidence_count=1,
        )
        db.add(mastery)
    else:
        # Running average across every signal so far - one weak submission can't
        # erase several strong ones, and vice versa.
        mastery.mastery_score = (
            (mastery.mastery_score * mastery.evidence_count) + score
        ) / (mastery.evidence_count + 1)
        mastery.evidence_count += 1
        mastery.concept_name = concept_name  # keep display name fresh if it was edited in the graph

    db.flush()

    # Enrollment.progress previously existed but was never written anywhere (a
    # dead 0.0 default the frontend displayed as "Overall Mastery %") - now that
    # real mastery evidence exists, keep it in sync so that field means something.
    enrollment = (
        db.query(Enrollment)
        .filter(Enrollment.student_id == student_id, Enrollment.course_id == course_id)
        .first()
    )
    if enrollment is not None:
        overall = get_course_average_progress(db, student_id, course_id)
        if overall is not None:
            enrollment.progress = overall

    return mastery


def get_student_mastery(db: Session, student_id: int, course_id: int) -> list[ConceptMastery]:
    """Every concept this student has at least one graded signal for, in this course."""
    return (
        db.query(ConceptMastery)
        .filter(ConceptMastery.student_id == student_id, ConceptMastery.course_id == course_id)
        .order_by(ConceptMastery.concept_name.asc())
        .all()
    )


def get_weakest_concepts(
    db: Session, student_id: int, course_id: int, limit: int = 5, threshold: float = 60.0
) -> list[ConceptMastery]:
    """Concepts below `threshold` mastery, weakest first - the Adaptive Engine's
    "what to reinforce next" candidate list."""
    return (
        db.query(ConceptMastery)
        .filter(
            ConceptMastery.student_id == student_id,
            ConceptMastery.course_id == course_id,
            ConceptMastery.mastery_score < threshold,
        )
        .order_by(ConceptMastery.mastery_score.asc())
        .limit(limit)
        .all()
    )


def get_course_mastery_heatmap(db: Session, course_id: int, at_risk_threshold: float = 65.0) -> list[dict]:
    """Aggregated, course-wide (not per-student) view of ConceptMastery - one row
    per concept with at least one student's evidence: average mastery across every
    student who's attempted it, and how many of them are below at_risk_threshold.
    This is the "concept-level mastery heatmap" / "learning bottleneck" data the
    Analytics Dashboard shows teachers - a concept with a low average AND a high
    at-risk count is a real bottleneck worth re-teaching, not just one struggling
    student."""
    rows = db.query(ConceptMastery).filter(ConceptMastery.course_id == course_id).all()
    by_concept: dict[str, list[ConceptMastery]] = {}
    for r in rows:
        by_concept.setdefault(r.concept_node_id, []).append(r)

    heatmap = []
    for concept_node_id, entries in by_concept.items():
        scores = [e.mastery_score for e in entries]
        heatmap.append({
            "concept_node_id": concept_node_id,
            "concept_name": entries[0].concept_name,
            "avg_mastery": sum(scores) / len(scores),
            "students_with_evidence": len(entries),
            "at_risk_count": sum(1 for s in scores if s < at_risk_threshold),
        })
    heatmap.sort(key=lambda h: h["avg_mastery"])
    return heatmap


def get_platform_mastery_heatmap(db: Session, at_risk_threshold: float = 65.0, limit: int = 10) -> list[dict]:
    """Same aggregation as get_course_mastery_heatmap, but across every course on
    the platform rather than one - the Admin analytics view's "weakest concepts
    platform-wide" panel. Concepts with the same name in different courses are
    kept separate (weak physics concepts and weak calculus concepts with the
    same label are different bottlenecks, not one)."""
    rows = db.query(ConceptMastery).all()
    by_concept: dict[tuple, list[ConceptMastery]] = {}
    for r in rows:
        key = (r.course_id, r.concept_node_id)
        by_concept.setdefault(key, []).append(r)

    heatmap = []
    for (course_id, concept_node_id), entries in by_concept.items():
        scores = [e.mastery_score for e in entries]
        heatmap.append({
            "concept_node_id": concept_node_id,
            "concept_name": entries[0].concept_name,
            "avg_mastery": sum(scores) / len(scores),
            "students_with_evidence": len(entries),
            "at_risk_count": sum(1 for s in scores if s < at_risk_threshold),
        })
    heatmap.sort(key=lambda h: h["avg_mastery"])
    return heatmap[:limit]


def get_course_average_progress(db: Session, student_id: int, course_id: int) -> Optional[float]:
    """A single 0-100 number for "how is this student doing in this course overall" -
    the value Enrollment.progress should now be reading from instead of the dead
    0.0 default. None if the student has no graded evidence yet in this course."""
    rows = get_student_mastery(db, student_id, course_id)
    if not rows:
        return None
    return sum(r.mastery_score for r in rows) / len(rows)
