"""Artifact preview reads only retained, owned, integrity-checked processed text."""

import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import settings_for


def test_preview_is_redacted_bounded_owned_and_retention_aware(tmp_path):
    settings, token = settings_for(tmp_path)
    raw = b"password=private-original\n" + b"Observed timeout\n" * 1500
    with TestClient(create_app(settings)) as client:
        uploaded = client.post("/api/v1/files", headers=token(), files={"files": ("events.log", raw)}).json()
        chat_id = uploaded["chat_id"]
        artifact_id = uploaded["attachments"][0]["artifact_id"]
        base = f"/api/v1/chats/{chat_id}/artifacts/{artifact_id}"
        response = client.get(base + "/preview", headers=token())
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview["filename"] == "events.log" and preview["truncated"]
        assert len(preview["text"]) == settings.max_evidence_chars
        assert "private-original" not in preview["text"] and "[REDACTED]" in preview["text"]
        assert client.get(base + "/preview", headers=token("admin")).status_code == 404
        assert client.get(base + "/preview").status_code == 401
    with TestClient(create_app(settings)) as client:
        assert client.get(base + "/preview", headers=token()).json() == preview
        with sqlite3.connect(tmp_path / "runs.db") as database:
            database.execute("UPDATE chat_artifacts SET processed_expires_at=? WHERE artifact_id=?", (time.time() - 1, artifact_id))
        assert client.get(base + "/preview", headers=token()).status_code == 410
        assert client.get(base + "/download", headers=token()).content == raw


def test_preview_rejects_processed_blob_corruption(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        uploaded = client.post("/api/v1/files", headers=token(), files={"files": ("test.txt", b"Observed timeout")}).json()
        record = uploaded["attachments"][0]
        root = Path(settings.artifact_uri("chats")) / uploaded["chat_id"] / "uploads" / "processed"
        next(root.rglob("*.json")).write_text('{"text":"tampered"}')
        result = client.get(f"/api/v1/chats/{uploaded['chat_id']}/artifacts/{record['artifact_id']}/preview", headers=token())
        assert result.status_code == 503
