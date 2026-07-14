import re
import pypdf
import docx
import pptx
import httpx
from pathlib import Path
from app.config import settings


def extract_text_from_file(filepath: Path, file_type: str) -> str:
    """Extracts raw text content from PDF, DOCX, PPTX, or TXT file."""
    file_type = file_type.lower()
    text = ""
    
    if not filepath.exists():
        raise FileNotFoundError(f"File not found at path: {filepath}")

    if file_type == "pdf":
        reader = pypdf.PdfReader(filepath)
        for page in reader.pages:
            text += page.extract_text() or ""
        
    elif file_type == "docx":
        doc = docx.Document(filepath)
        text_list = []
        for paragraph in doc.paragraphs:
            if paragraph.text:
                text_list.append(paragraph.text)
        text = "\n".join(text_list)
        
    elif file_type in ("pptx", "ppt"):
        try:
            prs = pptx.Presentation(filepath)
            text_list = []
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text:
                        text_list.append(shape.text)
            text = "\n".join(text_list)
        except Exception as e:
            if file_type == "ppt":
                raise ValueError(
                    f"Unable to parse .ppt file. If it is an old binary .ppt format, "
                    f"please convert it to .pptx before uploading. Error: {str(e)}"
                )
            raise ValueError(f"Failed to parse PowerPoint slides: {str(e)}")

        
    elif file_type == "txt":
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
            
    else:
        raise ValueError(f"Unsupported file type: {file_type}")
        
    return clean_extracted_text(text)


def clean_extracted_text(text: str) -> str:
    """Cleans extracted text by removing redundant spacing and formatting."""
    # Replace multiple spaces with a single space
    text = re.sub(r"[ \t]+", " ", text)
    # Replace three or more newlines with double newline
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove control characters
    text = "".join(ch for ch in text if ch.isprintable() or ch in "\n\r\t")
    return text.strip()


def chunk_text(text: str, chunk_size: int = 3000, overlap: int = 300) -> list[str]:
    """Splits a long string of text into smaller overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


def get_content_type(extension: str) -> str:
    """Returns the MIME content type based on file extension."""
    ext = extension.lower()
    if ext == ".pdf":
        return "application/pdf"
    elif ext == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == ".pptx":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    elif ext == ".ppt":
        return "application/vnd.ms-powerpoint"
    elif ext == ".txt":
        return "text/plain"
    return "application/octet-stream"


def upload_file_to_supabase(file_content: bytes, filename: str, content_type: str, course_id: int) -> str:
    """
    Uploads a file to Supabase Storage and returns the public URL.
    If Supabase settings are missing, raises a ValueError.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise ValueError("Supabase URL and Key are not configured.")

    bucket = settings.SUPABASE_BUCKET
    # Clean the filename
    safe_filename = Path(filename).name
    file_path = f"course_{course_id}/{safe_filename}"

    # Supabase storage REST API upload endpoint
    url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{file_path}"

    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "apikey": settings.SUPABASE_KEY,
        "Content-Type": content_type,
        "x-upsert": "true"  # Overwrite if it already exists
    }

    with httpx.Client() as client:
        response = client.post(url, content=file_content, headers=headers, timeout=30.0)

    if response.status_code not in (200, 201):
        raise Exception(f"Supabase storage upload failed with status {response.status_code}: {response.text}")

    # Return standard public URL for the file
    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{file_path}"


def delete_file_from_supabase(file_url: str) -> None:
    """
    Deletes a file from Supabase Storage given its public URL.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return

    bucket = settings.SUPABASE_BUCKET
    prefix = f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/"
    if not file_url.startswith(prefix):
        return

    # Extract the file path relative to the bucket
    file_path = file_url[len(prefix):]
    url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{file_path}"

    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "apikey": settings.SUPABASE_KEY
    }

    with httpx.Client() as client:
        response = client.delete(url, headers=headers, timeout=15.0)

    if response.status_code not in (200, 204):
        # Log a warning to stdout/stderr
        print(f"Warning: Failed to delete file from Supabase Storage: {response.status_code} - {response.text}")

