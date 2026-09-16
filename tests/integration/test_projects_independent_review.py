"""Independent cross-project browser identity, CSRF, and history boundary checks."""

from tests.integration.test_oidc import submit, review, login
from tests.integration.test_projects import new_project, headers

pytest_plugins = ["tests.integration.test_oidc"]


def test_browser_session_selects_fresh_project_roles_and_logout_removes_shared_identity(oidc_app):
    client, token, issuer, _ = oidc_app
    new_project(client, token, "secondary")
    added = client.post("/api/v1/users", headers=headers(token, "secondary"), json={
        "id": "analyst", "name": "Analyst", "roles": ["PROJECT_VIEWER"], "status": "active",
    })
    assert added.status_code == 200, added.text
    assert review(client, token, submit(client, token)).status_code == 200
    assert login(client, issuer).headers["location"] == "/workspace"
    identity = client.get("/api/v1/auth/session", headers={"X-RCA-Project": "secondary"})
    assert identity.status_code == 200, identity.text
    assert identity.json()["principal"]["roles"] == ["PROJECT_VIEWER"]
    csrf = identity.json()["csrf_token"]
    auth = {"X-RCA-Project": "secondary", "Origin": "https://app.example.test", "X-CSRF-Token": csrf}
    created = client.post("/api/v1/chats", headers=auth)
    assert created.status_code == 201, created.text
    chat_id = created.json()["chat_id"]
    resolved = client.post("/api/v1/chat/resolve", headers=auth, json={"chat_id": chat_id, "prompt": "Hello"})
    assert resolved.status_code == 200 and resolved.json()["exchange_id"], resolved.text
    assert client.get(f"/api/v1/chats/{chat_id}/messages", headers={"X-RCA-Project": "payments"}).status_code == 404
    assert client.post("/api/v1/chats", headers={"X-RCA-Project": "secondary"}).status_code == 403
    assert client.post("/api/v1/skills", headers=auth, json={}).status_code == 403
    revoked = client.put("/api/v1/users/analyst", headers=headers(token, "secondary"), json={
        "name": "Analyst", "roles": ["PROJECT_VIEWER"], "status": "inactive",
    })
    assert revoked.status_code == 200, revoked.text
    assert client.get("/api/v1/auth/session", headers={"X-RCA-Project": "secondary"}).status_code == 403
    assert client.get("/api/v1/auth/session", headers={"X-RCA-Project": "payments"}).status_code == 200
    assert client.post("/api/v1/auth/logout", headers={"Origin": "https://app.example.test", "X-CSRF-Token": csrf}).status_code == 204
    assert client.get("/api/v1/auth/session", headers={"X-RCA-Project": "payments"}).status_code == 401
