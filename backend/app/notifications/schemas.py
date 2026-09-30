# Pydantic models for the notification API responses.
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


# One notification as shown in the bell dropdown.
class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    message: str
    link: Optional[str] = None
    priority: str
    is_read: bool
    created_at: datetime
    read_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# A page of notifications plus unread and total counts.
class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    unread_count: int
    total: int


# Just the unread count, for the badge.
class UnreadCountResponse(BaseModel):
    unread_count: int


# Number of notifications updated or deleted by a bulk action.
class BulkActionResponse(BaseModel):
    updated: int = 0
    deleted: int = 0
