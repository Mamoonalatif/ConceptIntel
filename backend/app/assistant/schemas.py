# Pydantic models for the assistant chat API.
from datetime import datetime
from pydantic import BaseModel, Field


# Incoming user message (1 to 4000 characters).
class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


# A stored chat message returned to the client.
class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True
