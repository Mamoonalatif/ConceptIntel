from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from app.config import settings
from app.email_service import send_staff_credentials_email
from app.database.connection import get_db
from app.database.models import User, TeacherRequest
from app.auth.schemas import (
    UserCreate, UserLogin, UserResponse, Token, TokenData,
    AdminCreateTeacher, TeacherCredentialsResponse,
    TeacherRequestCreate, TeacherRequestResponse,
    UserStatusUpdate, GoogleAuthRequest, StaffRoleUpdate, ChangePasswordRequest,
)
from app.auth.utils import hash_password, verify_password, create_access_token, decode_access_token, generate_temporary_password

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

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


def get_current_program_coordinator(current_user: User = Depends(get_current_user)) -> User:
    """Program Coordinator duties: catalog CRUD, prerequisite mapping, course deletion.
    Admin retains every course-management power too, so it's accepted alongside the
    dedicated role rather than replacing it."""
    if current_user.role.lower() not in ("admin", "program_coordinator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Program Coordinator role required."
        )
    return current_user


def get_current_course_coordinator(current_user: User = Depends(get_current_user)) -> User:
    """Course Coordinator duties: approve/reject a course's knowledge graph, update
    course info. Admin retains this power too."""
    if current_user.role.lower() not in ("admin", "course_coordinator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation forbidden: Course Coordinator role required."
        )
    return current_user


def get_current_course_manager(current_user: User = Depends(get_current_user)) -> User:
    """Any role that may update course info (admin / program coordinator / course
    coordinator). The route handler itself restricts catalog/prerequisite changes to
    admin/program_coordinator only."""
    if current_user.role.lower() not in ("admin", "program_coordinator", "course_coordinator"):
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

    # Create new user
    new_user = User(
        email=user_in.email,
        hashed_password=hash_password(user_in.password),
        full_name=user_in.full_name,
        role=role_lower
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not user.hashed_password or not verify_password(credentials.password, user.hashed_password):
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
            payload.id_token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
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
    if current_user.hashed_password:
        if not payload.current_password or not verify_password(payload.current_password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect."
            )

    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully."}


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
    new_user = User(
        email=email,
        hashed_password=hash_password(temp_password),
        full_name=full_name,
        role=role
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


@router.get("/admin/staff", response_model=List[UserResponse])
def list_staff(
    role: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """List teacher/program_coordinator/course_coordinator accounts, for the admin's
    'promote existing teacher' picker. Program/Course Coordinator accounts are never
    created fresh - they're always an existing teacher whose role was changed here,
    so they keep their existing login credentials (no new password to relay)."""
    query = db.query(User).filter(User.role.in_(PROMOTABLE_ROLES))
    if role:
        if role not in PROMOTABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"role must be one of {PROMOTABLE_ROLES}")
        query = query.filter(User.role == role)
    return query.order_by(User.full_name).all()


@router.patch("/admin/staff/{user_id}/role", response_model=UserResponse)
def change_staff_role(
    user_id: int,
    role_in: StaffRoleUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """Promote/demote an existing teacher/program-coordinator/course-coordinator account
    between those three roles. No password is generated or changed - the account keeps
    its existing credentials. Students and admin accounts cannot be retargeted this way."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role not in PROMOTABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only teacher / program coordinator / course coordinator accounts can be retargeted this way."
        )
    user.role = role_in.role
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
