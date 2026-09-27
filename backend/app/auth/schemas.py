import re
from pydantic import BaseModel, EmailStr, field_validator
from typing import List, Optional

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


class ChangePasswordRequest(BaseModel):
    """current_password is optional only because a Google-only account (no password
    set yet) is allowed to set its first password without proving one it never had -
    see auth/routes.py change_password."""
    current_password: Optional[str] = None
    new_password: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, v: str) -> str:
        return validate_password_strength(v)


class GoogleAuthRequest(BaseModel):
    """ID token returned by Google Identity Services on the frontend, verified server-side."""
    id_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_program_coordinator: bool = False
    is_course_coordinator: bool = False
    is_active: bool = True
    # Storage reference, not a directly-loadable URL - fetch the actual image via
    # GET /auth/users/{id}/avatar. Non-null just tells the frontend an avatar exists.
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class StaffMemberResponse(UserResponse):
    """Extends UserResponse for GET /auth/admin/staff with the coordinator's currently
    assigned scope, so the admin staff list can show it inline without a separate
    GET .../scope fetch per row. Only meaningful for program_coordinator/
    course_coordinator rows - None for teachers and for coordinators with no
    assignment yet. Since a coordinator is now scoped to exactly one program/course,
    each is a single name rather than a list."""
    program_name: Optional[str] = None
    course_name: Optional[str] = None


class UserStatusUpdate(BaseModel):
    """Admin-only payload to suspend/reactivate a user account."""
    is_active: bool


class UserAdminUpdate(BaseModel):
    """Admin-only payload to update any user's profile details."""
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class StaffRoleUpdate(BaseModel):
    """Admin-only payload to move an existing teacher/program-coordinator/
    course-coordinator account between those three roles. program_ids/course_ids are
    only meaningful when role is program_coordinator/course_coordinator respectively -
    they replace that user's entire scope in one transaction along with the role
    change (see auth/routes.py change_staff_role)."""
    role: str  # "teacher" | "program_coordinator" | "course_coordinator"
    program_ids: Optional[List[int]] = None
    course_ids: Optional[List[int]] = None

    @field_validator("role")
    @classmethod
    def check_role(cls, v: str) -> str:
        allowed = ("teacher", "program_coordinator", "course_coordinator")
        if v not in allowed:
            raise ValueError(f"role must be one of {allowed}")
        return v


class StaffAuthoritiesUpdate(BaseModel):
    """Admin-only payload to grant/revoke Program Coordinator and/or Course
    Coordinator authority FLAGS on an existing teacher account (see
    User.is_program_coordinator/is_course_coordinator). These stack on top of the
    teacher role and the role/scope-based system above (StaffRoleUpdate) rather than
    replacing it - a teacher given course_coordinator authority keeps every teacher
    capability (uploading, running their own courses) plus the coordinator ones. Omit
    a field to leave that authority unchanged; both can be true at once."""
    is_program_coordinator: Optional[bool] = None
    is_course_coordinator: Optional[bool] = None


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    role: str
    full_name: str
    # The full profile, so the frontend can populate its session from this one
    # response instead of a separate GET /auth/me round trip right after - that
    # second sequential request (each paying full network + remote-DB latency) was
    # adding a full extra leg to every login, most visible on Google sign-in where
    # it lands on top of the token-verification call. Optional only so older
    # callers/tests that construct a Token without it don't break.
    user: Optional[UserResponse] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str


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
