"""Original uploads survive restart while chat ownership and retention hold."""

import asyncio
import hashlib
import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from app.persistence.chat_artifacts import ChatArtifactStore
from app.persistence.store import InvestigationStore
from tests.support import settings_for


def test_raw_upload_restart_history_and_owner_isolation(tmp_path):
    settings, token = settings_for(tmp_path)
    raw = b"ERROR timeout password=private-original\r\n"
    with TestClient(create_app(settings)) as client:
        assert (
            client.post("/api/v1/files", files={"files": ("test.log", raw)}).status_code
            == 401
        )
        uploaded = client.post(
            "/api/v1/files", headers=token(), files={"files": ("test.log", raw)}
        )
        assert uploaded.status_code == 201, uploaded.text
        body = uploaded.json()
        chat_id = body["chat_id"]
        record = body["attachments"][0]
        assert record["sha256"] == hashlib.sha256(raw).hexdigest()
        run = client.post(
            "/api/v1/runs",
            headers=token(),
            json={"prompt": "Inspect", "attachment_ids": [record["attachment_id"]]},
        ).json()
        assert run["chat_id"] == chat_id
        assert run["status"] == "SIMULATED"
        assert (
            client.get(f"/api/v1/chats/{chat_id}/runs", headers=token()).json()[0][
                "run_id"
            ]
            == run["run_id"]
        )
        for owner in ("owner", "admin", "viewer"):
            assert (
                client.get(
                    f"/api/v1/chats/{chat_id}/artifacts", headers=token(owner)
                ).status_code
                == 404
            )
            assert client.post(
                "/api/v1/files",
                headers=token(owner),
                data={"chat_id": chat_id},
                files={"files": ("test.log", raw)},
            ).status_code in (403, 404)
        other = client.post("/api/v1/chats", headers=token()).json()["chat_id"]
        rejected = client.post(
            "/api/v1/runs",
            headers=token(),
            json={
                "prompt": "Inspect",
                "chat_id": other,
                "attachment_ids": [record["attachment_id"]],
            },
        )
        assert rejected.status_code == 403
    with sqlite3.connect(tmp_path / "runs.db") as db:
        extracted = db.execute("SELECT payload_json FROM attachments").fetchone()[0]
        assert "private-original" not in extracted
        assert "text" not in json.loads(extracted)
        assert len(list(Path(settings.artifact_uri("chats")).rglob("*.json"))) == 2
    download = f"/api/v1/chats/{chat_id}/artifacts/{record['artifact_id']}/download"
    with TestClient(create_app(settings)) as client:
        hydrated = client.post(
            "/api/v1/runs",
            headers=token(),
            json={
                "prompt": "Inspect again",
                "attachment_ids": [record["attachment_id"]],
            },
        )
        assert hydrated.status_code == 200, hydrated.text
        assert hydrated.json()["status"] == "SIMULATED"
        assert client.get("/api/v1/chats", headers=token()).json()
        assert (
            client.get(f"/api/v1/chats/{chat_id}/artifacts", headers=token()).json()[0][
                "artifact_id"
            ]
            == record["artifact_id"]
        )
        response = client.get(download, headers=token())
        assert response.content == raw
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert client.get(download, headers=token("admin")).status_code == 404
        path = next(Path(settings.artifact_uri("chats")).rglob("*.bin"))
        path.write_bytes(b"tampered")
        assert client.get(download, headers=token()).status_code == 503


def test_cleanup_keeps_live_duplicate_and_is_retryable(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        uploads = [
            client.post(
                "/api/v1/files",
                headers=token(),
                files={"files": ("same.txt", b"same original")},
            ).json()
            for _ in range(2)
        ]
    expired_id = uploads[0]["attachments"][0]["artifact_id"]
    with sqlite3.connect(tmp_path / "runs.db") as db:
        db.execute(
            "UPDATE chat_artifacts SET expires_at=? WHERE artifact_id=?",
            (time.time() - 1, expired_id),
        )
        db.execute("UPDATE attachments SET expires_at=?", (time.time() - 1,))

    async def exercise():
        store = InvestigationStore(settings.database_url.get_secret_value())
        artifacts = ChatArtifactStore(store, settings, 1024)
        try:
            assert await artifacts.cleanup() == 1
            original = artifacts._blobs

            def failing(*args):
                raise OSError("storage unavailable")

            monkeypatch.setattr(artifacts, "_blobs", failing)
            with pytest.raises(OSError):
                await artifacts.cleanup(apply=True)
            assert await artifacts.cleanup() == 1
            monkeypatch.setattr(artifacts, "_blobs", original)
            assert await artifacts.cleanup(apply=True) == 1
            assert await artifacts.cleanup(apply=True) == 0
            await store.delete_expired(90 * 86400)
        finally:
            await store.aclose()

    asyncio.run(exercise())
    assert len(list(Path(settings.artifact_uri("chats")).rglob("*.bin"))) == 1
    with TestClient(create_app(settings)) as client:
        for i, upload in enumerate(uploads):
            url = f"/api/v1/chats/{upload['chat_id']}/artifacts/{upload['attachments'][0]['artifact_id']}/download"
            response = client.get(url, headers=token())
            assert response.status_code == (404 if i == 0 else 200)
            if i == 1:
                assert response.content == b"same original"


def test_processed_and_created_are_separate_from_raw(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        upload = client.post(
            "/api/v1/files",
            headers=token(),
            files={"files": ("sample.txt", b"password=raw-secret\nERROR")},
        ).json()
        chat = upload["chat_id"]
        run = client.post(
            "/api/v1/runs", headers=token(), json={"prompt": "Inspect", "chat_id": chat}
        ).json()
        root = Path(settings.artifact_uri("chats")) / chat
        raw = next((root / "uploads/raw").rglob("*.bin"))
        processed = next((root / "uploads/processed").rglob("*.json"))
        created = next((root / "created/simulated").rglob("*.json"))
        assert b"raw-secret" in raw.read_bytes()
        assert "raw-secret" not in processed.read_text()
        assert run["run_id"] in created.read_text()
        url = f"/api/v1/chats/{chat}/created/{run['run_id']}/download"
        expected = created.read_bytes()
        created.unlink()
        response = client.get(url, headers=token())
        assert response.status_code == 200
        assert response.content == expected
        assert created.read_bytes() == expected
        assert client.get(url, headers=token("admin")).status_code == 404
    with sqlite3.connect(tmp_path / "runs.db") as db:
        db.execute(
            "UPDATE chat_artifacts SET processed_expires_at=?", (time.time() - 1,)
        )

    async def clean_processed():
        store = InvestigationStore(settings.database_url.get_secret_value())
        try:
            assert (
                await ChatArtifactStore(store, settings, 1024).cleanup(apply=True) == 0
            )
        finally:
            await store.aclose()

    asyncio.run(clean_processed())
    assert not processed.exists()
    assert raw.exists()
    assert created.exists()
