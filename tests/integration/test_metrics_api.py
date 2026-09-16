"""Integration tests for SRE and Platform Metrics endpoints."""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import insert, update

from fastapi.testclient import TestClient
from app.api.application import create_app
from app.identity.principals import Role
from app.persistence.store import runs
from app.persistence.triage import triage_queue_stays, triage_tickets
from app.runtime.run_contract import RunContract, RunRequest
from tests.support import connectors, settings_for


def setup_app(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    reviewer = settings.principals["admin"].model_copy(
        update={"subject": "reviewer", "username": "reviewer", "roles": (Role.PLATFORM_ADMIN,)}
    )
    viewer = settings.principals["viewer"].model_copy(
        update={"subject": "viewer", "username": "viewer", "roles": (Role.PROJECT_VIEWER,)}
    )
    analyst = settings.principals["analyst"].model_copy(
        update={"subject": "analyst", "username": "analyst", "roles": (Role.PROJECT_ANALYST,)}
    )
    configured_settings = settings.model_copy(
        update={"principals": settings.principals | {"reviewer": reviewer, "viewer": viewer, "analyst": analyst}}
    )
    app = create_app(configured_settings, connectors=connectors())
    return app, token


def test_project_metrics_endpoint_returns_sre_telemetry(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        res = client.get("/api/v1/metrics", headers=token("analyst"))
        assert res.status_code == 200, res.text
        data = res.json()
        assert "summary" in data
        assert "sre_metrics" in data
        assert "daily" in data
        assert "coverage" in data

        sre = data["sre_metrics"]
        assert "mttt" in sre
        assert "mttr" in sre
        assert "sla_compliance_rate" in sre
        assert "tickets_total" in sre
        assert "tickets_resolved" in sre
        assert "tickets_active" in sre
        assert "priority_breakdown" in sre
        assert "analyst_validation" in sre
        assert "auto_triage" in sre


def test_project_metrics_window_filters(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        for window in ["24h", "7d", "30d", "90d"]:
            res = client.get(f"/api/v1/metrics?window={window}", headers=token("analyst"))
            assert res.status_code == 200, res.text
            data = res.json()
            assert data["filters"]["start"] is not None
            assert data["filters"]["end"] is not None


def test_platform_metrics_authorization_enforced(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        # Analyst without PLATFORM_ADMIN must receive 403
        forbidden_res = client.get("/api/v1/metrics/platform", headers=token("analyst"))
        assert forbidden_res.status_code == 403

        # Viewer without PLATFORM_ADMIN must receive 403
        viewer_res = client.get("/api/v1/metrics/platform", headers=token("viewer"))
        assert viewer_res.status_code == 403
        assert client.get("/api/v1/metrics/platform", headers=token("owner")).status_code == 403

        # Platform administrator must receive 200
        admin_res = client.get("/api/v1/metrics/platform", headers=token("admin"))
        assert admin_res.status_code == 200, admin_res.text
        admin_data = admin_res.json()
        assert "totals" in admin_data
        assert "projects" in admin_data
        assert "tools" in admin_data
        assert "coverage" in admin_data
        assert "overall_run_latency" in admin_data["totals"]


def test_rolling_windows_are_half_open_and_share_platform_boundaries(tmp_path, monkeypatch):
    import app.persistence.telemetry as module

    now = datetime(2026, 9, 16, 12, tzinfo=timezone.utc)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 9, 16, 12, tzinfo=timezone.utc)

    monkeypatch.setattr(module, "datetime", FixedDatetime)
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        principal = app.state.settings.principals["analyst"]

        async def seed():
            for offset, subject in [
                (-86401, principal), (-86400, principal), (-1, principal), (0, principal),
                (-1, principal.model_copy(update={"project_id": "second"})),
                (-1, principal.model_copy(update={"tenant_id": "outside"})),
            ]:
                contract = RunContract(
                    tenant_id=subject.tenant_id, project_id=subject.project_id, principal=subject,
                    request=RunRequest(text="Boundary verification"), capability="incident_triage",
                    capability_version="1", capability_hash="sha256:cap", policy_hash="sha256:policy",
                    model_profile="test", model_config_json='{"model_telemetry_version":1}',
                    data_scope=f"tenant:{subject.tenant_id}/project:{subject.project_id}", mode="live",
                )
                run, _ = await app.state.store.create_run(contract, None, "boundary", now.timestamp() + 60)
                async with app.state.store.engine.begin() as connection:
                    await connection.execute(update(runs).where(runs.c.run_id == run.run_id).values(
                        created_at=now.timestamp() + offset, updated_at=now.timestamp() + offset, status="SUCCEEDED"))

        client.portal.call(seed)
        for endpoint in ("metrics", "telemetry", "metrics/platform"):
            data = client.get(f"/api/v1/{endpoint}?window=24h", headers=token("admin")).json()
            assert data["filters"]["start_at"] == now.timestamp() - 86400
            assert data["filters"]["end_at"] == now.timestamp()
            assert data["filters"]["end_exclusive"] is True
            assert data["coverage"]["matched_runs"] == (3 if endpoint.endswith("platform") else 2)
            explicit = client.get(f"/api/v1/{endpoint}?window=90d&start=2026-09-16&end=2026-09-16",
                                  headers=token("admin")).json()
            assert explicit["filters"]["end_at"] - explicit["filters"]["start_at"] == 86400
            assert explicit["coverage"]["matched_runs"] == (3 if endpoint.endswith("platform") else 2)
            assert client.get(f"/api/v1/{endpoint}?start=2026-09-17&end=2026-09-16",
                              headers=token("admin")).status_code == 422
        for window, days in (("7d", 7), ("30d", 30), ("90d", 90)):
            begin, finish = module.metrics_window(window=window)
            assert module.time_bounds(begin, finish) == (now.timestamp() - days * 86400, now.timestamp())
        assert module.time_bounds(date(2026, 9, 16), date(2026, 9, 16))[1] == (now + timedelta(hours=12)).timestamp()


def test_sla_requires_saved_targets_and_separates_open_obligations(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        now = datetime.now(timezone.utc).timestamp()

        async def seed():
            async with app.state.store.engine.begin() as connection:
                await connection.execute(insert(triage_tickets), [
                    {"ticket_id": str(index), "tenant_id": "acme", "project_id": "payments",
                     "summary": "SLA verification", "priority": "P1", "work_state": status,
                     "created_at": now - elapsed, "updated_at": now}
                    for index, (status, elapsed) in enumerate([
                        ("RESOLVED", 3600), ("RESOLVED", 3600), ("NEW", 3600), ("NEW", 40 * 86400),
                    ])
                ])

        client.portal.call(seed)
        unknown = client.get("/api/v1/metrics", headers=token()).json()["sre_metrics"]
        assert unknown["sla_compliance_rate"] is None and unknown["ongoing_breaches"] is None
        assert unknown["mttt"]["mean_duration_ms"] is None
        assert unknown["mttr"]["mean_duration_ms"] is None and unknown["mttr_samples"] == 0

        async def add_recorded_intervals():
            async with app.state.store.engine.begin() as connection:
                await connection.execute(insert(triage_queue_stays), [
                    {"stay_id": f"stay-{index}", "ticket_id": str(index), "tenant_id": "acme", "project_id": "payments",
                     "entered_at": now - duration, "exited_at": now if index < 2 else None,
                     "accountable_duration": duration if index < 2 else 0,
                     "reason": "Added from recorded investigation", "created_at": now - duration}
                    for index, duration in enumerate([10, 120, 10, 10])
                ])
                # An old stay still consumes the active backlog ticket's queue budget.
                await connection.execute(insert(triage_queue_stays).values(
                    stay_id="old-stay", ticket_id="3", tenant_id="acme", project_id="payments",
                    entered_at=now - 40 * 86400, exited_at=now - 40 * 86400 + 120,
                    accountable_duration=120, reason="Initial queue visit", created_at=now - 40 * 86400))
                # Real source resolution is independent of mutable local updated_at/work_state.
                await connection.execute(update(triage_tickets).where(triage_tickets.c.ticket_id == "2").values(
                    custom_fields={"source_created_at": now - 1000, "source_resolved_at": now - 100}))
                await connection.execute(update(triage_tickets).where(triage_tickets.c.ticket_id == "1").values(
                    custom_fields={"source_created_at": now, "source_resolved_at": now - 100}))

        client.portal.call(add_recorded_intervals)
        configured = client.put("/api/v1/parameters/triage/sla_targets_seconds/definition", headers=token("admin"), json={
            "value_type": "json", "default_value": {"P1": 60}, "description": "Queue consumption target in seconds",
        })
        assert configured.status_code == 200, configured.text
        for endpoint in ("metrics", "telemetry"):
            report = client.get(f"/api/v1/{endpoint}", headers=token()).json()
            measured = report["sre_metrics"]
            assert measured["sla_compliance_rate"] == 0.5
            assert measured["sla_evaluated_tickets"] == 2
            assert measured["sla_active_evaluated_tickets"] == 2
            assert measured["ongoing_breaches"] == 1
            assert measured["mttt_samples"] == 2 and measured["mttt"]["mean_duration_ms"] == 65000
            assert measured["mttr_samples"] == 1 and measured["mttr"]["mean_duration_ms"] == 900000
            assert sum(day.get("tickets", 0) for day in report["daily"]) == 3
            assert sum(day.get("resolved_tickets", 0) for day in report["daily"]) == 1


def test_pruned_run_traces_keep_aggregate_cost_and_coverage_incomplete(tmp_path, monkeypatch):
    monkeypatch.setattr("app.persistence.run_events.MAX_EVENTS_PER_RUN", 1)
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        run = client.post("/api/v1/runs", headers=token(), json={"prompt": "Inspect source availability"}).json()
        principal = app.state.settings.principals["analyst"]
        for _ in range(3):
            client.portal.call(app.state.run_events.append, run["run_id"], principal, "node", "started", {})
        for endpoint in ("metrics", "metrics/platform"):
            report = client.get(f"/api/v1/{endpoint}", headers=token("admin")).json()
            assert report["coverage"]["truncated"] is True
            assert report["coverage"]["runs_with_truncated_trace"] == 1
            summary = report["totals"] if endpoint.endswith("platform") else report["summary"]
            assert summary["estimated_cost_usd"] is None
