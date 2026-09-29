import base64
import csv
import hashlib
import io
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Set, Union
import qrcode
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from app.config import settings
from app.email_service import send_staff_credentials_email, send_password_reset_email, send_verification_email
from app.database.connection import get_db, SessionLocal
from app.database.models import (
    User, TeacherRequest, Program, Course, CourseCatalog,
    ProgramCoordinatorAssignment, CourseCoordinatorAssignment,
    Assignment, AssignmentSubmission, Announcement, Material, Meeting,
    Comment, ChatMessage, NotificationPreference, PasswordResetToken,
    EmailVerificationToken,
)
from app.courses.services import delete_course_cascade
from app.auth.schemas import (
    UserCreate, UserLogin, UserResponse, Token, TokenData,
    AdminCreateTeacher, TeacherCredentialsResponse,
    TeacherRequestCreate, TeacherRequestResponse,
    UserStatusUpdate, UserAdminUpdate, GoogleAuthRequest, StaffRoleUpdate, ChangePasswordRequest,
    StaffMemberResponse, StaffAuthoritiesUpdate, ForgotPasswordRequest, ResetPasswordRequest,
    RefreshRequest, RefreshResponse,
    TwoFactorRequiredResponse, TwoFactorLoginVerify, TwoFactorSetupResponse,
    TwoFactorEnableRequest, TwoFactorEnableResponse, TwoFactorDisableRequest, TwoFactorStatusResponse,
    VerifyEmailRequest, ResendVerificationRequest,
)
from app.auth.utils import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_access_token, generate_temporary_password,
    create_two_factor_pending_token, generate_totp_secret, get_totp_uri, verify_totp_code,
    generate_backup_codes, consume_backup_code,
)
from app.supabase_auth import (
    is_supabase_auth_configured, create_supabase_user, verify_supabase_password,
    get_or_create_supabase_user_by_email, update_supabase_user_password, find_supabase_user_by_email,
)
from app.notifications.service import create_notification, notify_admins
from app.notifications.types import NotificationType
from app.upload.services import store_file, download_stored_file, delete_stored_file, get_content_type

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

class _CachedGoogleCertsRequest:
    """Wraps google.auth.transport.requests.Request() and caches its GET
    responses in-process for CACHE_SECONDS. google_id_token.verify_oauth2_token
    fetches Google's public signing certs over the network on every single call
    with no caching of its own - Google's certs endpoint rotates keys roughly
    daily, so re-fetching them on every login was adding a full network round
    trip (observed several seconds) to every Google sign-in for no benefit.
    Only ever used for that one certs URL in this app, so blanket-caching every
    GET this object makes is safe."""
    CACHE_SECONDS = 3600

    def __init__(self):
        self._inner = google_requests.Request()
        self._cache: dict = {}  # url -> (expires_at, response)

    def __call__(self, url, method="GET", body=None, headers=None, **kwargs):
        if method.upper() != "GET" or body is not None:
            return self._inner(url, method=method, body=body, headers=headers, **kwargs)
        cached = self._cache.get(url)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        response = self._inner(url, method=method, body=body, headers=headers, **kwargs)
        self._cache[url] = (time.monotonic() + self.CACHE_SECONDS, response)
        return response


_google_request_session = _CachedGoogleCertsRequest()


def _prewarm_google_certs_cache() -> None:
    """Fetches Google's OAuth certs once, eagerly, so the cache above is already
    warm before any real user signs in. Without this, the FIRST Google sign-in
    after every server start/reload (in dev, that is every code change) pays a
    real network round trip to googleapis.com fetching certs - synchronously,
    inside that user's login request - stacking on top of the same "first
    request after a restart" cold-start cost the DB keep-alive ping above exists
    to avoid. Runs in a background thread from the startup event so it never
    delays the app becoming ready to serve requests; best-effort, since a failure
    here just means the first real login fetches certs itself instead."""
    if not settings.GOOGLE_CLIENT_ID:
        return
    try:
        _google_request_session(google_id_token._GOOGLE_OAUTH2_CERTS_URL)
    except Exception as e:
        print(f"Warning: could not prewarm Google OAuth certs cache: {e}")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """FastAPI dependency to retrieve the currently logged-in user from the JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    email: str = payload.get("sub")
    role: str = payload.get("role")
    user_id: int = payload.get("user_id")

    if email is None or user_id is None:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    # A token minted before the account's token_version was last bumped (password
    # change/reset, POST /auth/logout-all) is treated as revoked, even though the
    # JWT signature itself is still valid and unexpired - see User.token_version.
    if payload.get("tv", 0) != user.token_version:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please contact support."
        )
    return user

def get_current_teacher(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the user to have the 'teacher' role."""
    if current_user.role.lower() != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Teacher role required."
        )
    return current_user

def get_current_student(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the user to have the 'student' role."""
    if current_user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Student role required."
        )
    return current_user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the user to have the 'admin' role."""
    if current_user.role.lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Admin role required."
        )
    return current_user


@dataclass
class ProgramScope:
    """Wraps a Program Coordinator (or admin) request with the set of Program ids they
    may act on. program_ids is None for an admin - meaning unrestricted/every program -
    and a (possibly empty) set for a program_coordinator, resolved from
    ProgramCoordinatorAssignment."""
    user: User
    program_ids: Optional[Set[int]]


@dataclass
class CourseScope:
    """Wraps a Course Coordinator (or admin) request with the set of catalog
    SUBJECT ids they may act on (not specific course sections - see
    CourseCoordinatorAssignment for why). catalog_ids is None for an admin -
    meaning unrestricted/every subject - and a (possibly empty) set otherwise,
    resolved from CourseCoordinatorAssignment."""
    user: User
    catalog_ids: Optional[Set[int]]


def resolve_program_ids(db: Session, user: User) -> Optional[Set[int]]:
    """None means unrestricted (admin). Otherwise the set of Program ids this user is
    assigned to via ProgramCoordinatorAssignment (possibly empty)."""
    if user.role.lower() == "admin":
        return None
    rows = db.query(ProgramCoordinatorAssignment.program_id).filter(
        ProgramCoordinatorAssignment.user_id == user.id
    ).all()
    return {row[0] for row in rows}


