# Pydantic request/response models and validators for the auth routes.
import re
from email_validator import validate_email, EmailNotValidError
from pydantic import BaseModel, EmailStr, field_validator
from typing import List, Optional

FULL_NAME_PATTERN = re.compile(r"^[A-Za-z]+(?: [A-Za-z]+)*$")
SPECIAL_CHARS = "!@#$%^&*"


def validate_deliverable_email(value: str) -> str:
    """EmailStr alone only checks that an address is shaped like an email - it
    happily accepts foo@this-domain-does-not-exist-xyz.com. This additionally
    resolves the domain's mail (MX, falling back to A/AAAA) records, so a
    registration/account-email with a non-existent or non-mail-capable domain is
    rejected with a clear error instead of silently creating an account nobody can
    ever receive mail at. Only used where a NEW email is being supplied (registration,
    admin-provisioned accounts, editing a user's email) - not on login/forgot-password,
    where the address was already accepted at registration time and a transient DNS
    hiccup should never be able to lock an existing user out."""
    try:
        result = validate_email(value, check_deliverability=True)
    except EmailNotValidError as e:
        raise ValueError(str(e))
    return result.normalized


def validate_full_name(value: str) -> str:
    """Trim the name and require letters and single spaces only."""
    value = value.strip()
    if not value:
        raise ValueError("Full name is required")
    if not FULL_NAME_PATTERN.match(value):
        raise ValueError("Full name must contain letters and spaces only (no digits or symbols)")
    return value


def validate_password_strength(value: str) -> str:
    """Enforce the password policy: 8+ chars with upper, lower, digit and special character."""
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
    """Self-registration payload (students only); validators enforce email, name and password rules."""
    email: EmailStr
    password: str
    full_name: str
    role: str  # "student" (self-registration is student-only; see auth/routes.py)

    @field_validator("email")
    @classmethod
    def check_email_deliverable(cls, v: str) -> str:
        return validate_deliverable_email(v)

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserLogin(BaseModel):
    """Email + password login payload."""
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


class VerifyEmailRequest(BaseModel):
    """Email verification by the token in the emailed link."""
    token: str


class VerifyEmailCodeRequest(BaseModel):
    """Email verification by the short code typed in by the user."""
    email: EmailStr
    code: str


class ResendVerificationRequest(BaseModel):
    """Ask for the verification email to be sent again."""
    email: EmailStr


class GoogleAuthRequest(BaseModel):
    """ID token returned by Google Identity Services on the frontend, verified server-side."""
    id_token: str


class ForgotPasswordRequest(BaseModel):
    """Start a password reset for this email."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Finish a password reset: reset token plus the new (validated) password."""
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, v: str) -> str:
        return validate_password_strength(v)


class UserResponse(BaseModel):
    """Public user profile returned by the API (never includes password data)."""
    id: int
    email: str
    full_name: str
    role: str
    is_program_coordinator: bool = False
    is_course_coordinator: bool = False
    is_active: bool = True
    is_verified: bool = True
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

    @field_validator("email")
    @classmethod
    def check_email_deliverable(cls, v: Optional[str]) -> Optional[str]:
        return validate_deliverable_email(v) if v else v


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
    """Login response: access/refresh tokens, role and (optionally) the full profile."""
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
    """Payload to exchange a refresh token for a new access token."""
    refresh_token: str


class RefreshResponse(BaseModel):
    """New access token returned from the refresh endpoint."""
    access_token: str
    token_type: str


class TokenData(BaseModel):
    """Fields decoded from a JWT payload."""
    user_id: Optional[int] = None
    email: Optional[str] = None
    role: Optional[str] = None


# --- Two-factor authentication (TOTP) ---

class TwoFactorRequiredResponse(BaseModel):
    """Returned by POST /auth/login IN PLACE OF Token when the account has 2FA
    enabled - the password was correct, but no access/refresh token is issued yet.
    temp_token proves that much to POST /auth/2fa/verify-login without granting any
    API access itself (see auth/utils.py create_two_factor_pending_token)."""
    requires_2fa: bool = True
    temp_token: str


class TwoFactorLoginVerify(BaseModel):
    """Completes a 2FA login: the temp_token from TwoFactorRequiredResponse plus
    either a 6-digit authenticator code or an unused backup code."""
    temp_token: str
    code: str


class TwoFactorSetupResponse(BaseModel):
    """A pending (not yet confirmed) TOTP secret for the current user, plus what the
    frontend needs to render the QR code an authenticator app scans. 2FA is NOT
    enabled yet - see auth/routes.py two_factor_setup docstring."""
    secret: str
    otpauth_uri: str
    qr_code_base64: str  # PNG, base64-encoded, no data: prefix


class TwoFactorEnableRequest(BaseModel):
    """Confirms setup by proving the user's authenticator app actually produces
    valid codes for the pending secret."""
    code: str


class TwoFactorEnableResponse(BaseModel):
    """Backup codes are only ever shown once, right here, at enable time - the
    server never stores or displays the raw values again (see
    auth/utils.py generate_backup_codes)."""
    backup_codes: List[str]


class TwoFactorDisableRequest(BaseModel):
    """Disabling 2FA requires re-proving the account is genuinely under this
    caller's control: either the current password, or a currently-valid TOTP/backup
    code. Exactly one should be supplied."""
    password: Optional[str] = None
    code: Optional[str] = None


class TwoFactorStatusResponse(BaseModel):
    """Whether 2FA is currently enabled for the user."""
    is_2fa_enabled: bool


# --- Teacher provisioning ---

class AdminCreateTeacher(BaseModel):
    """Admin payload to create a teacher account (a temporary password is generated)."""
    email: EmailStr
    full_name: str

    @field_validator("email")
    @classmethod
    def check_email_deliverable(cls, v: str) -> str:
        return validate_deliverable_email(v)

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)


class TeacherCredentialsResponse(BaseModel):
    """Returned after teacher creation, including the generated temporary password."""
    id: int
    email: str
    full_name: str
    role: str
    temporary_password: str


class TeacherRequestCreate(BaseModel):
    """Public request asking the admin to create a teacher account."""
    email: EmailStr
    full_name: str
    reason: Optional[str] = None

    @field_validator("email")
    @classmethod
    def check_email_deliverable(cls, v: str) -> str:
        return validate_deliverable_email(v)

    @field_validator("full_name")
    @classmethod
    def check_full_name(cls, v: str) -> str:
        return validate_full_name(v)


class TeacherRequestResponse(BaseModel):
    """A teacher-account request and its review status."""
    id: int
    email: str
    full_name: str
    reason: Optional[str] = None
    status: str

    class Config:
        from_attributes = True
