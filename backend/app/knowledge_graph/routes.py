from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Course, UploadedFile, User
from app.knowledge_graph.schemas import ConceptNodeUpdate, RelationshipCreate, GraphResponse
from app.knowledge_graph.services import neo4j_service, trigger_concept_extraction
from app.auth.routes import get_current_teacher, get_current_user

router = APIRouter(prefix="/graph", tags=["Knowledge Graph"])



@router.get("/course/{course_id}", response_model=GraphResponse)
def get_graph_by_course(
    course_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Retrieve full concept nodes and edges list for a course."""
    # Validate course exists
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    
    # Return graph representation from Neo4j
    return neo4j_service.get_course_graph(course_id)


@router.post("/build/{course_id}", status_code=status.HTTP_202_ACCEPTED)
def build_course_graph_manually(
    course_id: int, 
    db: Session = Depends(get_db), 
    current_teacher: User = Depends(get_current_teacher)
):
    """Manually triggers concept extraction from all uploaded texts for the course."""
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

    # Run extraction (in sync for direct user response feedback or trigger in background if needed)
    # Here we run directly so they see results, or could use background tasks.
    trigger_concept_extraction(course_id, combined_text)
    
    return {"message": "Knowledge graph successfully built from uploaded content."}


@router.put("/node/{course_id}/{node_id}")
def update_node_properties(
    course_id: int,
    node_id: str,
    node_in: ConceptNodeUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Update Concept node fields in Neo4j."""
    # Verify course ownership
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    # Fetch current graph to check if node exists
    graph = neo4j_service.get_course_graph(course_id)
    node_exists = any(n["id"] == node_id for n in graph["nodes"])
    if not node_exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept node '{node_id}' not found in course graph."
        )

    # Find the node's original attributes to avoid overwrite with None
    target_node = next(n for n in graph["nodes"] if n["id"] == node_id)
    name = node_in.name if node_in.name is not None else target_node.get("name")
    description = node_in.description if node_in.description is not None else target_node.get("description")
    difficulty = node_in.difficulty if node_in.difficulty is not None else target_node.get("difficulty")

    # Update in Neo4j
    neo4j_service.update_concept_node(course_id, node_id, name, description, difficulty)
    return {"message": "Node successfully updated.", "node": {"id": node_id, "name": name, "description": description, "difficulty": difficulty}}


@router.delete("/node/{course_id}/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node(
    course_id: int,
    node_id: str,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Deletes Concept node and its relationships in Neo4j."""
    # Verify course ownership
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    neo4j_service.delete_concept_node(course_id, node_id)
    return None


@router.post("/relationship", status_code=status.HTTP_201_CREATED)
def create_prerequisite(
    rel: RelationshipCreate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Creates a new prerequisite relationship in Neo4j."""
    # Verify course ownership
    course = db.query(Course).filter(Course.id == rel.course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    # Verify nodes exist in course graph
    graph = neo4j_service.get_course_graph(rel.course_id)
    # Match by name
    names = [n["name"].lower().strip() for n in graph["nodes"]]
    if rel.source_name.lower().strip() not in names:
        # Create placeholder
        neo4j_service.create_concept_node(rel.course_id, rel.source_name, f"Concept: {rel.source_name}", "Medium")
    if rel.target_name.lower().strip() not in names:
        # Create placeholder
        neo4j_service.create_concept_node(rel.course_id, rel.target_name, f"Concept: {rel.target_name}", "Medium")

    neo4j_service.create_prerequisite_relationship(rel.course_id, rel.source_name, rel.target_name)
    return {"message": f"Prerequisite relationship created: '{rel.source_name}' -> '{rel.target_name}'."}


@router.delete("/relationship/{course_id}/{source_id}/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prerequisite(
    course_id: int,
    source_id: str,
    target_id: str,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Deletes an existing prerequisite relationship in Neo4j."""
    # Verify course ownership
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    neo4j_service.delete_relationship(course_id, source_id, target_id)
    return None


@router.get("/stats/{course_id}")
def get_graph_stats(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return analytics stats for a course knowledge graph."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return neo4j_service.get_graph_stats(course_id)


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
    results = neo4j_service.search_concepts(course_id, q)
    return {"results": results, "count": len(results)}