def resolve_catalog_ids(db: Session, user: User) -> Optional[Set[int]]:
    """None means unrestricted (admin). Otherwise the set of catalog SUBJECT ids
    this user is scoped to as Course Coordinator - the union of directly-assigned
    catalog rows (current model, assign_course_coordinator) and any legacy
    section-level rows (change_staff_role's older exclusive-role path, which
    predates catalog-based scoping and still records a course_id instead)."""
    if user.role.lower() == "admin":
        return None
    direct = {
        row[0] for row in db.query(CourseCoordinatorAssignment.catalog_id)
        .filter(CourseCoordinatorAssignment.user_id == user.id, CourseCoordinatorAssignment.catalog_id.isnot(None))
        .all()
    }
    via_legacy_course = {
        row[0] for row in db.query(Course.catalog_id)
        .join(CourseCoordinatorAssignment, CourseCoordinatorAssignment.course_id == Course.id)
        .filter(CourseCoordinatorAssignment.user_id == user.id, Course.catalog_id.isnot(None))
        .all()
    }
    return direct | via_legacy_course


def _is_program_coordinator(user: User) -> bool:
    """A user counts as Program Coordinator either via the role-based/scoped system
    (role == "program_coordinator", see StaffRoleUpdate/change_staff_role) or via the
    simpler additive authority flag (is_program_coordinator, see
    StaffAuthoritiesUpdate/update_staff_authorities) - the codebase grew both
    mechanisms and neither should silently stop working for accounts promoted through
    the other one."""
    return user.role.lower() == "program_coordinator" or bool(user.is_program_coordinator)


def _is_course_coordinator(user: User) -> bool:
    """See _is_program_coordinator - same dual role-flag compatibility for Course
    Coordinator."""
    return user.role.lower() == "course_coordinator" or bool(user.is_course_coordinator)


def get_current_program_coordinator(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProgramScope:
    """Program Coordinator duties: catalog CRUD, prerequisite mapping, course deletion,
    assigning Course Coordinators. Admin retains every course-management power too, so
    it's accepted alongside the dedicated role rather than replacing it - admin gets
    program_ids=None (unrestricted)."""
    if current_user.role.lower() != "admin" and not _is_program_coordinator(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Program Coordinator authority required."
        )
    return ProgramScope(user=current_user, program_ids=resolve_program_ids(db, current_user))


def get_current_course_coordinator(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CourseScope:
    """Course Coordinator duties: approve/reject a course's concept graph, update
    course info. Admin retains this power too - admin gets catalog_ids=None
    (unrestricted)."""
    if current_user.role.lower() != "admin" and not _is_course_coordinator(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Course Coordinator authority required."
        )
    return CourseScope(user=current_user, catalog_ids=resolve_catalog_ids(db, current_user))


def get_current_course_manager(current_user: User = Depends(get_current_user)) -> User:
    """Any role/authority that may update course info (admin / program coordinator /
    course coordinator, by role or by flag - see _is_program_coordinator /
    _is_course_coordinator). The route handler itself restricts catalog/prerequisite
    changes to admin/program_coordinator only."""
    if (
        current_user.role.lower() != "admin"
        and not _is_program_coordinator(current_user)
        and not _is_course_coordinator(current_user)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden."
        )
    return current_user


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Public self-registration is student-only. Teacher accounts are provisioned by an
    # admin (POST /auth/admin/teachers) or via an approved teacher request; admin accounts
    # are never created through a public endpoint (see backend/scripts/create_admin.py).
    role_lower = user_in.role.lower()
    if role_lower != "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Self-registration is only available for the 'student' role."
        )

    # Password is now owned by Supabase Auth, not stored/verified locally - create
    # the Supabase auth user first so we never end up with a local account that has
    # no way to authenticate (if this fails, nothing local has been created yet).
    supabase_uid = None
    if is_supabase_auth_configured():
        try:
            supabase_uid = create_supabase_user(user_in.email, user_in.password)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Could not create account (auth service error): {str(e)}"
            )

    new_user = User(
        email=user_in.email,
        # Legacy fallback only - if Supabase Auth isn't configured, keep the old
        # local bcrypt behavior so the app still works without it.
        hashed_password=None if supabase_uid else hash_password(user_in.password),
        full_name=user_in.full_name,
        role=role_lower,
        supabase_uid=supabase_uid,
        # is_verified defaults to False (see User model) - the address passed
        # validate_deliverable_email (its DOMAIN can receive mail) but nobody has
        # proven THIS caller owns the mailbox yet. _send_verification_email below
        # does that. Login is gated on this - see login().
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    _send_verification_email(db, new_user)
    return new_user


def _issue_tokens_for_user(user: User) -> dict:
    token_data = {
        "sub": user.email,
        "role": user.role,
        "user_id": user.id,
        # See User.token_version - lets every token minted for this login be
        # revoked later (password change/reset, POST /auth/logout-all) without
        # a server-side token/session table.
        "tv": user.token_version,
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": user.role,
        "full_name": user.full_name,
        "user": UserResponse.model_validate(user),
    }


@router.post("/login", response_model=Union[Token, TwoFactorRequiredResponse])
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Accounts linked to Supabase Auth (the norm going forward) are verified there;
    # legacy accounts created before this migration (no supabase_uid yet) still fall
    # back to the local bcrypt hash they were created with.
    if user.supabase_uid:
        password_ok = verify_supabase_password(credentials.email, credentials.password)
    else:
        password_ok = bool(user.hashed_password) and verify_password(credentials.password, user.hashed_password)

    if not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please contact support."
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address before signing in. Check your inbox for the verification link, or request a new one.",
        )

    # Password alone is not enough for a 2FA-enabled account: return a short-lived
    # pending token instead of real access/refresh tokens, and make the frontend
    # collect a code via POST /auth/2fa/verify-login before this login actually
    # completes.
    if user.is_2fa_enabled:
        return TwoFactorRequiredResponse(temp_token=create_two_factor_pending_token(user.id))

    return _issue_tokens_for_user(user)


@router.post("/2fa/verify-login", response_model=Token)
def two_factor_verify_login(payload: TwoFactorLoginVerify, db: Session = Depends(get_db)):
    """Completes a login for a 2FA-enabled account - exchanges the temp_token from
    /auth/login's TwoFactorRequiredResponse plus a code for real access/refresh
    tokens, the same shape a normal /auth/login returns."""
    decoded = decode_access_token(payload.temp_token)
    if decoded is None or decoded.get("type") != "2fa_pending":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This sign-in attempt has expired. Please sign in again.",
        )

    user = db.query(User).filter(User.id == decoded.get("user_id")).first()
    if user is None or not user.is_active or not user.is_2fa_enabled:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This sign-in attempt has expired. Please sign in again.",
        )

    if verify_totp_code(user.totp_secret, payload.code):
        return _issue_tokens_for_user(user)

    remaining = consume_backup_code(user.backup_codes_json, payload.code)
    if remaining is not None:
        user.backup_codes_json = remaining
        db.commit()
        return _issue_tokens_for_user(user)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code.")


