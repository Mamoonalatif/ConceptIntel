import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status
from fastapi.responses import FileResponse
from fastapi import Response
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
    download_file_from_supabase,
    delete_file_from_supabase,
    upload_file_to_s3,
    download_file_from_s3,
    delete_file_from_s3,
    get_content_type
)
from app.rag.validation import validate_file_content
from app.courses.access import assert_course_access
from app.auth.routes import get_current_teacher, get_current_user


router = APIRouter(prefix="/files", tags=["Content Upload"])

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".ppt", ".txt"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def _store_file(content: bytes, filename: str, extension: str, course_id: int) -> str:
    """Storage backend priority: AWS S3 (if configured) > Supabase (if configured)
    > local disk. Returns a reference string whose scheme identifies where it lives
    ("s3://...", "supabase://..." - private bucket, never a public URL - or a plain
    local filesystem path)."""
    content_type = get_content_type(extension)

    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY and settings.AWS_S3_BUCKET:
        try:
            return upload_file_to_s3(content, filename, content_type, course_id)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"S3 upload failed: {str(e)}")

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            return upload_file_to_supabase(content, filename, content_type, course_id)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Supabase upload failed: {str(e)}")

    # Local storage fallback
    upload_dir = settings.upload_path / str(course_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    destination = upload_dir / Path(filename).name
    try:
        with open(destination, "wb") as buffer:
            buffer.write(content)
        return str(destination.resolve())
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to write file contents locally: {str(e)}")


def _delete_stored_file(file_url: str) -> None:
    """Mirror of _store_file's backend dispatch, for deletion."""
    if file_url.startswith("s3://"):
        delete_file_from_s3(file_url)
    elif file_url.startswith("supabase://"):
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


def process_uploaded_file_task(file_id: int):
    """Background task: extract text, run the RAG ingestion pipeline (clean, chunk,
    caption images, dedup, embed, store), then trigger the existing knowledge-graph
    concept extraction."""
    db: Session = SessionLocal()
    temp_filepath = None
    try:
        # Fetch file record
        file_record = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
        if not file_record:
            return

        # Update status to Processing
        file_record.status = "Processing"
        db.commit()

        file_url = file_record.file_url
        is_s3 = file_url.startswith("s3://")
        is_supabase = file_url.startswith("supabase://")

        if is_s3 or is_supabase:
            # Download to a temporary file. Kept around (not deleted immediately)
            # since the RAG pipeline's OCR fallback and image extraction also need
            # to read the original file.
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_record.file_type}") as tmp:
                temp_filepath = Path(tmp.name)
                if is_s3:
                    tmp.write(download_file_from_s3(file_url))
                else:
                    tmp.write(download_file_from_supabase(file_url))
            filepath = temp_filepath
        else:
            filepath = Path(file_url)

        extracted_text = extract_text_from_file(filepath, file_record.file_type)

        # Save text back to DB
        file_record.extracted_text = extracted_text
        file_record.status = "Completed"
        db.commit()

        # RAG ingestion: clean -> OCR fallback -> chunk -> caption images -> dedup
        # -> embed -> store. Best-effort - a failure here doesn't roll back the
        # successful text extraction above (the file stays usable, just without
        # semantic search over it), so it's wrapped separately.
        try:
            from app.rag.pipeline import process_file_for_rag
            course = db.query(Course).filter(Course.id == file_record.course_id).first()
            chunk_count = process_file_for_rag(
                db=db,
                course_id=file_record.course_id,
                file_id=file_record.id,
                course_name=course.name if course else "this course",
                file_name=file_record.filename,
                raw_text=extracted_text,
                file_type=file_record.file_type,
                filepath=filepath,
            )
            print(f"RAG pipeline stored {chunk_count} chunks for file ID {file_id}.")
        except Exception as e:
            print(f"RAG pipeline error for file ID {file_id} (text extraction still succeeded): {str(e)}")

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
        if temp_filepath is not None and temp_filepath.exists():
            temp_filepath.unlink()
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

    # Verify the file's actual content matches its claimed extension (magic-byte
    # sniffing) - a renamed/spoofed file is rejected here even though the extension
    # check above passed.
    try:
        validate_file_content(content, extension)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    safe_filename = file_path_obj.name
    file_type = extension.replace(".", "")

    # 3. Store file (S3 > Supabase > local, whichever is configured)
    file_url = _store_file(content, safe_filename, extension, course_id)

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


@router.get("/course/{course_id}/search")
def search_course_content(
    course_id: int,
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Semantic search over a course's uploaded material (text chunks + image
    captions). Returns only matches above the similarity threshold - an empty list
    means nothing relevant was found, which callers should surface as-is rather than
    forcing a low-confidence result into an AI prompt (see app/rag/retrieval.py)."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    assert_course_access(db, course, current_user)

    from app.rag.retrieval import retrieve
    return retrieve(db, course_id, q)


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
    assert_course_access(db, course, current_user)
    return db.query(UploadedFile).filter(UploadedFile.course_id == course_id).all()


@router.get("/{id}")
def download_file(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Download/view the file by ID, regardless of which storage backend it lives in."""
    file_record = db.query(UploadedFile).filter(UploadedFile.id == id).first()
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    course = db.query(Course).filter(Course.id == file_record.course_id).first()
    if course:
        assert_course_access(db, course, current_user)

    file_url = file_record.file_url

    if file_url.startswith("s3://"):
        # Bucket is private - stream the bytes through our own API rather than a
        # public URL, so access stays gated behind our auth.
        try:
            content = download_file_from_s3(file_url)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch file from S3: {str(e)}")
        return Response(
            content=content,
            media_type=get_content_type(f".{file_record.file_type}"),
            headers={"Content-Disposition": f'attachment; filename="{file_record.filename}"'},
        )

    if file_url.startswith("supabase://"):
        # Bucket is private - same authenticated-streaming approach as S3.
        try:
            content = download_file_from_supabase(file_url)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch file from Supabase: {str(e)}")
        return Response(
            content=content,
            media_type=get_content_type(f".{file_record.file_type}"),
            headers={"Content-Disposition": f'attachment; filename="{file_record.filename}"'},
        )

    filepath = Path(file_url)
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

    _delete_stored_file(file_record.file_url)

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

    # Verify the file's actual content matches its claimed extension (magic-byte
    # sniffing) - a renamed/spoofed file is rejected here even though the extension
    # check above passed.
    try:
        validate_file_content(content, extension)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # 3. Delete old file from storage
    _delete_stored_file(file_record.file_url)

    # 4. Save new file to storage (S3 > Supabase > local, whichever is configured)
    safe_filename = file_path_obj.name
    file_type = extension.replace(".", "")
    new_url = _store_file(content, safe_filename, extension, file_record.course_id)

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
