from pydantic import BaseModel
from datetime import datetime

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
    created_at: datetime

    class Config:
        from_attributes = True
