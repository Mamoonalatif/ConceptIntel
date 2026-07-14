import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database.connection import Base, get_db
from app.database.models import User, Course, UploadedFile
from app.auth.utils import hash_password, create_access_token

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

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
    
    # Create teacher
    teacher = User(
        email="teacher@test.com",
        hashed_password=hash_password("password123"),
        full_name="Dr. Ashfaq",
        role="teacher"
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    # Create course
    course = Course(
        name="Calculus & Analytical Geometry",
        code="CAL-101",
        semester="Spring 2026",
        enrollment_code="CAL12345",
        max_students=30,
        status="Open",
        teacher_id=teacher.id
    )
    db.add(course)
    db.commit()
    
    yield
    Base.metadata.drop_all(bind=engine)


def test_upload_file_local_fallback():
    client = TestClient(app)
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}

    # Simulate uploading a valid txt file
    file_content = b"This is a sample educational content about Derivatives and Limits."
    response = client.post(
        "/api/files/upload/1",
        files={"file": ("calculus_notes.txt", file_content, "text/plain")},
        headers=headers
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filename"] == "calculus_notes.txt"
    assert data["file_type"] == "txt"
    assert data["status"] == "Uploaded"
    assert data["course_id"] == 1


def test_upload_file_invalid_type():
    client = TestClient(app)
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}

    # Upload png (unsupported format)
    file_content = b"\x89PNG\r\n\x1a\n"
    response = client.post(
        "/api/files/upload/1",
        files={"file": ("chart.png", file_content, "image/png")},
        headers=headers
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_upload_file_exceeds_size():
    client = TestClient(app)
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}

    # Exceeding size limit (25MB + 1 byte)
    huge_content = b"x" * (25 * 1024 * 1024 + 1)
    response = client.post(
        "/api/files/upload/1",
        files={"file": ("huge_book.txt", huge_content, "text/plain")},
        headers=headers
    )
    assert response.status_code == 400
    assert "File exceeds maximum size limit" in response.json()["detail"]


def test_replace_file():
    client = TestClient(app)
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Upload initial file
    file_content = b"Initial notes on derivatives."
    upload_resp = client.post(
        "/api/files/upload/1",
        files={"file": ("calculus_v1.txt", file_content, "text/plain")},
        headers=headers
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    # 2. Replace the file
    new_content = b"Updated notes on derivatives and integration."
    replace_resp = client.put(
        f"/api/files/{file_id}",
        files={"file": ("calculus_v2.txt", new_content, "text/plain")},
        headers=headers
    )
    assert replace_resp.status_code == 200
    replace_data = replace_resp.json()
    assert replace_data["id"] == file_id
    assert replace_data["filename"] == "calculus_v2.txt"
    assert replace_data["status"] == "Uploaded"


def test_delete_file():
    client = TestClient(app)
    token = create_access_token({"sub": "teacher@test.com", "role": "teacher", "user_id": 1})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Upload a file
    file_content = b"Content to delete."
    upload_resp = client.post(
        "/api/files/upload/1",
        files={"file": ("temp.txt", file_content, "text/plain")},
        headers=headers
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    # 2. Delete the file
    delete_resp = client.delete(
        f"/api/files/{file_id}",
        headers=headers
    )
    assert delete_resp.status_code == 204

    # 3. Try to get course files - should be empty
    list_resp = client.get(
        "/api/files/course/1",
        headers=headers
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 0
