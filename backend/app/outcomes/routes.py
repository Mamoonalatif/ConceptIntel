"""CRUD + mapping for the CLO -> PLO -> GA outcome chain, plus linking knowledge-
graph concepts to CLOs. See app/outcomes/services.py for the Neo4j mirroring and
app/database/models.py (CLO/PLO/GraduateAttribute/*Map) for the Postgres schema.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import (
    CLO, PLO, GraduateAttribute, CLOPLOMap, PLOGAMap, ConceptCLOMap, Course, User,
    CLOAttainment, PLOAttainment,
)
from app.auth.routes import get_current_user, get_current_admin, get_current_program_coordinator, get_current_student
from app.outcomes import schemas, services
from app.content_processing.pipeline_service import get_course_outline_text

router = APIRouter(prefix="/outcomes", tags=["Outcomes (CLO/PLO/GA)"])


def get_current_curriculum_editor(current_user: User = Depends(get_current_user)) -> User:
    """Who may define/edit CLOs and link concepts to them: any staff role - teacher,
    course/program coordinator, or admin. Deliberately broader than course
    ownership (unlike Assignment/GeneratedContent CRUD elsewhere) because a CLO is
    shared curriculum data for a whole catalog subject, the same scoping as the
    concept graph itself - any teacher of that subject should be able to propose one."""
    if current_user.role.lower() == "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Students cannot manage learning outcomes.")
    return current_user


# ── Graduate Attributes (global, admin-managed) ───────────────────────────
@router.get("/gas", response_model=list[schemas.GAOut])
def list_gas(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(GraduateAttribute).order_by(GraduateAttribute.code.asc()).all()


@router.post("/gas", response_model=schemas.GAOut, status_code=status.HTTP_201_CREATED)
def create_ga(payload: schemas.GACreate, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    if db.query(GraduateAttribute).filter(GraduateAttribute.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A GA with code '{payload.code}' already exists.")
    ga = GraduateAttribute(code=payload.code, title=payload.title, description=payload.description)
    db.add(ga)
    db.commit()
    db.refresh(ga)
    try:
        services.sync_ga_node(ga.id, ga.code, ga.title, ga.description or "")
    except Exception as e:
        print(f"Warning: failed to sync GA {ga.id} into Neo4j: {str(e)}")
    return ga


@router.delete("/gas/{ga_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ga(ga_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    ga = db.query(GraduateAttribute).filter(GraduateAttribute.id == ga_id).first()
    if not ga:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graduate Attribute not found")
    db.query(PLOGAMap).filter(PLOGAMap.ga_id == ga_id).delete()
    db.delete(ga)
    db.commit()
    try:
        services.delete_ga_node(ga_id)
    except Exception as e:
        print(f"Warning: failed to delete GA {ga_id} from Neo4j: {str(e)}")
    return None


# ── Program Learning Outcomes ─────────────────────────────────────────────
def _plo_to_out(plo: PLO, db: Session) -> schemas.PLOOut:
    ga_ids = [m.ga_id for m in db.query(PLOGAMap).filter(PLOGAMap.plo_id == plo.id).all()]
    return schemas.PLOOut(
        id=plo.id, program_id=plo.program_id, code=plo.code, title=plo.title,
        description=plo.description, ga_ids=ga_ids, created_at=plo.created_at,
    )


@router.get("/plos", response_model=list[schemas.PLOOut])
def list_plos(program_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(PLO)
    if program_id is not None:
        q = q.filter(PLO.program_id == program_id)
    return [_plo_to_out(p, db) for p in q.order_by(PLO.code.asc()).all()]


@router.post("/plos", response_model=schemas.PLOOut, status_code=status.HTTP_201_CREATED)
def create_plo(payload: schemas.PLOCreate, db: Session = Depends(get_db), scope=Depends(get_current_program_coordinator)):
    if scope.program_ids is not None and payload.program_id not in scope.program_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a coordinator of this program.")
    if db.query(PLO).filter(PLO.program_id == payload.program_id, PLO.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"PLO code '{payload.code}' already exists for this program.")
    plo = PLO(program_id=payload.program_id, code=payload.code, title=payload.title, description=payload.description)
    db.add(plo)
    db.commit()
    db.refresh(plo)
    try:
        services.sync_plo_node(plo.id, plo.program_id, plo.code, plo.title, plo.description or "")
    except Exception as e:
        print(f"Warning: failed to sync PLO {plo.id} into Neo4j: {str(e)}")
    return _plo_to_out(plo, db)


@router.put("/plos/{plo_id}/gas", response_model=schemas.PLOOut)
def set_plo_gas(plo_id: int, payload: schemas.PLOGALinkRequest, db: Session = Depends(get_db), scope=Depends(get_current_program_coordinator)):
    plo = db.query(PLO).filter(PLO.id == plo_id).first()
    if not plo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PLO not found")
    if scope.program_ids is not None and plo.program_id not in scope.program_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a coordinator of this program.")

    db.query(PLOGAMap).filter(PLOGAMap.plo_id == plo_id).delete()
    for ga_id in payload.ga_ids:
        db.add(PLOGAMap(plo_id=plo_id, ga_id=ga_id))
    db.commit()
    try:
        services.sync_plo_ga_links(plo_id, payload.ga_ids)
    except Exception as e:
        print(f"Warning: failed to sync PLO->GA links for PLO {plo_id} into Neo4j: {str(e)}")
    return _plo_to_out(plo, db)


@router.delete("/plos/{plo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plo(plo_id: int, db: Session = Depends(get_db), scope=Depends(get_current_program_coordinator)):
    plo = db.query(PLO).filter(PLO.id == plo_id).first()
    if not plo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PLO not found")
    if scope.program_ids is not None and plo.program_id not in scope.program_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a coordinator of this program.")
    db.query(PLOGAMap).filter(PLOGAMap.plo_id == plo_id).delete()
    db.query(CLOPLOMap).filter(CLOPLOMap.plo_id == plo_id).delete()
    db.delete(plo)
    db.commit()
    try:
        services.delete_plo_node(plo_id)
    except Exception as e:
        print(f"Warning: failed to delete PLO {plo_id} from Neo4j: {str(e)}")
    return None


# ── Course Learning Outcomes ──────────────────────────────────────────────
def _clo_to_out(clo: CLO, db: Session) -> schemas.CLOOut:
    plo_ids = [m.plo_id for m in db.query(CLOPLOMap).filter(CLOPLOMap.clo_id == clo.id).all()]
    return schemas.CLOOut(
        id=clo.id, catalog_id=clo.catalog_id, code=clo.code, title=clo.title,
        description=clo.description, plo_ids=plo_ids,
        created_by_id=clo.created_by_id, created_at=clo.created_at,
    )


@router.get("/clos", response_model=list[schemas.CLOOut])
def list_clos(catalog_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every CLO for one catalog subject - the list a rubric-criterion or
    content-generation "link to CLO" dropdown populates from."""
    clos = db.query(CLO).filter(CLO.catalog_id == catalog_id).order_by(CLO.code.asc()).all()
    return [_clo_to_out(c, db) for c in clos]