@router.get("/2fa/status", response_model=TwoFactorStatusResponse)
def two_factor_status(current_user: User = Depends(get_current_user)):
    return TwoFactorStatusResponse(is_2fa_enabled=current_user.is_2fa_enabled)


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
def two_factor_setup(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Starts (or restarts) 2FA setup: generates a fresh pending TOTP secret and
    returns a scannable QR code. 2FA is NOT enabled by this call alone - the user
    must prove they can generate a valid code with POST /auth/2fa/enable first, so
    an account is never locked behind a code nobody can actually produce (e.g. the
    QR code was never scanned, or scanned into the wrong app)."""
    if current_user.is_2fa_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is already enabled.")

    secret = generate_totp_secret()
    current_user.totp_secret = secret
    db.commit()

    uri = get_totp_uri(secret, current_user.email)
    qr_img = qrcode.make(uri)
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return TwoFactorSetupResponse(secret=secret, otpauth_uri=uri, qr_code_base64=qr_base64)


@router.post("/2fa/enable", response_model=TwoFactorEnableResponse)
def two_factor_enable(
    payload: TwoFactorEnableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Confirms setup (see two_factor_setup) and actually turns 2FA on. Returns a
    fresh set of backup codes - shown to the user exactly once, here."""
    if current_user.is_2fa_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is already enabled.")
    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start setup first with POST /auth/2fa/setup.")
    if not verify_totp_code(current_user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code. Check your authenticator app and try again.")

    raw_codes, hashed_json = generate_backup_codes()
    current_user.is_2fa_enabled = True
    current_user.backup_codes_json = hashed_json
    db.commit()

    return TwoFactorEnableResponse(backup_codes=raw_codes)


@router.post("/2fa/disable")
def two_factor_disable(
    payload: TwoFactorDisableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Turns 2FA off. Requires re-proving control of the account - either the
    current password or a currently-valid code - so a hijacked, still-logged-in
    session token alone can't strip 2FA protection off an account."""
    if not current_user.is_2fa_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is not enabled.")

    verified = False
    if payload.code:
        verified = verify_totp_code(current_user.totp_secret, payload.code) or (
            consume_backup_code(current_user.backup_codes_json, payload.code) is not None
        )
    elif payload.password:
        if current_user.supabase_uid:
            verified = verify_supabase_password(current_user.email, payload.password)
        else:
            verified = bool(current_user.hashed_password) and verify_password(payload.password, current_user.hashed_password)

    if not verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not verify your password or authentication code.")

    current_user.is_2fa_enabled = False
    current_user.totp_secret = None
    current_user.backup_codes_json = None
    db.commit()

    return {"message": "Two-factor authentication has been disabled."}


def _link_supabase_user_background(user_id: int, email: str, full_name: str) -> None:
    """Runs off the request thread with its own DB session (the request's `db` is
    closed as soon as the response is sent, well before this would otherwise still
    be running) - see the call site in google_login for why this is backgrounded."""
    bg_db = SessionLocal()
    try:
        supabase_uid = get_or_create_supabase_user_by_email(email, full_name)
        user = bg_db.query(User).filter(User.id == user_id).first()
        if user:
            user.supabase_uid = supabase_uid
            bg_db.commit()
    except Exception as e:
        print(f"Warning: failed to link Supabase auth user for {email}: {e}")
    finally:
        bg_db.close()


@router.post("/google", response_model=Union[Token, TwoFactorRequiredResponse])
def google_login(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Sign in (or self-register as a student) using a Google ID token obtained by the
    frontend via Google Identity Services. Mirrors /register's rule that public
    self-registration is student-only - an existing teacher/admin can still link their
    account by signing in with Google using the same email, but a brand new Google
    sign-in always creates a student account."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured on this server.",
        )

    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token, _google_request_session, settings.GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google credential.",
        )

    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is missing or unverified.",
        )
    google_sub = claims["sub"]
    full_name = claims.get("name") or email.split("@")[0]

    # Case-insensitive lookup: Google's ID token returns the account's email in
    # whatever case it was originally registered with there, which does not
    # necessarily match the case an admin typed in when provisioning a
    # teacher/coordinator account locally (email delivery is case-insensitive,
    # so people don't treat case as meaningful). An exact-case match here would
    # silently miss the existing staff account and fall through to creating a
    # brand new "student" account for the same person instead.
    user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if user is None:
        user = User(
            email=email,
            hashed_password=None,
            full_name=full_name,
            role="student",
            google_id=google_sub,
            # Google's own ID token already asserted email_verified above - no
            # separate confirmation email needed for an account created this way.
            is_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.google_id is None:
        # First Google sign-in for an account that previously only had a password.
        # Google's ID token just proved this caller owns the mailbox, which also
        # satisfies email verification for an account that registered locally and
        # never clicked its confirmation link.
        user.google_id = google_sub
        user.is_verified = True
        db.commit()
        db.refresh(user)
    elif user.google_id != google_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This email is linked to a different Google account.",
        )

    # Link (or create) a matching Supabase auth user for identity consistency - no
    # password is set here, Google's own ID token is the credential. Best-effort:
    # a failure here shouldn't block sign-in, since our own JWT is still what
    # authorizes every subsequent request.
    #
    # This used to run synchronously, right here, before the JWT was returned -
    # up to two blocking HTTP round-trips to Supabase's Admin API (each with a 15s
    # timeout: find_supabase_user_by_email, then create_user if not found), on the
    # critical path of every Google sign-in for an account not yet linked. That is
    # exactly "why Google sign-in is slow": the user had already been authenticated
    # by Google's own id_token a moment earlier, but sat waiting on a side-effect
    # that only exists for internal identity-consistency bookkeeping. Dispatched to
    # a background thread instead (same pattern as the staff-credentials email
    # below) - the response returns the instant our own JWT is minted, and this
    # finishes linking a second or two later, invisibly.
    if is_supabase_auth_configured() and not user.supabase_uid:
        threading.Thread(target=_link_supabase_user_background, args=(user.id, email, full_name), daemon=True).start()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please contact support."
        )

    # Google's own ID token only proves the person controls that Google account -
    # it says nothing about whether THIS caller also knows the TOTP secret/backup
    # codes this account additionally protected itself with. Without this check, a
    # 2FA-enabled account (set up specifically to require a second factor) could be
    # fully signed into just by linking/using Google, silently bypassing the second
    # factor entirely. Same pending-token handshake as password login.
    if user.is_2fa_enabled:
        return TwoFactorRequiredResponse(temp_token=create_two_factor_pending_token(user.id))

    return _issue_tokens_for_user(user)


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/refresh", response_model=RefreshResponse)
def refresh_access_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    """Exchanges a refresh token (issued alongside the access token at login) for a
    fresh access token, so a session can outlive ACCESS_TOKEN_EXPIRE_MINUTES without
    the user having to type their password in again. The refresh token itself is
    NOT rotated - it stays valid until its own REFRESH_TOKEN_EXPIRE_DAYS expiry."""
    decoded = decode_access_token(payload.refresh_token)
    if decoded is None or decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == decoded.get("user_id")).first()
    if (
        user is None
        or not user.is_active
        or decoded.get("tv", 0) != user.token_version
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token({"sub": user.email, "role": user.role, "user_id": user.id, "tv": user.token_version})
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout-all")
def logout_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revokes every access/refresh token issued for this account so far - including
    the one used to call this endpoint - by bumping token_version (see
    User.token_version). The frontend should treat a 401 right after calling this
    as expected and clear its own stored tokens."""
    current_user.token_version += 1
    db.commit()
    return {"message": "You have been signed out of every device/session."}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Self-service password change for any authenticated user. If the account already
    has a password, current_password must match it. A Google-only account (no password
    yet) may set its first password without proving one it never had."""
    if current_user.supabase_uid:
        # Verify the current password via Supabase first (unless the account has none
        # yet, e.g. a Google-only sign-in setting its first password).
        current_password_matches = verify_supabase_password(current_user.email, payload.current_password or "")
        if not current_password_matches and payload.current_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
        try:
            update_supabase_user_password(current_user.supabase_uid, payload.new_password)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Could not update password: {str(e)}")
    else:
        # Legacy local-bcrypt account (pre-migration).
        if current_user.hashed_password:
            if not payload.current_password or not verify_password(payload.current_password, current_user.hashed_password):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
        current_user.hashed_password = hash_password(payload.new_password)

    # A password change is the standard "assume the old credential may be
    # compromised" moment - revoke every token issued under the old password so a
    # stolen access/refresh token stops working the instant the password changes,
    # not just up to whichever expiry it happened to carry (see User.token_version).
    current_user.token_version += 1
    db.commit()

    return {"message": "Password updated successfully."}


RESET_TOKEN_TTL = timedelta(minutes=30)


def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Requests a password-reset link. Always returns the same generic message
    regardless of whether the email exists - a distinct "no account found" response
    would let anyone enumerate registered emails one guess at a time."""
    generic_response = {
        "message": "If an account exists for that email, a password reset link has been sent."
    }
    user = db.query(User).filter(func.lower(User.email) == payload.email.lower()).first()
    if not user or not user.is_active:
        return generic_response

    raw_token = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=datetime.utcnow() + RESET_TOKEN_TTL,
    ))
    db.commit()

    frontend_url = (settings.FRONTEND_URL or "http://localhost:5173").rstrip("/")
    reset_link = f"{frontend_url}/reset-password?token={raw_token}"
    if not send_password_reset_email(user.email, user.full_name, reset_link):
        print(f"Warning: password reset requested for {user.email} but email delivery is not configured/failed.")

    return generic_response


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Completes a "forgot password" reset. The token is single-use (marked used_at
    on success) and time-limited (RESET_TOKEN_TTL) - both checked here rather than
    relying on the caller to have requested a fresh one."""
    token_hash = _hash_reset_token(payload.token)
    reset_token = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == token_hash)
        .order_by(PasswordResetToken.id.desc())
        .first()
    )
    if (
        not reset_token
        or reset_token.used_at is not None
        or reset_token.expires_at < datetime.utcnow()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link is invalid or has expired. Request a new one.",
        )

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired.")

    if user.supabase_uid:
        try:
            update_supabase_user_password(user.supabase_uid, payload.new_password)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Could not update password: {str(e)}")
    else:
        user.hashed_password = hash_password(payload.new_password)

    # A "forgot password" reset is exactly the scenario token_version revocation
    # exists for: if the account was reset because someone else's session/token was
    # compromised, that session must stop working the moment the legitimate owner
    # regains control - not linger until its own expiry (see User.token_version).
    user.token_version += 1
    reset_token.used_at = datetime.utcnow()
    db.commit()

    return {"message": "Password reset successfully. You can now sign in with your new password."}


