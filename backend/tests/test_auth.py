from tests.conftest import login_user, register_user


def test_register_success(client):
    response = register_user(client, "student@test.com", role="student")
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "student@test.com"
    assert data["user"]["role"] == "student"


def test_register_duplicate_email(client):
    register_user(client, "dup@test.com")
    response = register_user(client, "dup@test.com")
    assert response.status_code == 409


def test_register_password_too_short(client):
    response = register_user(client, "short@test.com", password="abc")
    assert response.status_code == 422


def test_login_success(client):
    register_user(client, "login@test.com", password="securepass1")
    response = login_user(client, "login@test.com", password="securepass1")
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "login@test.com"


def test_login_invalid_credentials(client):
    register_user(client, "badlogin@test.com")
    response = login_user(client, "badlogin@test.com", password="wrongpassword")
    assert response.status_code == 401


def test_me_requires_auth(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_me_with_valid_token(client):
    reg = register_user(client, "me@test.com")
    token = reg.json()["access_token"]
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me@test.com"


def test_logout(client):
    reg = register_user(client, "logout@test.com")
    token = reg.json()["access_token"]
    response = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["message"] == "Logged out successfully"


def test_admin_only_denies_student(client):
    reg = register_user(client, "studentadmin@test.com", role="student")
    token = reg.json()["access_token"]
    response = client.get("/api/auth/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_admin_only_allows_admin(client):
    reg = register_user(client, "admin@test.com", role="admin")
    token = reg.json()["access_token"]
    response = client.get("/api/auth/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_teacher_only_allows_teacher(client):
    reg = register_user(client, "teacher@test.com", role="teacher")
    token = reg.json()["access_token"]
    response = client.get("/api/auth/teacher-only", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_protected_course_route_denies_unauthenticated(client):
    response = client.get("/api/courses/protected")
    assert response.status_code == 401


def test_protected_course_route_allows_authenticated_student(client):
    reg = register_user(client, "coursestudent@test.com", role="student")
    token = reg.json()["access_token"]
    response = client.get("/api/courses/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_generate_structure_denies_student(client):
    reg = register_user(client, "genstudent@test.com", role="student")
    token = reg.json()["access_token"]
    response = client.post(
        "/api/courses/generate-structure",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": "Test Course",
            "subject": "cs",
            "description": "Test",
            "clos": [],
            "prerequisites": [],
        },
    )
    assert response.status_code == 403


def test_generate_structure_allows_teacher(client):
    reg = register_user(client, "genteacher@test.com", role="teacher")
    token = reg.json()["access_token"]
    response = client.post(
        "/api/courses/generate-structure",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": "Test Course",
            "subject": "cs",
            "description": "Test",
            "clos": [],
            "prerequisites": [],
        },
    )
    assert response.status_code == 200
    assert len(response.json()["modules"]) > 0


def test_invalid_token_rejected(client):
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid-token"})
    assert response.status_code == 401
