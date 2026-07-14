import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
from pathlib import Path

from app.config import settings
from app.database.connection import get_db, SessionLocal
from app.database.models import UploadedFile, Course, User
from app.upload.schemas import UploadedFileResponse
from app.upload.services import (
    extract_text_from_file,
    upload_file_to_supabase,
    delete_file_from_supabase,
    get_content_type
)
from app.auth.routes import get_current_teacher, get_current_user


router = APIRouter(prefix="/files", tags=["Content Upload"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".ppt", ".txt"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def process_uploaded_file_task(file_id: int):
    """Background task to extract text and trigger AI pipeline."""
    db: Session = SessionLocal()
    try:
        # Fetch file record
        file_record = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
        if not file_record:
            return

        # Update status to Processing
        file_record.status = "Processing"
        db.commit()

        file_url = file_record.file_url
        is_url = file_url.startswith("http://") or file_url.startswith("https://")

        if is_url:
            # Download file from Supabase Storage to a temporary file
            import tempfile
            import httpx
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_record.file_type}") as tmp:
                temp_filepath = Path(tmp.name)
                with httpx.Client() as client:
                    resp = client.get(file_url, timeout=60.0)
                    resp.raise_for_status()
                    tmp.write(resp.content)
            
            try:
                extracted_text = extract_text_from_file(temp_filepath, file_record.file_type)
            finally:
                if temp_filepath.exists():
                    temp_filepath.unlink()
        else:
            filepath = Path(file_url)
            extracted_text = extract_text_from_file(filepath, file_record.file_type)
        
        # Save text back to DB
        file_record.extracted_text = extracted_text
        file_record.status = "Completed"
        db.commit()
        
        # Trigger Concept Extraction AI pipeline (implemented in knowledge_graph)
        from app.knowledge_graph.services import trigger_concept_extraction
        trigger_concept_extraction(file_record.course_id, extracted_text)

    except Exception as e:
        db.rollback()
        # Find record again to update status to Failed
        file_record = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
        if file_record:
            file_record.status = "Failed"
            db.commit()
        print(f"Background parsing error for file ID {file_id}: {str(e)}")
    finally:
        db.close()


@router.post("/upload/{course_id}", response_model=UploadedFileResponse, status_code=status.HTTP_201_CREATED)
def upload_file(
    course_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    # 1. Validate course exists and teacher owns it
    course = db.query(Course).filter(Course.id == course_id, Course.teacher_id == current_teacher.id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or you are not the instructor."
        )

    # 2. Validate file extension
    file_path_obj = Path(file.filename)
    extension = file_path_obj.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    # Read content to check size and upload
    try:
        content = file.file.read()
        file_size = len(content)
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File exceeds maximum size limit of {MAX_FILE_SIZE / 1024 / 1024}MB."
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file contents: {str(e)}"
        )

    safe_filename = file_path_obj.name
    file_type = extension.replace(".", "")
    file_url = ""

    # 3. Store file (Supabase if credentials exist, else local)
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            content_type = get_content_type(extension)
            file_url = upload_file_to_supabase(content, safe_filename, content_type, course_id)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Supabase upload failed: {str(e)}"
            )
    else:
        # Local storage fallback
        upload_dir = settings.upload_path / str(course_id)
        upload_dir.mkdir(parents=True, exist_ok=True)
        destination = upload_dir / safe_filename
        try:
            with open(destination, "wb") as buffer:
                buffer.write(content)
            file_url = str(destination.resolve())
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to write file contents locally: {str(e)}"
            )

    # 4. Create metadata record
    new_file = UploadedFile(
        course_id=course_id,
        teacher_id=current_teacher.id,
        filename=safe_filename,
        file_url=file_url,
        file_type=file_type,
        file_size=file_size,
        status="Uploaded"
    )
    db.add(new_file)
    db.commit()
    db.refresh(new_file)

    # 5. Queue text parsing in background task
    background_tasks.add_task(process_uploaded_file_task, new_file.id)

    return new_file


