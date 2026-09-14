import tempfile

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_knowledge_upload_is_scoped_bounded_and_redacted():
    with tempfile.TemporaryDirectory() as directory:
        settings, token = settings_for(directory)
        with TestClient(create_app(settings, connectors=connectors())) as client:
            files = {"file": ("runbook.md", b"Check status. password=private-value", "text/markdown")}
            assert client.post("/api/v1/knowledge/upload", data={"title": "Operational guide"}, files=files).status_code == 401
            assert client.post("/api/v1/knowledge/upload", headers=token("viewer"), data={"title": "Operational guide"}, files=files).status_code == 403
            response = client.post("/api/v1/knowledge/upload", headers=token("owner"), data={"title": "Operational guide"}, files=files)
            assert response.status_code == 201
            item = response.json()
            assert "private-value" not in item["content"]
            assert item["upload"]["original_retained"] is False
            documents = client.get("/api/v1/knowledge", headers=token("viewer")).json()
            stored = next(row for row in documents if row.get("doc_id") == item["doc_id"])
            assert stored["upload"] == item["upload"]
            assert stored["upload"]["processing_status"] == "extracted"
            bad = client.post("/api/v1/knowledge/upload", headers=token("owner"), data={"title": "Invalid"}, files={"file": ("script.exe", b"not allowed")})
            assert bad.status_code == 422
        with TestClient(create_app(settings, connectors=connectors())) as client:
            documents = client.get("/api/v1/knowledge", headers=token("viewer")).json()
            stored = next(row for row in documents if row.get("doc_id") == item["doc_id"])
            assert stored["upload"] == item["upload"]
            assert "private-value" not in stored["content"]
