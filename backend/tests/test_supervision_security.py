"""Security-focused authorization tests for the supervision module."""
from tests.conftest import register_user
from tests.test_supervision import auth_header, register_coordinator, register_student, register_teacher, seed_via_api


def test_unauthenticated_supervision_denied(client):
    endpoints = [
        ("GET", "/api/supervision/stats"),
        ("GET", "/api/supervision/content"),
        ("GET", "/api/supervision/student/content"),
        ("GET", "/api/supervision/audit-logs"),
    ]
    for method, path in endpoints:
        res = client.request(method, path)
        assert res.status_code == 401, f"{method} {path} should require auth"


def test_student_cannot_approve_reject_or_edit(client):
    teacher = register_teacher(client, "sec_teacher1@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=teacher_headers).json()
    content_id = pending[0]["id"]

    student = register_student(client, "sec_student1@test.com")
    student_headers = auth_header(student)

    assert client.get(f"/api/supervision/content/{content_id}", headers=student_headers).status_code == 403
    assert client.put(f"/api/supervision/content/{content_id}", headers=student_headers, json={"title": "Hack"}).status_code == 403
    assert client.post(f"/api/supervision/content/{content_id}/approve", headers=student_headers, json={}).status_code == 403
    assert client.post(f"/api/supervision/content/{content_id}/reject", headers=student_headers, json={"reason": "no"}).status_code == 403
    assert client.post(f"/api/supervision/content/{content_id}/regenerate", headers=student_headers, json={}).status_code == 403
    assert client.get("/api/supervision/audit-logs", headers=student_headers).status_code == 403


def test_student_cannot_access_revision_history(client):
    teacher = register_teacher(client, "sec_teacher2@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)

    content_id = client.get("/api/supervision/content", headers=teacher_headers).json()[0]["id"]
    student_headers = auth_header(register_student(client, "sec_student2@test.com"))

    res = client.get(f"/api/supervision/content/{content_id}", headers=student_headers)
    assert res.status_code == 403


def test_teacher_cannot_access_another_teachers_content(client):
    teacher_a = register_teacher(client, "sec_teacher_a@test.com")
    teacher_b = register_teacher(client, "sec_teacher_b@test.com")
    headers_a = auth_header(teacher_a)
    headers_b = auth_header(teacher_b)

    seed_via_api(client, headers_a)
    content_id = client.get("/api/supervision/content", headers=headers_a).json()[0]["id"]

    # Teacher B cannot list Teacher A's content
    listed = client.get("/api/supervision/content", headers=headers_b).json()
    assert all(item["teacher_id"] != teacher_a.json()["user"]["id"] for item in listed) or len(listed) == 0

    # Teacher B cannot read, edit, approve Teacher A's content by ID (horizontal escalation)
    assert client.get(f"/api/supervision/content/{content_id}", headers=headers_b).status_code == 403
    assert client.put(f"/api/supervision/content/{content_id}", headers=headers_b, json={"title": "Stolen"}).status_code == 403
    assert client.post(f"/api/supervision/content/{content_id}/approve", headers=headers_b, json={}).status_code == 403


def test_coordinator_can_access_any_teachers_content_by_id(client):
    teacher = register_teacher(client, "sec_teacher_c@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)
    content_id = client.get("/api/supervision/content", headers=teacher_headers).json()[0]["id"]

    coordinator = register_coordinator(client, "sec_coord_c@test.com")
    coord_headers = auth_header(coordinator)

    res = client.get(f"/api/supervision/content/{content_id}", headers=coord_headers)
    assert res.status_code == 200
    assert "revisions" in res.json()
    assert "approvals" in res.json()


def test_admin_has_full_supervision_api_access(client):
    teacher = register_teacher(client, "sec_teacher_d@test.com")
    seed_via_api(client, auth_header(teacher))

    admin = register_user(client, "sec_admin@test.com", role="admin", full_name="Admin User")
    admin_headers = auth_header(admin)

    assert client.get("/api/supervision/content", headers=admin_headers).status_code == 200
    assert client.get("/api/supervision/audit-logs", headers=admin_headers).status_code == 200


def test_student_endpoint_never_returns_non_approved(client):
    teacher = register_teacher(client, "sec_teacher_e@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)

    # Ensure we have pending and rejected items
    pending = client.get("/api/supervision/content?status=pending_review", headers=teacher_headers).json()
    if pending:
        client.post(
            f"/api/supervision/content/{pending[0]['id']}/reject",
            headers=teacher_headers,
            json={"reason": "Security test rejection"},
        )

    student_headers = auth_header(register_student(client, "sec_student_e@test.com"))
    items = client.get("/api/supervision/student/content", headers=student_headers).json()

    assert all(item["status"] == "approved" for item in items)


def test_coordinator_cannot_create_content(client):
    coordinator = register_coordinator(client, "sec_coord_create@test.com")
    coord_headers = auth_header(coordinator)

    res = client.post(
        "/api/supervision/content",
        headers=coord_headers,
        json={
            "course_id": "c1",
            "course_name": "Test",
            "title": "Bad Create",
            "content_type": "quiz",
            "body": {"summary": "test"},
        },
    )
    assert res.status_code == 403
