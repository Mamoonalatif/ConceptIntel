from fastapi import APIRouter
from app.schemas.course import GenerateStructureRequest, GenerateStructureResponse
from app.services.ai_generator import generate_course_structure

router = APIRouter(prefix="/courses", tags=["courses"])


@router.post("/generate-structure", response_model=GenerateStructureResponse)
async def generate_structure(request: GenerateStructureRequest):
    modules, clos = generate_course_structure(request)
    return GenerateStructureResponse(modules=modules, clos=clos)
