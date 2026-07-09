from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import require_roles
from app.models.user import User, UserRole
from app.schemas.auth import MessageResponse
from app.schemas.course import GenerateStructureRequest, GenerateStructureResponse
from app.services.ai_generator import generate_course_structure

router = APIRouter(prefix="/courses", tags=["courses"])


@router.post("/generate-structure", response_model=GenerateStructureResponse)
async def generate_structure(
    request: GenerateStructureRequest,
    _current_user: Annotated[User, Depends(require_roles(UserRole.teacher, UserRole.coordinator, UserRole.admin))],
):
    modules, clos = generate_course_structure(request)
    return GenerateStructureResponse(modules=modules, clos=clos)


@router.get("/protected", response_model=MessageResponse)
async def protected_courses_route(
    current_user: Annotated[User, Depends(require_roles(UserRole.student, UserRole.teacher, UserRole.admin))],
):
    return MessageResponse(message=f"Authenticated as {current_user.role.value}")
