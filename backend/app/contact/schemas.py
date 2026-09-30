# Pydantic models for the public contact form.
from pydantic import BaseModel, EmailStr, Field


# Contact form input: name, a validated email address and the message text.
class ContactMessageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    message: str = Field(..., min_length=1, max_length=5000)


# Simple success flag plus a human-readable detail string.
class ContactMessageResponse(BaseModel):
    success: bool
    detail: str