@router.post("/clos", response_model=schemas.CLOOut, status_code=status.HTTP_201_CREATED)
def create_clo(payload: schemas.CLOCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_curriculum_editor)):
    if db.query(CLO).filter(CLO.catalog_id == payload.catalog_id, CLO.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"CLO code '{payload.code}' already exists for this course.")
    clo = CLO(
        catalog_id=payload.catalog_id, code=payload.code, title=payload.title,
        description=payload.description, created_by_id=current_user.id,
    )
    db.add(clo)
    db.commit()
    db.refresh(clo)
    try:
        services.sync_clo_node(clo.id, clo.catalog_id, clo.code, clo.title, clo.description or "")
    except Exception as e:
        print(f"Warning: failed to sync CLO {clo.id} into Neo4j: {str(e)}")
    return _clo_to_out(clo, db)


@router.put("/clos/{clo_id}/plos", response_model=schemas.CLOOut)
def set_clo_plos(clo_id: int, payload: schemas.CLOPLOLinkRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_curriculum_editor)):
    clo = db.query(CLO).filter(CLO.id == clo_id).first()
    if not clo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CLO not found")

    db.query(CLOPLOMap).filter(CLOPLOMap.clo_id == clo_id).delete()
    for plo_id in payload.plo_ids:
        db.add(CLOPLOMap(clo_id=clo_id, plo_id=plo_id))
    db.commit()
    try:
        services.sync_clo_plo_links(clo_id, payload.plo_ids)
    except Exception as e:
        print(f"Warning: failed to sync CLO->PLO links for CLO {clo_id} into Neo4j: {str(e)}")
    return _clo_to_out(clo, db)


@router.delete("/clos/{clo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_clo(clo_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_curriculum_editor)):
    clo = db.query(CLO).filter(CLO.id == clo_id).first()
    if not clo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CLO not found")
    db.query(CLOPLOMap).filter(CLOPLOMap.clo_id == clo_id).delete()
    db.query(ConceptCLOMap).filter(ConceptCLOMap.clo_id == clo_id).delete()
    db.delete(clo)
    db.commit()
    try:
        services.delete_clo_node(clo_id)
    except Exception as e:
        print(f"Warning: failed to delete CLO {clo_id} from Neo4j: {str(e)}")
    return None


@router.post("/clos/auto-extract", response_model=schemas.CLOAutoExtractResponse)
def auto_extract_clos(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_curriculum_editor),
):
    """Manual trigger for the same auto-extraction + auto-tagging that now also
    runs automatically (see app/outcomes/services.py auto_extract_clos_for_course /
    auto_tag_untagged_concepts) - right after an outline finishes processing, and
    right after a graph revision is merged. This endpoint exists for a teacher who
    wants to re-run it on demand (e.g. after editing the outline, or before either
    automatic trigger has fired), and to surface a clear error when there is
    nothing to extract from yet, which the best-effort automatic path deliberately
    swallows instead of raising."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    catalog_id = course.catalog_id if course.catalog_id is not None else course.id

    outline_text = get_course_outline_text(db, course_id)
    if not outline_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This course has no outline uploaded yet - upload one before auto-extracting CLOs.",
        )

    try:
        extraction = services.auto_extract_clos_for_course(db, course_id, current_user.id)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    concepts_tagged = services.auto_tag_untagged_concepts(db, catalog_id)

    return schemas.CLOAutoExtractResponse(
        created_clos=[_clo_to_out(c, db) for c in extraction["created"]],
        skipped_existing_count=extraction["skipped_existing"],
        plo_links_created=extraction["plo_links_created"],
        concepts_tagged=concepts_tagged,
    )


# ── Concept <-> CLO links ──────────────────────────────────────────────────
@router.get("/catalog/{catalog_id}/concept-clo-map", response_model=list[schemas.ConceptCLOMapOut])
def list_concept_clo_map(catalog_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every concept in this catalog subject that has at least one CLO linked -
    the knowledge graph UI's "outcomes layer" reads this to badge concept nodes."""
    rows = db.query(ConceptCLOMap).filter(ConceptCLOMap.catalog_id == catalog_id).all()
    by_concept: dict[str, schemas.ConceptCLOMapOut] = {}
    for r in rows:
        entry = by_concept.setdefault(
            r.concept_node_id,
            schemas.ConceptCLOMapOut(concept_node_id=r.concept_node_id, concept_name=r.concept_name, clo_ids=[]),
        )
        entry.clo_ids.append(r.clo_id)
    return list(by_concept.values())