@router.get("/course/{course_id}", response_model=List[UploadedFileResponse])
def list_course_files(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve metadata of all uploaded files for a course."""
    # Ensure course exists
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )
    return db.query(UploadedFile).filter(UploadedFile.course_id == course_id).all()


@router.get("/{id}")
def download_file(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Download/view the physical file by ID."""
    file_record = db.query(UploadedFile).filter(UploadedFile.id == id).first()
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    filepath = Path(file_record.file_url)
    if not filepath.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Physical file does not exist on disk."
        )
    
    return FileResponse(
        path=filepath, 
        filename=file_record.filename,
        media_type="application/octet-stream"
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(
    id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Delete document and metadata."""
    file_record = db.query(UploadedFile).filter(UploadedFile.id == id).first()
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File metadata not found"
        )
        
    # Check permissions
    if file_record.teacher_id != current_teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this file."
        )

    # Delete physical file from disk or Supabase
    file_url = file_record.file_url
    is_url = file_url.startswith("http://") or file_url.startswith("https://")
    if is_url:
        try:
            delete_file_from_supabase(file_url)
        except Exception as e:
            print(f"Warning: Failed to delete file from Supabase storage: {str(e)}")
    else:
        filepath = Path(file_url)
        if filepath.exists():
            try:
                filepath.unlink()
            except Exception as e:
                print(f"Warning: Failed to delete physical file {filepath}: {str(e)}")

    db.delete(file_record)
    db.commit()
    return None


@router.put("/{id}", response_model=UploadedFileResponse)
def replace_file(
    id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Replace an existing file with a new file."""
    # 1. Fetch existing file record
    file_record = db.query(UploadedFile).filter(UploadedFile.id == id).first()
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
        
    # Check permissions
    if file_record.teacher_id != current_teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this file."
        )

    # 2. Validate new file extension
    file_path_obj = Path(file.filename)
    extension = file_path_obj.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    # Read content to check size and upload
    try:
        content = file.file.read()
        file_size = len(content)
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File exceeds maximum size limit of {MAX_FILE_SIZE / 1024 / 1024}MB."
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file contents: {str(e)}"
        )

    # 3. Delete old file from storage
    old_file_url = file_record.file_url
    if old_file_url.startswith("http://") or old_file_url.startswith("https://"):
        try:
            delete_file_from_supabase(old_file_url)
        except Exception as e:
            print(f"Warning: Failed to delete old file from Supabase: {str(e)}")
    else:
        filepath = Path(old_file_url)
        if filepath.exists():
            try:
                filepath.unlink()
            except Exception as e:
                print(f"Warning: Failed to delete old physical file {filepath}: {str(e)}")

    # 4. Save new file to storage (Supabase if configured, else local fallback)
    safe_filename = file_path_obj.name
    file_type = extension.replace(".", "")
    new_url = ""

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            content_type = get_content_type(extension)
            new_url = upload_file_to_supabase(content, safe_filename, content_type, file_record.course_id)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to upload to Supabase: {str(e)}"
            )
    else:
        # Local storage fallback
        upload_dir = settings.upload_path / str(file_record.course_id)
        upload_dir.mkdir(parents=True, exist_ok=True)
        destination = upload_dir / safe_filename
        try:
            with open(destination, "wb") as buffer:
                buffer.write(content)
            new_url = str(destination.resolve())
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to write file contents locally: {str(e)}"
            )

    # 5. Update metadata record
    file_record.filename = safe_filename
    file_record.file_url = new_url
    file_record.file_type = file_type
    file_record.file_size = file_size
    file_record.status = "Uploaded"
    file_record.extracted_text = None  # Reset extracted text
    
    db.commit()
    db.refresh(file_record)

    # 6. Queue text parsing in background task
    background_tasks.add_task(process_uploaded_file_task, file_record.id)

    return file_record


@router.post("/{id}/process", response_model=UploadedFileResponse)
def reprocess_file(
    id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher)
):
    """Manually re-trigger file parsing and concept extraction."""
    file_record = db.query(UploadedFile).filter(UploadedFile.id == id, UploadedFile.teacher_id == current_teacher.id).first()
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or you are not the owner."
        )
    
    file_record.status = "Uploaded"
    db.commit()
    
    background_tasks.add_task(process_uploaded_file_task, file_record.id)
    return file_record