# --- Email verification ---

VERIFICATION_TOKEN_TTL = timedelta(hours=24)


def _hash_verification_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _send_verification_email(db: Session, user: User) -> None:
    """Issues a fresh verification token and emails the confirmation link. Used by
    both register() and resend_verification() below. The token is created and
    committed synchronously (so it exists the instant this returns), but the actual
    SMTP send is dispatched to a background thread - same reasoning as
    _create_staff_account's credentials email: Gmail SMTP can hang, and there is no
    reason a slow/failed send should turn a successful registration into a timed-out
    request. Best-effort either way: if email delivery isn't configured, the account
    is simply left unverified until resend_verification/an admin intervenes."""
    raw_token = secrets.token_urlsafe(32)
    db.add(EmailVerificationToken(
        user_id=user.id,
        token_hash=_hash_verification_token(raw_token),
        expires_at=datetime.utcnow() + VERIFICATION_TOKEN_TTL,
    ))
    db.commit()

    frontend_url = (settings.FRONTEND_URL or "http://localhost:5173").rstrip("/")
    verify_link = f"{frontend_url}/verify-email?token={raw_token}"
    threading.Thread(
        target=send_verification_email,
        args=(user.email, user.full_name, verify_link),
        daemon=True,
    ).start()


@router.post("/verify-email")
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Completes email verification from the link sent at registration. Same
    single-use, time-limited token pattern as reset_password above."""
    token_hash = _hash_verification_token(payload.token)
    verification_token = (
        db.query(EmailVerificationToken)
        .filter(EmailVerificationToken.token_hash == token_hash)
        .order_by(EmailVerificationToken.id.desc())
        .first()
    )
    if (
        not verification_token
        or verification_token.used_at is not None
        or verification_token.expires_at < datetime.utcnow()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification link is invalid or has expired. Request a new one.",
        )

    user = db.query(User).filter(User.id == verification_token.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link is invalid or has expired.")

    user.is_verified = True
    verification_token.used_at = datetime.utcnow()
    db.commit()

    return {"message": "Your email has been verified. You can now sign in."}


@router.post("/resend-verification")
def resend_verification(payload: ResendVerificationRequest, db: Session = Depends(get_db)):
    """Same generic-response convention as forgot_password - doesn't reveal whether
    the address belongs to an account, or whether that account is already verified."""
    generic_response = {"message": "If an account exists for that email and isn't verified yet, a new verification link has been sent."}
    user = db.query(User).filter(func.lower(User.email) == payload.email.lower()).first()
    if not user or user.is_verified or not user.is_active:
        return generic_response

    _send_verification_email(db, user)
    return generic_response


# --- Avatar / profile photo upload ---
# Reuses the exact same storage dispatcher (S3 > Supabase > local disk) as course
# content uploads - see app/upload/services.py. No second storage mechanism.

AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/me/avatar", response_model=UserResponse)
def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload/replace the current user's profile photo. Any previously stored photo
    is deleted first, so a user never accumulates orphaned files in storage."""
    extension = Path(file.filename).suffix.lower()
    if extension not in AVATAR_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type. Supported formats: {', '.join(sorted(AVATAR_EXTENSIONS))}"
        )

    content = file.file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image exceeds the {MAX_AVATAR_SIZE // (1024 * 1024)}MB size limit."
        )

    if current_user.avatar_url:
        try:
            delete_stored_file(current_user.avatar_url)
        except Exception as e:
            print(f"Warning: failed to delete previous avatar for user {current_user.id}: {str(e)}")

    try:
        # A fresh, unique filename per upload (not the original filename) so
        # re-uploading a photo with the same name (e.g. "photo.jpg" every
        # time) always produces a new avatar_url - both so any storage-layer
        # CDN caching keyed on the object path can't serve a stale copy, and
        # so the frontend has a value that reliably changes to cache-bust its
        # own avatar fetch against.
        unique_name = f"{uuid.uuid4().hex}{extension}"
        new_url = store_file(content, unique_name, extension, f"avatars/{current_user.id}")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Avatar upload failed: {str(e)}")

    current_user.avatar_url = new_url
    db.commit()
    db.refresh(current_user)
    return current_user


