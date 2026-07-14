import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database.connection import Base, get_db
from app.database.models import User, Course, Enrollment
from app.auth.utils import hash_password, create_access_token

# Setup SQLite test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency override
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Pre-populate test teacher and student
    teacher = User(
        email="teacher@test.com",
        hashed_password=hash_password("password123"),
        full_name="Dr. Ashfaq",
        role="teacher"
    )
    student = User(
        email="student@test.com",
        hashed_password=hash_password("password123"),
        full_name="Kashif student",
        role="student"
    )
    db.add(teacher)
    db.add(student)
    db.commit()
    
    yield
    
    Base.metadata.drop_all(bind=engine)


def test_register_user():
    client = TestClient(app)
    response = client.post(
        "/api/auth/register",
        json={
            "email": "newuser@test.com",
            "password": "mypassword",
            "full_name": "Test User",
            "role": "student"
        }
    )
    assert response.status_code == 201
    assert response.json()["email"] == "newuser@test.com"


def test_login_user():
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        json={
            "email": "student@test.com",
            "password": "password123"
        }
    )
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert response.json()["role"] == "student"


def test_course_creation():
    client = TestClient(app)
    # Generate teacher JWT
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.post(
        "/api/courses",
        json={
            "name": "Calculus & Analytical Geometry",
            "code": "CAL-101",
            "semester": "Spring 2026",
            "max_students": 30
        },
        headers=headers
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Calculus & Analytical Geometry"
    assert len(data["enrollment_code"]) == 8


def test_enrollment_validation():
    client = TestClient(app)
    db = TestingSessionLocal()
    
    # 1. Create a prerequisite course (Applied Physics)
    prereq_course = Course(
        name="Applied Physics",
        code="PHY-101",
        semester="Spring 2026",
        enrollment_code="PHY12345",
        max_students=2,
        status="Open",
        teacher_id=1
    )
    db.add(prereq_course)
    db.commit()
    db.refresh(prereq_course)

    # 2. Create target course (Digital Logic Design) requiring Applied Physics
    target_course = Course(
        name="Digital Logic Design",
        code="DLD-201",
        semester="Fall 2026",
        enrollment_code="DLD12345",
        max_students=2,
        status="Open",
        prerequisite_course_id=prereq_course.id,
        teacher_id=1
    )
    db.add(target_course)
    db.commit()
    db.refresh(target_course)

    # Student token
    student_token = create_access_token({"sub": "student@test.com", "role": "student", "user_id": 2})
    headers = {"Authorization": f"Bearer {student_token}"}

    # Try to enroll in DLD without completing Physics prerequisite
    response = client.post(
        "/api/enrollment/join",
        json={"enrollment_code": "DLD12345"},
        headers=headers
    )
    assert response.status_code == 400
    assert "Prerequisite course" in response.json()["detail"]

    # Complete Physics prerequisite
    enrollment = Enrollment(
        student_id=2,
        course_id=prereq_course.id,
        status="Completed",
        progress=100.0
    )
    db.add(enrollment)
    db.commit()

    # Try enrolling again after completion
    response = client.post(
        "/api/enrollment/join",
        json={"enrollment_code": "DLD12345"},
        headers=headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "Active"
