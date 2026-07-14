import re
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional

FULL_NAME_PATTERN = re.compile(r"^[A-Za-z]+(?: [A-Za-z]+)*$")
SPECIAL_CHARS = "!@#$%^&*"


def validate_full_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Full name is required")
    if not FULL_NAME_PATTERN.match(value):
        raise ValueError("Full name must contain letters and spaces only (no digits or symbols)")
    return value


def validate_password_strength(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[A-Z]", value):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", value):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"[0-9]", value):
        raise ValueError("Password must contain at least one digit")
    if not any(ch in SPECIAL_CHARS for ch in value):
        raise ValueError(f"Password must contain at least one special character ({SPECIAL_CHARS})")
    return value


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str  # "student" (self-registration is student-only; see auth/routes.py)

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool = True

    class Config:
        from_attributes = True


class UserStatusUpdate(BaseModel):
    """Admin-only payload to suspend/reactivate a user account."""
    is_active: bool


class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    full_name: str


class TokenData(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = None
    role: Optional[str] = None


# --- Teacher provisioning ---

class AdminCreateTeacher(BaseModel):
    email: EmailStr
    full_name: str

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)


class TeacherCredentialsResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    temporary_password: str


class TeacherRequestCreate(BaseModel):
    email: EmailStr
    full_name: str
    reason: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)


class TeacherRequestResponse(BaseModel):
    id: int
    email: str
    full_name: str
    reason: Optional[str] = None
    status: str

    class Config:
        from_attributes = True
