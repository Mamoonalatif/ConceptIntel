from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import generate_user_id, get_current_user, require_roles
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.auth import (
    MessageResponse,
    TeacherCreate,
    TeacherSetupPassword,
    TokenResponse,
    UserLogin,
    UserRegister,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegister, db: Annotated[Session, Depends(get_db)]):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        id=generate_user_id(),
        email=payload.email.lower(),
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.id, role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Annotated[Session, Depends(get_db)]):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.password_pending:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password setup required. Please complete password setup first.",
        )

    token = create_access_token(subject=user.id, role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return UserResponse.model_validate(current_user)


@router.post("/logout", response_model=MessageResponse)
def logout(_current_user: Annotated[User, Depends(get_current_user)]):
    # JWT is stateless; client clears the token. Endpoint confirms session was valid.
    return MessageResponse(message="Logged out successfully")


@router.get("/admin-only", response_model=MessageResponse)
def admin_only(_current_user: Annotated[User, Depends(require_roles(UserRole.admin))]):
    return MessageResponse(message="Admin access granted")


@router.get("/teacher-only", response_model=MessageResponse)
def teacher_only(_current_user: Annotated[User, Depends(require_roles(UserRole.teacher, UserRole.admin))]):
    return MessageResponse(message="Teacher access granted")


@router.post("/admin/create-teacher", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_teacher(
    payload: TeacherCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    # Create teacher with pending password
    user = User(
        id=generate_user_id(),
        email=payload.email.lower(),
        full_name=payload.full_name,
        hashed_password=hash_password("TempPassword123!"),  # Temporary password
        role=UserRole.teacher,
        password_pending=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserResponse.model_validate(user)


@router.post("/teacher/setup-password", response_model=TokenResponse)
def setup_teacher_password(
    payload: TeacherSetupPassword,
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.role != UserRole.teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can set up password",
        )

    if not user.password_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password already set up",
        )

    user.hashed_password = hash_password(payload.password)
    user.password_pending = False
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.id, role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )
