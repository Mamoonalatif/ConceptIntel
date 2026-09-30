# Pydantic response model for an uploaded course file and its processing status.
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

# File metadata returned to clients: storage info, text-extraction status (status/used_ocr)
# and RAG ingestion status (rag_status/rag_error).
class UploadedFileResponse(BaseModel):
    id: int
    course_id: int
    teacher_id: int
    filename: str
    file_url: str
    file_type: str
    file_size: int
    status: str
    used_ocr: bool = False
    # "material" (chunked + embedded for retrieval) or "outline" (never embedded -
    # passed to the model as structured scope context instead). See
    # app/rag/pipeline.py. Defaulted so responses built from pre-migration rows
    # still validate.
    material_kind: str = "material"
    # Whether RAG ingestion (chunk/embed) actually succeeded - distinct from `status`
    # above, which only reflects text extraction. See app/upload/routes.py -
    # process_uploaded_file_task. Defaulted so responses from pre-migration rows
    # still validate.
    rag_status: str = "Pending"
    rag_error: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
