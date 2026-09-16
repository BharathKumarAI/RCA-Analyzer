"""Live execution is the default; bounded readiness is distinct from liveness."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.api.routes.catalog import health, ready
from app.configuration import deployment_settings
from app.settings import Settings


def test_runtime_defaults_live_and_simulation_requires_explicit_choice(monkeypatch, tmp_path):
    monkeypatch.setattr(deployment_settings, "DEPLOYMENT_SETTINGS_PATH", tmp_path / "deployment.yaml")
    for key in ("RCA_MODE", "RCA_CONTENT_ROOT", "RCA_CONFIG_DIR", "RCA_DATABASE_CONFIGURATION"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("RCA_PRINCIPALS_JSON", "{}")
    assert Settings().mode == deployment_settings.DeploymentSettings().mode == "live"
    assert Settings.from_env().mode == "live"
    monkeypatch.setenv("RCA_MODE", "demo")
    assert Settings.from_env().mode == "demo"


@pytest.mark.asyncio
async def test_readiness_reports_configuration_and_times_out_storage_without_affecting_liveness():
    class Store:
        blocked = False

        async def ping(self):
            if self.blocked:
                await asyncio.Event().wait()

    store = Store()
    settings = SimpleNamespace(auth_configured=True, mode="live", health_timeout_seconds=0.01)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(store=store, settings=settings)))
    response = await ready(request)
    assert response.status_code == 200
    assert json.loads(response.body) == {"ready": True, "mode": "live", "live_execution": True}
    settings.mode = "demo"
    assert json.loads((await ready(request)).body)["live_execution"] is False
    settings.auth_configured = False
    assert (await ready(request)).status_code == 503
    settings.auth_configured = True
    store.blocked = True
    assert (await ready(request)).status_code == 503
    assert await health() == {"status": "alive"}