@router.delete("/me/avatar", response_model=UserResponse)
def delete_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove the current user's profile photo (clears the field and deletes the
    stored file, whichever backend it lives in)."""
    if current_user.avatar_url:
        try:
            delete_stored_file(current_user.avatar_url)
        except Exception as e:
            print(f"Warning: failed to delete avatar file for user {current_user.id}: {str(e)}")
        current_user.avatar_url = None
        db.commit()
        db.refresh(current_user)
    return current_user


@router.get("/users/{user_id}/avatar")
def get_user_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve a user's profile photo bytes, regardless of storage backend - same
    authenticated-streaming approach as course file/material downloads (see
    app/upload/routes.py), since avatar_url is a private storage reference, not a
    public URL."""
    no_cache_headers = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.avatar_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No avatar for this user", headers=no_cache_headers)

    try:
        content = download_stored_file(user.avatar_url)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch avatar: {str(e)}", headers=no_cache_headers)

    extension = Path(user.avatar_url).suffix or ".jpg"
    # Never let the browser (or any intermediary) cache this response - a
    # replaced/removed photo must show up immediately, not after whatever
    # heuristic freshness lifetime the browser assigns to an unlabeled
    # response on this same URL.
    return Response(content=content, media_type=get_content_type(extension), headers=no_cache_headers)


# --- Teacher provisioning: request access (public) ---

