"""
Renames the course catalog to Programming Fundamentals (PF) -> Object-Oriented
Programming (OOP) -> Calculus, and rebuilds a clean, deduplicated concept graph
+ CLO/PLO/GA outcome chain for Calculus only.

PF AND OOP ARE DELIBERATELY LEFT EMPTY
---------------------------------------
No course material has been uploaded for Programming Fundamentals or
Object-Oriented Programming yet - only Calculus has real uploaded content. An
earlier version of this script hand-authored a demo concept graph + CLOs for
all three subjects, which was the wrong call: it put fabricated data in front
of a teacher for two subjects that have no actual material behind it. That
seed was removed (see git history / the cleanup this script's previous run
was followed by). PF and OOP should get their concept graph the normal way -
upload material and run the real extraction pipeline
(app/content_processing/pipeline_service.py) - not from a script like this
one. Running this script again only touches catalog names/prerequisite and
Calculus; it will not recreate PF/OOP content.

WHY CALCULUS IS HAND-CURATED HERE, NOT RE-EXTRACTED
-----------------------------------------------------
Calculus's catalog already had real content, but it was AI-extracted over
multiple past runs into a genuinely duplicated mess (e.g. "Limits and
Continuity" / "Limits of Functions" / "One-Sided and Two-Sided Limits" /
"Computing Limits Algebraically" as four separate nodes for one idea), plus
unrelated Calculus III material (vectors, planes) that doesn't belong in a
Calculus I course. Re-running extraction on the same source would not fix
that on its own. The concept list below is a clean, hand-written replacement
covering the same subject - deduplicated by construction: every name appears
once, and every prerequisite edge points at a name in the same list. If real
course material for Calculus is re-uploaded and re-processed later, review
the resulting diff carefully before merging, same as any other course - the
same duplication risk applies to a fresh extraction run.

Run from `backend/` with the project's virtualenv (needs a live Neo4j connection
- check backend/.env NEO4J_* settings and that Neo4j is reachable):

    backend\\.venv\\Scripts\\python.exe scripts\\seed_pf_oop_calculus_demo.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.connection import SessionLocal
from app.database.models import (
    CourseCatalog, Program, User, CLO, PLO, GraduateAttribute, CLOPLOMap, PLOGAMap, ConceptCLOMap,
)
from app.knowledge_graph.services import neo4j_service
from app.outcomes import services as outcomes_services


# ─────────────────────────────────────────────────────────────────────────────
#  1. CATALOG (names/prerequisite only - no concept data implied by this step)
# ─────────────────────────────────────────────────────────────────────────────

RENAME_MAP = {
    "Applied Physics": ("Programming Fundamentals", "PF101"),
    "Digital Logic Design": ("Object-Oriented Programming", "OOP201"),
    "Calculus & Analytical Geometry": ("Calculus", "MTH101"),
}
PF_NAME, PF_CODE = "Programming Fundamentals", "PF101"
OOP_NAME, OOP_CODE = "Object-Oriented Programming", "OOP201"
CALC_NAME, CALC_CODE = "Calculus", "MTH101"


def upsert_catalog(db) -> dict:
    for old_name, (new_name, new_code) in RENAME_MAP.items():
        row = db.query(CourseCatalog).filter(CourseCatalog.name == old_name).first()
        if row:
            print(f"Renaming catalog entry '{old_name}' -> '{new_name}' ({new_code})")
            row.name = new_name
            row.code = new_code
    db.flush()

    def get_or_create(name: str, code: str) -> CourseCatalog:
        row = db.query(CourseCatalog).filter(CourseCatalog.name == name).first()
        if row:
            return row
        row = CourseCatalog(name=name, code=code)
        db.add(row)
        db.flush()
        print(f"Created catalog entry '{name}' ({code})")
        return row

    pf = get_or_create(PF_NAME, PF_CODE)
    oop = get_or_create(OOP_NAME, OOP_CODE)
    calc = get_or_create(CALC_NAME, CALC_CODE)

    if oop.prerequisite_catalog_id != pf.id:
        oop.prerequisite_catalog_id = pf.id
        print(f"Set '{OOP_NAME}' prerequisite -> '{PF_NAME}'")
    db.commit()
    db.refresh(pf); db.refresh(oop); db.refresh(calc)
    return {"PF": pf, "OOP": oop, "Calculus": calc}


# ─────────────────────────────────────────────────────────────────────────────
#  2. CALCULUS CONCEPT GRAPH (the only subject with real uploaded material)
#  Each concept: name, description, difficulty, importance_score (1-10),
#  learning_outcomes, prerequisites (names, must exist earlier in this list).
#  Names are unique by construction - no near-duplicates.
# ─────────────────────────────────────────────────────────────────────────────

CALCULUS_CONCEPTS = [
    dict(name="Functions and Their Graphs", difficulty="Easy", importance_score=8,
         description="Functions as input-output rules, their domain/range, and reading a function's behaviour (increasing/decreasing, symmetry) directly from its graph.",
         learning_outcomes="Students will be able to determine the domain of a function and sketch its graph from key features.",
         prerequisites=[]),
    dict(name="Limits and Continuity", difficulty="Easy", importance_score=10,
         description="The limit of a function as its input approaches a value, computed algebraically and graphically, and the formal definition of continuity at a point.",
         learning_outcomes="Students will be able to evaluate a limit algebraically and determine whether a function is continuous at a given point.",
         prerequisites=["Functions and Their Graphs"]),
    dict(name="The Derivative and Differentiation Rules", difficulty="Medium", importance_score=10,
         description="The derivative as the limit definition of instantaneous rate of change, and the power, product, quotient, and chain rules for computing it directly.",
         learning_outcomes="Students will be able to differentiate a combination of standard functions using the correct rule(s), including the chain rule.",
         prerequisites=["Limits and Continuity"]),
    dict(name="Applications of Derivatives", difficulty="Medium", importance_score=9,
         description="Using derivatives to find critical points, classify local maxima/minima, determine concavity, and solve related-rates and optimization problems.",
         learning_outcomes="Students will be able to find and classify the extrema of a function and solve a basic real-world optimization problem using derivatives.",
         prerequisites=["The Derivative and Differentiation Rules"]),
    dict(name="Higher-Order Derivatives and Implicit Differentiation", difficulty="Medium", importance_score=7,
         description="Differentiating a function more than once (for concavity/acceleration) and differentiating equations that are not solved explicitly for y.",
         learning_outcomes="Students will be able to compute a second derivative and differentiate an implicitly-defined relation with respect to x.",
         prerequisites=["The Derivative and Differentiation Rules"]),
    dict(name="The Indefinite Integral", difficulty="Medium", importance_score=9,
         description="Antiderivatives as the reverse of differentiation, basic integration rules, and the constant of integration.",
         learning_outcomes="Students will be able to compute the indefinite integral of standard functions and verify a result by differentiating it back.",
         prerequisites=["Applications of Derivatives"]),
    dict(name="Techniques of Integration", difficulty="Hard", importance_score=8,
         description="Substitution and integration by parts for antiderivatives that do not follow directly from the basic rules.",
         learning_outcomes="Students will be able to choose and apply substitution or integration by parts to evaluate a non-trivial indefinite integral.",
         prerequisites=["The Indefinite Integral"]),
    dict(name="The Definite Integral and Fundamental Theorem of Calculus", difficulty="Hard", importance_score=10,
         description="The definite integral as a limit of Riemann sums (signed area under a curve), and the Fundamental Theorem connecting it back to antiderivatives.",
         learning_outcomes="Students will be able to evaluate a definite integral using the Fundamental Theorem of Calculus and interpret it as a signed area.",
         prerequisites=["The Indefinite Integral"]),
    dict(name="Applications of Integration", difficulty="Medium", importance_score=8,
         description="Using definite integrals to compute area between curves, volumes of revolution, and other accumulated-quantity problems.",
         learning_outcomes="Students will be able to set up and evaluate a definite integral that computes the area between two curves or a volume of revolution.",
         prerequisites=["The Definite Integral and Fundamental Theorem of Calculus"]),
    dict(name="Sequences and Series", difficulty="Hard", importance_score=7,
         description="Infinite sequences and series, convergence tests, and the idea of a Taylor/Maclaurin series approximating a function near a point.",
         learning_outcomes="Students will be able to determine whether a given series converges using a standard test and write a function's Maclaurin series to a few terms.",
         prerequisites=["Higher-Order Derivatives and Implicit Differentiation"]),
]


def seed_concept_graph(catalog_id: int, concepts: list[dict], label: str) -> None:
    names = {c["name"] for c in concepts}
    for c in concepts:
        for prereq in c["prerequisites"]:
            assert prereq in names, f"{label}: '{c['name']}' lists unknown prerequisite '{prereq}'"

    neo4j_service.create_concept_nodes_bulk(catalog_id, [
        {
            "name": c["name"], "description": c["description"], "difficulty": c["difficulty"],
            "importance_score": c["importance_score"], "learning_outcomes": c["learning_outcomes"],
        }
        for c in concepts
    ])
    pairs = [
        {"source_name": prereq, "target_name": c["name"]}
        for c in concepts for prereq in c["prerequisites"]
    ]
    neo4j_service.create_prerequisite_relationships_bulk(catalog_id, pairs)
    print(f"{label}: seeded {len(concepts)} concepts, {len(pairs)} prerequisite edges (catalog_id={catalog_id})")


# ─────────────────────────────────────────────────────────────────────────────
#  3. CLO / PLO / GA - Calculus only
# ─────────────────────────────────────────────────────────────────────────────

GAS = [
    ("GA1", "Engineering/Computing Knowledge", "Apply knowledge of computing fundamentals, mathematics, and programming to the solution of complex problems."),
    ("GA2", "Problem Analysis", "Identify, formulate, and analyze problems to reach substantiated conclusions using first principles."),
]

PLOS = [
    ("PLO1", "Foundational Computing and Mathematics", "Apply foundational programming and mathematical concepts to solve computing problems.", ["GA1", "GA2"]),
]

CALCULUS_CLOS = [
    ("CLO1", "Evaluate Limits and Continuity", "Evaluate limits and determine the continuity of a function at a point.", ["PLO1"],
     ["Limits and Continuity"]),
    ("CLO2", "Apply Differentiation", "Apply differentiation rules and use derivatives to solve optimization and rate-of-change problems.", ["PLO1"],
     ["The Derivative and Differentiation Rules", "Applications of Derivatives", "Higher-Order Derivatives and Implicit Differentiation"]),
    ("CLO3", "Apply Integration", "Apply integration techniques and the Fundamental Theorem of Calculus to compute areas, volumes, and accumulated quantities.", ["PLO1"],
     ["The Indefinite Integral", "Techniques of Integration", "The Definite Integral and Fundamental Theorem of Calculus", "Applications of Integration"]),
    ("CLO4", "Analyze Sequences and Series", "Determine the convergence of a sequence or series and approximate a function with a Taylor/Maclaurin series.", ["PLO1"],
     ["Sequences and Series"]),
]


def seed_outcomes(db, calculus: CourseCatalog) -> None:
    admin = db.query(User).filter(User.role == "admin").first() or db.query(User).first()
    if not admin:
        print("WARNING: no users exist yet - skipping CLO/PLO/GA seed (CLO.created_by_id needs a real user).")
        return

    program = db.query(Program).filter(Program.name == "Computer Science").first()
    if not program:
        program = Program(name="Computer Science", code="CS")
        db.add(program)
        db.flush()
        print("Created Program 'Computer Science'")

    ga_by_code: dict[str, GraduateAttribute] = {}
    for code, title, desc in GAS:
        row = db.query(GraduateAttribute).filter(GraduateAttribute.code == code).first()
        if not row:
            row = GraduateAttribute(code=code, title=title, description=desc)
            db.add(row); db.flush()
        ga_by_code[code] = row
        outcomes_services.sync_ga_node(row.id, row.code, row.title, row.description or "")

    plo_by_code: dict[str, PLO] = {}
    for code, title, desc, ga_codes in PLOS:
        row = db.query(PLO).filter(PLO.program_id == program.id, PLO.code == code).first()
        if not row:
            row = PLO(program_id=program.id, code=code, title=title, description=desc)
            db.add(row); db.flush()
        plo_by_code[code] = row
        outcomes_services.sync_plo_node(row.id, program.id, row.code, row.title, row.description or "")
        ga_ids = [ga_by_code[g].id for g in ga_codes]
        db.query(PLOGAMap).filter(PLOGAMap.plo_id == row.id).delete()
        for ga_id in ga_ids:
            db.add(PLOGAMap(plo_id=row.id, ga_id=ga_id))
        outcomes_services.sync_plo_ga_links(row.id, ga_ids)
    db.flush()

    for code, title, desc, plo_codes, concept_names in CALCULUS_CLOS:
        row = db.query(CLO).filter(CLO.catalog_id == calculus.id, CLO.code == code).first()
        if not row:
            row = CLO(catalog_id=calculus.id, code=code, title=title, description=desc, created_by_id=admin.id)
            db.add(row); db.flush()
        outcomes_services.sync_clo_node(row.id, calculus.id, row.code, row.title, row.description or "")

        plo_ids = [plo_by_code[p].id for p in plo_codes]
        db.query(CLOPLOMap).filter(CLOPLOMap.clo_id == row.id).delete()
        for plo_id in plo_ids:
            db.add(CLOPLOMap(clo_id=row.id, plo_id=plo_id))
        outcomes_services.sync_clo_plo_links(row.id, plo_ids)

        for concept_name in concept_names:
            node_id = f"{calculus.id}_{concept_name.lower().strip().replace(' ', '_')}"
            db.query(ConceptCLOMap).filter(
                ConceptCLOMap.catalog_id == calculus.id,
                ConceptCLOMap.concept_node_id == node_id,
                ConceptCLOMap.clo_id == row.id,
            ).delete()
            db.add(ConceptCLOMap(catalog_id=calculus.id, concept_node_id=node_id, concept_name=concept_name, clo_id=row.id))
            outcomes_services.sync_concept_clo_links(calculus.id, node_id, [row.id])
    print(f"Calculus: seeded {len(CALCULUS_CLOS)} CLOs, mapped to PLOs and their concepts")
    db.commit()


def main():
    db = SessionLocal()
    try:
        catalogs = upsert_catalog(db)
        seed_concept_graph(catalogs["Calculus"].id, CALCULUS_CONCEPTS, "Calculus")
        seed_outcomes(db, catalogs["Calculus"])
        print("\nDone. Catalog IDs:", {k: v.id for k, v in catalogs.items()})
        print("PF and OOP catalog entries exist (renamed) but have NO concept/CLO data - upload material for them and run the normal extraction pipeline.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
