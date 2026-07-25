from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import Material, Course, User
from app.materials.schemas import MaterialResponse, MaterialUpdate
from app.auth.routes import get_current_user, get_current_teacher
from app.courses.access import assert_course_access
from app.upload.services import store_file, download_stored_file, delete_stored_file, get_content_type
from app.notifications.service import notify_course_students
from app.notifications.types import NotificationType
from app.notifications.ai_summary import generate_posting_summary

router = APIRouter(prefix="/courses", tags=["Materials"])

# Materials are reference resources, not submittable coursework, so the accepted
# formats lean toward slides/readings/media rather than assignment deliverables -
# mirrors assignments/routes.py's SUPPORTED_EXTENSIONS pattern.
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".txt", ".zip", ".jpg", ".jpeg", ".png", ".mp4", ".mp3"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _read_and_validate_upload(file: UploadFile) -> tuple[bytes, str, str]:
    extension = Path(file.filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )
    content = file.file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 25MB size limit.")
    return content, extension, Path(file.filename).name


def _to_response(m: Material) -> MaterialResponse:
    return MaterialResponse(
        id=m.id,
        course_id=m.course_id,
        teacher_id=m.teacher_id,
        teacher_name=m.teacher.full_name if m.teacher else None,
        title=m.title,
        description=m.description,
        attachment_filename=m.attachment_filename,
        external_link=m.external_link,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("/{course_id}/materials", response_model=List[MaterialResponse])
def list_materials(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Newest-first list of a course's posted materials - same visibility rule as
    the rest of the class stream content (see assert_course_access)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    materials = (
        db.query(Material)
        .filter(Material.course_id == course_id)
        .order_by(Material.created_at.desc())
        .all()
    )
    return [_to_response(m) for m in materials]


@router.post("/{course_id}/materials", response_model=MaterialResponse, status_code=status.HTTP_201_CREATED)
def create_material(
    course_id: int,
    title: str = Form(...),
    description: Optional[str] = Form(None),
    external_link: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    course = _get_course_or_404(db, course_id)
    if course.teacher_id != current_teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course.")

    attachment_url = None
    attachment_filename = None
    if file is not None and file.filename:
        content, extension, safe_filename = _read_and_validate_upload(file)
        attachment_url = store_file(content, safe_filename, extension, f"materials/{course_id}")
        attachment_filename = safe_filename

    material = Material(
        course_id=course_id, teacher_id=current_teacher.id, title=title, description=description,
        attachment_url=attachment_url, attachment_filename=attachment_filename, external_link=external_link,
    )
    db.add(material)
    db.commit()
    db.refresh(material)

    try:
        content = f"Posted in {course.name}. {description or ''}".strip()
        summary = generate_posting_summary("material", title, content)
        notify_course_students(
            db, course_id, NotificationType.MATERIAL_POSTED,
            title=f"New material: {title}",
            message=summary,
            link=f"/course/{course_id}",
        )
    except Exception as e:
        print(f"Warning: failed to create material notifications: {str(e)}")

    return _to_response(material)


def _get_owned_material(db: Session, course_id: int, material_id: int, teacher_id: int) -> Material:
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.course_id == course_id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    if material.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own materials.")
    return material


@router.patch("/{course_id}/materials/{material_id}", response_model=MaterialResponse)
def update_material(
    course_id: int,
    material_id: int,
    payload: MaterialUpdate,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    material = _get_owned_material(db, course_id, material_id, current_teacher.id)
    if payload.title is not None:
        material.title = payload.title
    if payload.description is not None:
        material.description = payload.description
    if payload.external_link is not None:
        material.external_link = payload.external_link
    material.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(material)
    return _to_response(material)


@router.delete("/{course_id}/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(
    course_id: int,
    material_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    material = _get_owned_material(db, course_id, material_id, current_teacher.id)
    if material.attachment_url:
        try:
            delete_stored_file(material.attachment_url)
        except Exception as e:
            print(f"Warning: failed to delete material attachment: {str(e)}")
    db.delete(material)
    db.commit()
    return None


@router.get("/{course_id}/materials/{material_id}/download")
def download_material_attachment(
    course_id: int,
    material_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    material = db.query(Material).filter(Material.id == material_id, Material.course_id == course_id).first()
    if not material or not material.attachment_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No attachment for this material")

    content = download_stored_file(material.attachment_url)
    content_type = get_content_type(Path(material.attachment_filename).suffix)
    return Response(
        content=content, media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{material.attachment_filename}"'},
    )
