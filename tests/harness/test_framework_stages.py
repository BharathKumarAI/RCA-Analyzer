"""Approval moves stage copies without activating unreviewed framework content."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from tests.support import settings_for
from tests.harness.test_approved_execution import SOURCE


def test_approval_rejection_revocation_and_repair(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:

        def submit():
            response = client.post(
                "/api/v1/agent-configurations",
                headers=token("owner"),
                json={"yaml": SOURCE},
            )
            assert response.status_code == 201, response.text
            return response.json()

        draft = submit()
        root = Path(settings.artifact_uri("framework-uploads")) / "agents"
        name = draft["content_hash"][7:] + ".yaml"

        def location(stage):
            return root / stage / draft["draft_id"] / name

        assert location("pending-approval").is_file()
        payload = {"expected_hash": draft["content_hash"], "reason": "Reviewed offline"}
        assert (
            client.post(
                f"/api/v1/agent-configurations/{draft['draft_id']}/approve",
                headers=token("owner"),
                json=payload,
            ).status_code
            == 403
        )
        assert location("pending-approval").is_file()
        assert (
            client.post(
                f"/api/v1/agent-configurations/{draft['draft_id']}/approve",
                headers=token("admin"),
                json=payload,
            ).status_code
            == 200
        )
        assert location("approved").is_file()
        assert not location("pending-approval").exists()
        assert (
            client.post(
                f"/api/v1/agent-configurations/{draft['draft_id']}/revoke",
                headers=token("admin"),
                json={"reason": "Replaced"},
            ).status_code
            == 200
        )
        assert location("revoked").is_file()
        assert not location("approved").exists()
        canonical = Path(settings.config_blob_uri) / name
        assert canonical.read_bytes() == location("revoked").read_bytes()
        second = submit()

        async def fail(*args):
            raise OSError("storage unavailable")

        stages = app.state.configurations.stage_store
        original = stages.sync
        monkeypatch.setattr(stages, "sync", fail)
        rejected = client.post(
            f"/api/v1/agent-configurations/{second['draft_id']}/reject",
            headers=token("admin"),
            json={"expected_hash": second["content_hash"], "reason": "Unsuitable"},
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "REJECTED"
        monkeypatch.setattr(stages, "sync", original)
        client.portal.call(
            app.state.configurations.sync_stage,
            second["draft_id"],
            settings.principals["admin"],
        )
        assert (root / "rejected" / second["draft_id"] / name).is_file()
        assert not (root / "pending-approval" / second["draft_id"] / name).exists()