@router.post("/teacher-requests", response_model=TeacherRequestResponse, status_code=status.HTTP_201_CREATED)
def submit_teacher_request(request_in: TeacherRequestCreate, db: Session = Depends(get_db)):
    """Public endpoint for a prospective teacher to request an account."""
    existing_user = db.query(User).filter(User.email == request_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists"
        )

    new_request = TeacherRequest(
        email=request_in.email,
        full_name=request_in.full_name,
        reason=request_in.reason,
        status="pending"
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    try:
        # notify_admins already sends each admin an email in a background thread
        # (see notifications/service.py notify_many -> _dispatch_email_async) - a
        # second, synchronous send_notification_email loop used to run here too,
        # blocking this request on Gmail SMTP once per admin (measured ~14s with
        # just 2-3 admins) for emails that were about to be sent anyway.
        notify_admins(
            db, NotificationType.TEACHER_REQUEST_SUBMITTED,
            title="New teacher access request",
            message=f"{new_request.full_name} ({new_request.email}) requested a teacher account.",
            link="/admin",
        )
    except Exception as e:
        print(f"Warning: failed to notify admins of teacher request: {str(e)}")

    return new_request


# --- Admin: staff provisioning (teacher, program coordinator, course coordinator) ---

def _create_staff_account(db: Session, email: str, full_name: str, role: str) -> TeacherCredentialsResponse:
    """Admin-provisioned account with a generated temporary password. Used for every
    staff role admin creates directly (teacher, program coordinator, course coordinator) -
    there is no public self-registration path for any of these."""
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    temp_password = generate_temporary_password()

    supabase_uid = None
    if is_supabase_auth_configured():
        try:
            supabase_uid = create_supabase_user(email, temp_password)
        except Exception as e:
            # Supabase Auth can already have a user for this email with no
            # matching row in our own `users` table - e.g. after a data reset
            # that only wiped this app's Postgres tables (Supabase Auth is a
            # separate store, untouched by that). Rather than failing outright,
            # reuse that orphaned Supabase account and reset its password so
            # provisioning still succeeds instead of requiring manual cleanup.
            if "email_exists" in str(e):
                supabase_uid = find_supabase_user_by_email(email)
                if supabase_uid:
                    update_supabase_user_password(supabase_uid, temp_password)
                else:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=f"Could not create account (auth service error): {str(e)}"
                    )
            else:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Could not create account (auth service error): {str(e)}"
                )

    new_user = User(
        email=email,
        hashed_password=None if supabase_uid else hash_password(temp_password),
        full_name=full_name,
        role=role,
        supabase_uid=supabase_uid,
        # Admin-provisioned, not self-registered - the admin already vouches for
        # this address (and it already passed validate_deliverable_email), so there
        # is no separate "prove you own this mailbox" step to gate login behind.
        is_verified=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Best-effort email delivery, genuinely so: the temporary password is still
    # returned in the response either way, so the admin can relay it manually if
    # email isn't configured or delivery fails. This used to call
    # send_staff_credentials_email directly and synchronously with no try/except -
    # a slow/failed SMTP send (Gmail SMTP can hang) would raise past this point and
    # fail the whole request with a 500, even though the account had already been
    # fully created and committed a moment earlier. Dispatched in a background
    # thread instead, same pattern as notifications/service.py's email dispatch.
    threading.Thread(
        target=send_staff_credentials_email,
        args=(new_user.email, new_user.full_name, role.replace("_", " ").title(), temp_password),
        daemon=True,
    ).start()

    return TeacherCredentialsResponse(
        id=new_user.id,
        email=new_user.email,
        full_name=new_user.full_name,
        role=new_user.role,
        temporary_password=temp_password,
    )


@router.post("/admin/teachers", response_model=TeacherCredentialsResponse, status_code=status.HTTP_201_CREATED)
def admin_create_teacher(
    teacher_in: AdminCreateTeacher,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Admin directly creates a teacher account with a generated temporary password.
    There is no email service wired up, so the credentials are returned in the response
    for the admin to relay to the teacher out-of-band."""
    return _create_staff_account(db, teacher_in.email, teacher_in.full_name, "teacher")


PROMOTABLE_ROLES = ("teacher", "program_coordinator", "course_coordinator")


@router.get("/coordinator/eligible-users", response_model=List[UserResponse])
def list_coordinator_eligible_users(
    db: Session = Depends(get_db),
    current_user: ProgramScope = Depends(get_current_program_coordinator),
):
    """Teachers and existing course coordinators, for a (non-admin) Program
    Coordinator's course-coordinator picker. Unlike /admin/staff this isn't
    admin-gated - a Program Coordinator needs to pick a user to assign without
    going through admin, but should only see the same promotable pool, not every
    user on the platform."""
    return (
        db.query(User)
        .filter(User.role.in_(("teacher", "course_coordinator")))
        .order_by(User.full_name)
        .all()
    )


@router.get("/admin/staff", response_model=List[StaffMemberResponse])
def list_staff(
    role: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """List teacher/program_coordinator/course_coordinator accounts, for the admin's
    'promote existing teacher' picker. Program/Course Coordinator accounts are never
    created fresh - they're always an existing teacher whose role was changed here,
    so they keep their existing login credentials (no new password to relay).

    Also surfaces each coordinator's assigned program/course name inline (two grouped
    queries, not N+1), so the admin UI doesn't need a separate scope-panel fetch just
    to see who's assigned where."""
    query = db.query(User).filter(User.role.in_(PROMOTABLE_ROLES))
    if role:
        if role not in PROMOTABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"role must be one of {PROMOTABLE_ROLES}")
        query = query.filter(User.role == role)
    users = query.order_by(User.full_name).all()

    user_ids = [u.id for u in users]
    program_names = dict(
        db.query(ProgramCoordinatorAssignment.user_id, Program.name)
        .join(Program, Program.id == ProgramCoordinatorAssignment.program_id)
        .filter(ProgramCoordinatorAssignment.user_id.in_(user_ids))
        .all()
    ) if user_ids else {}
    course_names = dict(
        db.query(CourseCoordinatorAssignment.user_id, Course.name)
        .join(Course, Course.id == CourseCoordinatorAssignment.course_id)
        .filter(CourseCoordinatorAssignment.user_id.in_(user_ids))
        .all()
    ) if user_ids else {}

    return [
        StaffMemberResponse(
            **UserResponse.model_validate(u).model_dump(),
            program_name=program_names.get(u.id),
            course_name=course_names.get(u.id),
        )
        for u in users
    ]


@router.patch("/admin/staff/{user_id}/role", response_model=UserResponse)
def change_staff_role(
    user_id: int,
    role_in: StaffRoleUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Promote/demote an existing teacher/program-coordinator/course-coordinator account
    between those three roles. No password is generated or changed - the account keeps
    its existing credentials. Students and admin accounts cannot be retargeted this way.

    Role and scope are changed atomically in one transaction (set role, drop all
    existing assignment rows for this user, insert the new ones) so there's never a
    window where a coordinator has the role but zero scope, or stale scope left over
    from a previous role."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role not in PROMOTABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only teacher / program coordinator / course coordinator accounts can be retargeted this way."
        )

    # Validate referenced ids exist before mutating anything.
    if role_in.program_ids:
        found = db.query(Program.id).filter(Program.id.in_(role_in.program_ids)).all()
        found_ids = {row[0] for row in found}
        missing = set(role_in.program_ids) - found_ids
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Program id(s) not found: {sorted(missing)}")
    if role_in.course_ids:
        found = db.query(Course.id).filter(Course.id.in_(role_in.course_ids)).all()
        found_ids = {row[0] for row in found}
        missing = set(role_in.course_ids) - found_ids
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Course id(s) not found: {sorted(missing)}")

    # A Program Coordinator may only coordinate a single program, and a Course
    # Coordinator's courses must all belong to that same single program - so nobody
    # ends up spread across multiple programs.
    if role_in.role == "program_coordinator" and role_in.program_ids and len(set(role_in.program_ids)) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A Program Coordinator may only be assigned to a single program."
        )
    if role_in.role == "course_coordinator" and role_in.course_ids and len(set(role_in.course_ids)) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A Course Coordinator may only be assigned to a single course."
        )
    if role_in.role == "course_coordinator" and role_in.course_ids:
        course_program_ids = {
            row[0] for row in db.query(CourseCatalog.program_id)
            .join(Course, Course.catalog_id == CourseCatalog.id)
            .filter(Course.id.in_(role_in.course_ids)).all()
        }
        if len(course_program_ids) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A Course Coordinator may only be assigned to courses within a single program."
            )

    user.role = role_in.role

    # Replace this user's entire scope - any prior assignments (from a previous role
    # or an earlier scope edit) are dropped regardless of the new role.
    db.query(ProgramCoordinatorAssignment).filter(ProgramCoordinatorAssignment.user_id == user.id).delete()
    db.query(CourseCoordinatorAssignment).filter(CourseCoordinatorAssignment.user_id == user.id).delete()

    if role_in.role == "program_coordinator" and role_in.program_ids:
        for program_id in role_in.program_ids:
            db.add(ProgramCoordinatorAssignment(user_id=user.id, program_id=program_id))
    if role_in.role == "course_coordinator" and role_in.course_ids:
        for course_id in role_in.course_ids:
            db.add(CourseCoordinatorAssignment(user_id=user.id, course_id=course_id))

    db.commit()
    db.refresh(user)
    return user


