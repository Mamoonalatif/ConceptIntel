from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import User, TeacherRequest
from app.auth.schemas import (
    UserCreate, UserLogin, UserResponse, Token, TokenData,
    AdminCreateTeacher, TeacherCredentialsResponse,
    TeacherRequestCreate, TeacherRequestResponse,
    UserStatusUpdate,
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
    if not user or not verify_password(credentials.password, user.hashed_password):
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


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


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


# --- Admin: teacher provisioning ---

def _create_teacher_account(db: Session, email: str, full_name: str) -> TeacherCredentialsResponse:
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    temp_password = generate_temporary_password()
    new_teacher = User(
        email=email,
        hashed_password=hash_password(temp_password),
        full_name=full_name,
        role="teacher"
    )
    db.add(new_teacher)
    db.commit()
    db.refresh(new_teacher)

    return TeacherCredentialsResponse(
        id=new_teacher.id,
        email=new_teacher.email,
        full_name=new_teacher.full_name,
        role=new_teacher.role,
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
    return _create_teacher_account(db, teacher_in.email, teacher_in.full_name)


@router.get("/admin/teacher-requests", response_model=List[TeacherRequestResponse])
def list_teacher_requests(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    query = db.query(TeacherRequest)
    if status_filter:
        query = query.filter(TeacherRequest.status == status_filter.lower())
    return query.order_by(TeacherRequest.created_at.desc()).all()


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

    credentials = _create_teacher_account(db, req.email, req.full_name)
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
