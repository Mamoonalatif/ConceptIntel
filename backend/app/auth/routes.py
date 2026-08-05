import csv
import io
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from app.config import settings
from app.email_service import send_staff_credentials_email
from app.database.connection import get_db
from app.database.models import (
    User, TeacherRequest, Program, Course, CourseCatalog,
    ProgramCoordinatorAssignment, CourseCoordinatorAssignment,
    Assignment, AssignmentSubmission, Announcement, Material, Meeting,
    Comment, ChatMessage, NotificationPreference,
)
from app.courses.services import delete_course_cascade
from app.auth.schemas import (
    UserCreate, UserLogin, UserResponse, Token, TokenData,
    AdminCreateTeacher, TeacherCredentialsResponse,
    TeacherRequestCreate, TeacherRequestResponse,
    UserStatusUpdate, UserAdminUpdate, GoogleAuthRequest, StaffRoleUpdate, ChangePasswordRequest,
    StaffMemberResponse, StaffAuthoritiesUpdate,
)
from app.auth.utils import hash_password, verify_password, create_access_token, decode_access_token, generate_temporary_password
from app.supabase_auth import (
    is_supabase_auth_configured, create_supabase_user, verify_supabase_password,
    get_or_create_supabase_user_by_email, update_supabase_user_password,
)
from app.notifications.service import create_notification, notify_admins
from app.notifications.types import NotificationType
from app.email_service import send_notification_email
from app.upload.services import store_file, download_stored_file, delete_stored_file, get_content_type

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

_google_request_session = google_requests.Request()

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
    """Wraps a Course Coordinator (or admin) request with the set of Course ids they
    may act on. course_ids is None for an admin - meaning unrestricted/every course -
    and a (possibly empty) set for a course_coordinator, resolved from
    CourseCoordinatorAssignment."""
    user: User
    course_ids: Optional[Set[int]]


def resolve_program_ids(db: Session, user: User) -> Optional[Set[int]]:
    """None means unrestricted (admin). Otherwise the set of Program ids this user is
    assigned to via ProgramCoordinatorAssignment (possibly empty)."""
    if user.role.lower() == "admin":
        return None
    rows = db.query(ProgramCoordinatorAssignment.program_id).filter(
        ProgramCoordinatorAssignment.user_id == user.id
    ).all()
    return {row[0] for row in rows}


def resolve_course_ids(db: Session, user: User) -> Optional[Set[int]]:
    """None means unrestricted (admin). Otherwise the set of Course ids this user is
    assigned to via CourseCoordinatorAssignment (possibly empty)."""
    if user.role.lower() == "admin":
        return None
    rows = db.query(CourseCoordinatorAssignment.course_id).filter(
        CourseCoordinatorAssignment.user_id == user.id
    ).all()
    return {row[0] for row in rows}


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
    """Course Coordinator duties: approve/reject a course's knowledge graph, update
    course info. Admin retains this power too - admin gets course_ids=None
    (unrestricted)."""
    if current_user.role.lower() != "admin" and not _is_course_coordinator(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Course Coordinator authority required."
        )
    return CourseScope(user=current_user, course_ids=resolve_course_ids(db, current_user))


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
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
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

    # Create token payload
    token_data = {
        "sub": user.email,
        "role": user.role,
        "user_id": user.id
    }
    access_token = create_access_token(token_data)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "full_name": user.full_name
    }


@router.post("/google", response_model=Token)
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

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email,
            hashed_password=None,
            full_name=full_name,
            role="student",
            google_id=google_sub,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.google_id is None:
        # First Google sign-in for an account that previously only had a password.
        user.google_id = google_sub
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
    if is_supabase_auth_configured() and not user.supabase_uid:
        try:
            user.supabase_uid = get_or_create_supabase_user_by_email(email, full_name)
            db.commit()
        except Exception as e:
            print(f"Warning: failed to link Supabase auth user for {email}: {e}")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please contact support."
        )

    token_data = {"sub": user.email, "role": user.role, "user_id": user.id}
    access_token = create_access_token(token_data)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "full_name": user.full_name,
    }


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


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
        db.commit()

    return {"message": "Password updated successfully."}


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
        notify_admins(
            db, NotificationType.TEACHER_REQUEST_SUBMITTED,
            title="New teacher access request",
            message=f"{new_request.full_name} ({new_request.email}) requested a teacher account.",
            link="/admin",
        )
        admins = db.query(User).filter(User.role == "admin").all()
        for admin in admins:
            send_notification_email(
                admin.email, admin.full_name,
                title="New teacher access request",
                message=f"{new_request.full_name} ({new_request.email}) requested a teacher account on ConceptIntel.",
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
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Best-effort email delivery - the temporary password is still returned in the
    # response either way, so the admin can relay it manually if email isn't
    # configured or delivery fails (see app/email_service.py).
    send_staff_credentials_email(new_user.email, new_user.full_name, role.replace("_", " ").title(), temp_password)

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
    """Retrieve all users. Filter by role, search (name/email substring), and active status."""
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
    history, notification preferences, coordinator scope assignments) has no
    cascade configured, so a plain `db.delete(user)` raises a foreign-key
    IntegrityError for any user with real activity (which is effectively every
    non-throwaway account). This explicitly clears those dependents first, in
    dependency order, before deleting the user row."""
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