@router.get("/admin/staff/{user_id}/scope")
def get_staff_scope(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Returns the current Program/Course assignment ids for a staff user, so the admin
    UI can pre-populate the scope picker when re-editing an existing coordinator."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    program_ids = [row[0] for row in db.query(ProgramCoordinatorAssignment.program_id).filter(
        ProgramCoordinatorAssignment.user_id == user.id
    ).all()]
    course_ids = [row[0] for row in db.query(CourseCoordinatorAssignment.course_id).filter(
        CourseCoordinatorAssignment.user_id == user.id
    ).all()]
    return {"program_ids": program_ids, "course_ids": course_ids}


@router.patch("/admin/staff/{user_id}/authorities", response_model=UserResponse)
def update_staff_authorities(
    user_id: int,
    authorities_in: StaffAuthoritiesUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Grant/revoke Program Coordinator and/or Course Coordinator authority FLAGS on an
    existing teacher account (see User.is_program_coordinator/is_course_coordinator).
    These stack on top of the teacher role and the role/scope-based coordinator system
    above (change_staff_role) - they never replace the base role, so the account keeps
    every teacher capability (uploading content, running their own courses) in addition
    to whatever coordinator authority they're given. Only teacher accounts can hold
    these authorities. Kept alongside the role-based /role endpoint above rather than
    replacing it, since knowledge-graph approval gating (see auth/routes.py
    get_current_course_coordinator) and the catalog/course "manager" check (see
    get_current_course_manager) both key off these flags too."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role != "teacher":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only teacher accounts can be given coordinator authority."
        )
    if authorities_in.is_program_coordinator is not None:
        user.is_program_coordinator = authorities_in.is_program_coordinator
    if authorities_in.is_course_coordinator is not None:
        user.is_course_coordinator = authorities_in.is_course_coordinator
    db.commit()
    db.refresh(user)
    return user