@router.put("/catalog/{catalog_id}/concept-clo-map", response_model=schemas.ConceptCLOMapOut)
def set_concept_clo_links(catalog_id: int, payload: schemas.ConceptCLOLinkRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_curriculum_editor)):
    """Full replace of which CLO(s) one concept addresses."""
    db.query(ConceptCLOMap).filter(
        ConceptCLOMap.catalog_id == catalog_id,
        ConceptCLOMap.concept_node_id == payload.concept_node_id,
    ).delete()
    for clo_id in payload.clo_ids:
        db.add(ConceptCLOMap(
            catalog_id=catalog_id, concept_node_id=payload.concept_node_id,
            concept_name=payload.concept_name, clo_id=clo_id,
        ))
    db.commit()
    try:
        services.sync_concept_clo_links(catalog_id, payload.concept_node_id, payload.clo_ids)
    except Exception as e:
        print(f"Warning: failed to sync concept->CLO links for '{payload.concept_node_id}' into Neo4j: {str(e)}")
    return schemas.ConceptCLOMapOut(
        concept_node_id=payload.concept_node_id, concept_name=payload.concept_name, clo_ids=payload.clo_ids,
    )


@router.get("/catalog/{catalog_id}/graph")
def get_catalog_outcomes_graph(catalog_id: int, current_user: User = Depends(get_current_user)):
    """The full CLO -> PLO -> GA chain plus which concepts address each CLO, read
    straight from Neo4j - what the knowledge graph's outcomes layer renders."""
    try:
        return services.get_catalog_outcomes_graph(catalog_id)
    except Exception as e:
        print(f"Warning: failed to read outcomes graph for catalog {catalog_id}: {str(e)}")
        return {"clos": [], "plos": [], "gas": [], "clo_plo_edges": [], "plo_ga_edges": [], "concept_clo_edges": []}


# ── Attainment (the student's own progress up the outcome chain) ───────────
@router.get("/my-clo-attainment", response_model=list[schemas.CLOAttainmentOut])
def get_my_clo_attainment(
    course_id: int,
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """The current student's own per-CLO attainment for one course - written by
    app/assignments/routes.py grade_submission whenever a rubric criterion tagged
    with a CLO is graded. Was computed and stored since that feature shipped but
    never actually exposed anywhere until now."""
    rows = (
        db.query(CLOAttainment, CLO)
        .join(CLO, CLO.id == CLOAttainment.clo_id)
        .filter(CLOAttainment.student_id == current_student.id, CLOAttainment.course_id == course_id)
        .all()
    )
    return [
        schemas.CLOAttainmentOut(
            clo_id=clo.id, clo_code=clo.code, clo_title=clo.title,
            attainment_score=attainment.attainment_score, evidence_count=attainment.evidence_count,
        )
        for attainment, clo in rows
    ]


@router.get("/my-plo-attainment", response_model=list[schemas.PLOAttainmentOut])
def get_my_plo_attainment(
    db: Session = Depends(get_db),
    current_student: User = Depends(get_current_student),
):
    """The current student's own per-PLO attainment, rolled up from their CLO
    attainment across every course (see app/outcomes/services.py
    recompute_plo_attainment) - PLOs are program-level, not scoped to one course."""
    rows = (
        db.query(PLOAttainment, PLO)
        .join(PLO, PLO.id == PLOAttainment.plo_id)
        .filter(PLOAttainment.student_id == current_student.id)
        .all()
    )
    return [
        schemas.PLOAttainmentOut(
            plo_id=plo.id, plo_code=plo.code, plo_title=plo.title,
            attainment_score=attainment.attainment_score, evidence_count=attainment.evidence_count,
        )
        for attainment, plo in rows
    ]
