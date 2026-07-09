from tests.conftest import login_user, register_user


def register_teacher(client, email="teacher@test.com"):
    return register_user(client, email, role="teacher", full_name="Test Teacher")


def register_coordinator(client, email="coord@test.com"):
    return register_user(client, email, role="coordinator", full_name="Test Coordinator")


def register_student(client, email="student@test.com"):
    return register_user(client, email, role="student", full_name="Test Student")


def auth_header(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def seed_via_api(client, teacher_headers):
    return client.post("/api/supervision/seed", headers=teacher_headers)


def test_teacher_can_list_pending_content(client):
    teacher = register_teacher(client, "sup_teacher1@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    res = client.get("/api/supervision/content?status=pending_review", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_teacher_can_approve_content(client):
    teacher = register_teacher(client, "sup_teacher2@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=headers).json()
    content_id = pending[0]["id"]

    res = client.post(
        f"/api/supervision/content/{content_id}/approve",
        headers=headers,
        json={"comment": "Looks good for students"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"


def test_teacher_can_reject_content(client):
    teacher = register_teacher(client, "sup_teacher3@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=headers).json()
    content_id = pending[0]["id"]

    res = client.post(
        f"/api/supervision/content/{content_id}/reject",
        headers=headers,
        json={"reason": "Questions are not aligned with CLOs"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


def test_edit_creates_revision_and_resets_to_pending(client):
    teacher = register_teacher(client, "sup_teacher4@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=headers).json()
    content_id = pending[0]["id"]

    res = client.put(
        f"/api/supervision/content/{content_id}",
        headers=headers,
        json={
            "title": "Updated Quiz Title",
            "edit_note": "Fixed wording on question 2",
        },
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Updated Quiz Title"
    assert res.json()["version"] >= 2

    detail = client.get(f"/api/supervision/content/{content_id}", headers=headers).json()
    assert len(detail["revisions"]) >= 1
    assert len(detail["approvals"]) >= 1


def test_regenerate_content(client):
    teacher = register_teacher(client, "sup_teacher5@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=headers).json()
    content_id = pending[0]["id"]

    res = client.post(
        f"/api/supervision/content/{content_id}/regenerate",
        headers=headers,
        json={"instructions": "Add more BFS questions"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "pending_review"
    assert res.json()["version"] >= 2


def test_student_only_sees_approved_content(client):
    teacher = register_teacher(client, "sup_teacher6@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)

    all_content = client.get("/api/supervision/content", headers=teacher_headers).json()
    pending_id = next(c["id"] for c in all_content if c["status"] == "pending_review")
    approved_id = next(c["id"] for c in all_content if c["status"] == "approved")

    student = register_student(client, "sup_student6@test.com")
    student_headers = auth_header(student)

    student_items = client.get("/api/supervision/student/content", headers=student_headers).json()
    student_ids = {item["id"] for item in student_items}

    assert approved_id in student_ids
    assert pending_id not in student_ids


def test_coordinator_can_review_all_teachers_content(client):
    teacher = register_teacher(client, "sup_teacher7@test.com")
    teacher_headers = auth_header(teacher)
    seed_via_api(client, teacher_headers)

    coordinator = register_coordinator(client, "sup_coord7@test.com")
    coord_headers = auth_header(coordinator)

    res = client.get("/api/supervision/content", headers=coord_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_coordinator_can_approve_content(client):
    teacher = register_teacher(client, "sup_teacher8@test.com")
    seed_via_api(client, auth_header(teacher))

    coordinator = register_coordinator(client, "sup_coord8@test.com")
    coord_headers = auth_header(coordinator)

    pending = client.get("/api/supervision/content?status=pending_review", headers=coord_headers).json()
    content_id = pending[0]["id"]

    res = client.post(
        f"/api/supervision/content/{content_id}/approve",
        headers=coord_headers,
        json={"comment": "Coordinator approved for curriculum alignment"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"


def test_audit_logs_recorded(client):
    teacher = register_teacher(client, "sup_teacher9@test.com")
    headers = auth_header(teacher)
    seed_via_api(client, headers)

    pending = client.get("/api/supervision/content?status=pending_review", headers=headers).json()
    content_id = pending[0]["id"]
    client.post(f"/api/supervision/content/{content_id}/approve", headers=headers, json={})

    logs = client.get("/api/supervision/audit-logs", headers=headers).json()
    assert len(logs) >= 1
    assert any(log["action"] == "content_approved" for log in logs)


def test_student_cannot_access_supervision_routes(client):
    student = register_student(client, "sup_student10@test.com")
    headers = auth_header(student)

    res = client.get("/api/supervision/content", headers=headers)
    assert res.status_code == 403