@router.get("/admin/teacher-requests", response_model=List[TeacherRequestResponse])
def list_teacher_requests(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    query = db.query(TeacherRequest)
    if status_filter:
        query = query.filter(TeacherRequest.status == status_filter.lower())
    all_requests = query.order_by(TeacherRequest.created_at.desc()).all()

    # If the same person requested more than once, only surface their most recent
    # request (the list above is already newest-first, so the first occurrence wins).
    latest_by_email = {}
    for req in all_requests:
        if req.email not in latest_by_email:
            latest_by_email[req.email] = req
    return list(latest_by_email.values())


@router.post("/admin/teacher-requests/{request_id}/approve", response_model=TeacherCredentialsResponse)
def approve_teacher_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    req = db.query(TeacherRequest).filter(TeacherRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher request not found")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request has already been processed")

    credentials = _create_staff_account(db, req.email, req.full_name, "teacher")
    try:
        create_notification(
            db, credentials.id, NotificationType.ACCOUNT_APPROVED,
            title="Teacher account approved",
            message="Your teacher access request was approved. Check your email for login credentials.",
        )
    except Exception as e:
        print(f"Warning: failed to notify approved teacher: {str(e)}")
    req.status = "approved"
    db.commit()
    return credentials


@router.post("/admin/teacher-requests/{request_id}/reject", response_model=TeacherRequestResponse)
def reject_teacher_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    req = db.query(TeacherRequest).filter(TeacherRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher request not found")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request has already been processed")

    req.status = "rejected"
    db.commit()
    db.refresh(req)
    return req


# --- Admin: account status (suspend/reactivate) ---

@router.patch("/admin/users/{user_id}/status", response_model=UserResponse)
def update_user_status(
    user_id: int,
    status_in: UserStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Suspend or reactivate a user account. A suspended (is_active=False) account
    cannot log in or perform authenticated actions (see get_current_user/login above)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_active = status_in.is_active
    db.commit()
    db.refresh(user)
    return user


# --- Admin: User & Student Management & CSV Export ---

@router.get("/admin/all-users", response_model=List[UserResponse])
def list_all_users(
    role: Optional[str] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Retrieve all users. Filter by role, search (name/email substring), and active
    status. "program_coordinator"/"course_coordinator" match both the legacy
    exclusive role AND additive-flag teachers (is_program_coordinator/
    is_course_coordinator) - without this, filtering by either only ever found
    old-model accounts and showed "no users" for every teacher promoted via the
    newer flag-based Manage Staff Roles panel."""
    from sqlalchemy import or_
    query = db.query(User)
    if role == "program_coordinator":
        query = query.filter(or_(User.role == "program_coordinator", User.is_program_coordinator.is_(True)))
    elif role == "course_coordinator":
        query = query.filter(or_(User.role == "course_coordinator", User.is_course_coordinator.is_(True)))
    elif role:
        query = query.filter(User.role == role.lower())
    if search:
        q = f"%{search.lower()}%"
        from sqlalchemy import or_, func as sqlfunc
        query = query.filter(
            or_(sqlfunc.lower(User.full_name).like(q), sqlfunc.lower(User.email).like(q))
        )
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    return query.order_by(User.id.desc()).all()


@router.put("/admin/users/{user_id}", response_model=UserResponse)
def update_user_details(
    user_id: int,
    user_in: UserAdminUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Admin endpoint to edit a user's full name, email, role, or active status."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user_in.full_name is not None:
        user.full_name = user_in.full_name.strip()
    if user_in.email is not None:
        existing = db.query(User).filter(User.email == user_in.email.strip(), User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already used by another user")
        user.email = user_in.email.strip()
    if user_in.role is not None:
        user.role = user_in.role.lower()
    if user_in.is_active is not None:
        user.is_active = user_in.is_active

    db.commit()
    db.refresh(user)
    return user


@router.delete("/admin/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Admin endpoint to permanently delete a student, teacher, or coordinator account.

    Only Course/Enrollment/UploadedFile/Notification cascade automatically via
    their SQLAlchemy relationship on User - every other table with a FK to
    users.id (assignments, announcements, materials, meetings, comments, chat
    history, notification preferences, coordinator scope assignments, password
    reset tokens, email verification tokens) has no cascade configured, so a plain
    `db.delete(user)` raises a foreign-key IntegrityError for any user with real
    activity (which is effectively every non-throwaway account, and - since
    EmailVerificationToken is now created for every self-registered student at
    signup - effectively every student account at all). This explicitly clears
    those dependents first, in dependency order, before deleting the user row."""
    if user_id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own admin account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Courses this user teaches - reuse the same cascade-safe course deletion
    # used by the admin/coordinator "delete course" endpoints, which also
    # clears graph_build_jobs/graph_revisions/graph_edit_proposals (schema-drift
    # tables with no SQLAlchemy model but still FK'd to courses.id at the DB
    # level - missing this was the earlier cause of "delete" failing for any
    # teacher whose course had ever gone through knowledge-graph review).
    owned_courses = db.query(Course).filter(Course.teacher_id == user_id).all()
    for course in owned_courses:
        delete_course_cascade(db, course)

    # This user's own activity as a student/participant, regardless of course ownership.
    db.query(AssignmentSubmission).filter(AssignmentSubmission.student_id == user_id).delete(synchronize_session=False)
    db.query(Comment).filter(Comment.author_id == user_id).delete(synchronize_session=False)
    db.query(ChatMessage).filter(ChatMessage.user_id == user_id).delete(synchronize_session=False)
    db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).delete(synchronize_session=False)
    db.query(ProgramCoordinatorAssignment).filter(ProgramCoordinatorAssignment.user_id == user_id).delete(synchronize_session=False)
    db.query(CourseCoordinatorAssignment).filter(CourseCoordinatorAssignment.user_id == user_id).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id).delete(synchronize_session=False)
    db.query(EmailVerificationToken).filter(EmailVerificationToken.user_id == user_id).delete(synchronize_session=False)

    db.delete(user)  # cascades Course -> Enrollment/UploadedFile/ContentChunk, and Notification
    db.commit()
    return {"message": f"User {user.email} successfully deleted"}


@router.get("/admin/users/export-csv")
def export_users_csv(
    role: Optional[str] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Export matching users to CSV — honours same filters as list_all_users."""
    query = db.query(User)
    if role:
        query = query.filter(User.role == role.lower())
    if search:
        q = f"%{search.lower()}%"
        from sqlalchemy import or_, func as sqlfunc
        query = query.filter(
            or_(sqlfunc.lower(User.full_name).like(q), sqlfunc.lower(User.email).like(q))
        )
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    users = query.order_by(User.id.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Full Name", "Email", "Role", "Active"])

    for u in users:
        writer.writerow([
            u.id,
            u.full_name,
            u.email,
            u.role,
            "Yes" if u.is_active else "No",
        ])

    output.seek(0)
    fname_role = f"_{role}" if role else ""
    filename = f"conceptintel_users{fname_role}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# --- Admin: Activity Log ---

from app.database.models import Enrollment, TeacherRequest as _TeacherRequest


@router.get("/admin/logs")
def get_admin_logs(
    event_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Aggregate recent platform events into a unified activity feed for the admin.
    event_type values: 'registration' | 'enrollment' | 'request' | 'course'"""
    from app.database.models import Course as _Course
    events = []

    if not event_type or event_type == "registration":
        recent_users = db.query(User).order_by(User.id.desc()).limit(40).all()
        for u in recent_users:
            events.append({
                "event_type": "registration",
                "description": f"{u.full_name} registered as {u.role}",
                "actor": u.full_name,
                "actor_email": u.email,
                "role": u.role,
                "is_active": u.is_active,
                "timestamp": None,
                "sort_key": u.id,
            })

    if not event_type or event_type == "enrollment":
        recent_enrollments = (
            db.query(Enrollment)
            .order_by(Enrollment.enrolled_at.desc())
            .limit(40)
            .all()
        )
        for e in recent_enrollments:
            student = db.query(User).filter(User.id == e.student_id).first()
            course = db.query(_Course).filter(_Course.id == e.course_id).first()
            if student and course:
                events.append({
                    "event_type": "enrollment",
                    "description": f"{student.full_name} enrolled in {course.name}",
                    "actor": student.full_name,
                    "actor_email": student.email,
                    "role": "student",
                    "is_active": student.is_active,
                    "timestamp": e.enrolled_at.isoformat() if e.enrolled_at else None,
                    "sort_key": e.enrolled_at.timestamp() if e.enrolled_at else 0,
                    "extra": course.name,
                })

    if not event_type or event_type == "request":
        recent_requests = (
            db.query(_TeacherRequest)
            .order_by(_TeacherRequest.created_at.desc())
            .limit(40)
            .all()
        )
        for r in recent_requests:
            events.append({
                "event_type": "request",
                "description": f"{r.full_name} submitted teacher access request ({r.status})",
                "actor": r.full_name,
                "actor_email": r.email,
                "role": "applicant",
                "is_active": True,
                "status": r.status,
                "timestamp": r.created_at.isoformat() if r.created_at else None,
                "sort_key": r.created_at.timestamp() if r.created_at else 0,
            })

    if not event_type or event_type == "course":
        recent_courses = db.query(_Course).order_by(_Course.id.desc()).limit(30).all()
        for c in recent_courses:
            teacher = db.query(User).filter(User.id == c.teacher_id).first()
            events.append({
                "event_type": "course",
                "description": f"Course \u201c{c.name}\u201d created" + (f" by {teacher.full_name}" if teacher else ""),
                "actor": teacher.full_name if teacher else "Unknown",
                "actor_email": teacher.email if teacher else "",
                "role": "teacher",
                "is_active": True,
                "timestamp": None,
                "sort_key": c.id,
                "extra": c.code or "",
            })

    # Sort: events with timestamps first (desc), then sort-key desc for others
    events.sort(key=lambda x: x.get("sort_key") or 0, reverse=True)
    return events[:100]

