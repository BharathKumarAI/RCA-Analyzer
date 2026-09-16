"""Usage comes from native provider metadata, with explicit price and scope coverage."""

import asyncio
from datetime import datetime, timedelta, timezone
import json
import ssl

from fastapi.testclient import TestClient
from google.genai import types
from google.adk.models.llm_response import LlmResponse
import httpx2
from sqlalchemy import select, update

from app.api.application import create_app
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from app.persistence.telemetry import telemetry
from app.persistence.store import runs
from app.identity.principals import Role
from scripts.dev_connector_servers import ConnectorMockServer
from tests.support import FixtureModel, connectors, settings_for


def reviewed_settings(tmp_path, mode="live"):
    settings, token = settings_for(tmp_path, mode=mode)
    reviewer = settings.principals["admin"].model_copy(update={"subject": "reviewer", "username": "reviewer", "roles": (Role.PLATFORM_ADMIN,)})
    return settings.model_copy(update={"principals": settings.principals | {"reviewer": reviewer}}), token


class UsageModel(FixtureModel):
    async def generate_content_async(self, llm_request, stream=False):
        async for response in super().generate_content_async(llm_request, stream):
            response.usage_metadata = types.GenerateContentResponseUsageMetadata(
                prompt_token_count=100, candidates_token_count=40, thoughts_token_count=10,
                total_token_count=150, cached_content_token_count=25,
            )
            yield response


def factory(stage, config):
    return UsageModel(model=config.model, stage=stage)


def prices(client, token, rate=2, revision=0):
    profiles = client.app.state.runner.profiles
    names = {stage.model for stage in profiles.stages.values()}
    response = client.put("/api/v1/telemetry/pricing", headers=token("admin"), json={
        "expected_revision": revision,
        "rates": {model: {"input_per_million": rate, "output_per_million": 6,
                           "cached_input_per_million": .5} for model in names},
    })
    assert response.status_code == 200, response.text
    proposal = response.json()
    reviewed = client.post("/api/v1/telemetry/pricing/approve", headers=token("reviewer"), json={
        "expected_hash": proposal["proposal"]["content_hash"], "reason": "Verified the configured prices for the model contracts.",
    })
    assert reviewed.status_code == 200, reviewed.text
    return reviewed.json()


def run(client, token, **changes):
    response = client.post("/api/v1/runs", headers=token(), json={
        "capability": "ticket_review", "prompt": "Explain the customer impact briefly.",
        "incident_id": "SAMSON-101",
    } | changes)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUCCEEDED", response.text
    return response.json()


def test_real_model_metadata_is_counted_once_priced_and_frozen_with_scope_and_date_filters(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=factory)) as client:
        assert client.get("/api/v1/telemetry/pricing", headers=token()).json()["rates"] == {}
        price = prices(client, token)
        result = run(client, token)
        report = client.get("/api/v1/telemetry", headers=token()).json()
        metrics = report["summary"]
        assert metrics["runs"] == 1 and metrics["model_calls"] > 0
        calls = metrics["model_calls"]
        assert metrics["usage_reported_calls"] == calls
        assert all(count == calls for count in metrics["reported_token_fields"].values())
        assert metrics["input_tokens"] == calls * 100
        assert metrics["output_tokens"] == calls * 40
        assert metrics["thinking_tokens"] == calls * 10
        assert metrics["total_tokens"] == calls * 150
        assert metrics["cached_input_tokens"] == calls * 25
        assert metrics["cache_hits"] == calls and metrics["cache_hit_rate"] == 1
        assert metrics["estimated_cost_usd"] == round(calls * .0004625, 8)
        assert metrics["model_latency"]["mean_duration_ms"] >= 0
        assert report["agents"] and report["tools"]
        assert report["coverage"]["truncated"] is False
        trace = client.get(f"/api/v1/runs/{result['run_id']}/trace", headers=token()).json()["events"]
        assert sum(event["kind"] == "model_completed" for event in trace) == calls
        assert sum(event["kind"] == "model_started" for event in trace) == calls
        # Existing ADK agent events may repeat metadata; totals never double count it.
        assert any(event["kind"] == "agent_event" and event["details"].get("usage") for event in trace)
        prices(client, token, rate=200, revision=price["revision"])
        assert client.get("/api/v1/telemetry", headers=token()).json()["summary"]["estimated_cost_usd"] == metrics["estimated_cost_usd"]
        synthesis = client.get("/api/v1/telemetry?stage=synthesis", headers=token()).json()
        assert len(synthesis["by_stage"]) == 1 and synthesis["by_stage"][0]["stage"] == "synthesis"
        assert synthesis["summary"]["model_calls"] < calls
        assert client.get("/api/v1/telemetry?capability=attachment_review", headers=token()).json()["summary"]["runs"] == 0
        past = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        assert client.get(f"/api/v1/telemetry?start={past}&end={past}", headers=token()).json()["summary"]["runs"] == 0
        other = settings.principals["viewer"].model_copy(update={"project_id": "outside"})
        today = datetime.now(timezone.utc).date()
        assert asyncio.run(telemetry(client.app.state.store.engine, other, today, today))["summary"]["runs"] == 0
        billing = client.get("/api/v1/billing", headers=token()).json()
        assert billing["usage"]["measured_tokens_processed"] == calls * 150
        assert "estimated_tokens_processed" not in billing["usage"]


def test_missing_usage_prices_and_cache_are_unknown_and_pricing_requires_admin_revision(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=lambda stage, config: FixtureModel(model=config.model, stage=stage))) as client:
        run(client, token)
        summary = client.get("/api/v1/telemetry", headers=token()).json()["summary"]
        assert summary["model_calls"] > 0
        assert summary["usage_unknown_calls"] == summary["model_calls"]
        assert all(count == 0 for count in summary["reported_token_fields"].values())
        assert summary["estimated_cost_usd"] is None and summary["known_cost_usd"] == 0
        assert summary["cache_hit_rate"] is None and summary["cache_unknown_calls"] == summary["model_calls"]
        assert client.get("/api/v1/billing", headers=token()).json()["usage"]["month_to_date_spend_usd"] is None
        payload = {"expected_revision": 0, "rates": {"test": {"input_per_million": 2, "output_per_million": 6}}}
        assert client.put("/api/v1/telemetry/pricing", headers=token("owner"), json=payload).status_code == 403
        pending = client.put("/api/v1/telemetry/pricing", headers=token("admin"), json=payload)
        assert pending.status_code == 200
        assert pending.json()["rates"] == {} and pending.json()["proposal"]["status"] == "PENDING"
        review_body = {"expected_hash": pending.json()["proposal"]["content_hash"], "reason": "Verified prices"}
        assert client.post("/api/v1/telemetry/pricing/approve", headers=token("admin"), json=review_body).status_code == 403
        assert client.post("/api/v1/telemetry/pricing/approve", headers=token("reviewer"), json=review_body).status_code == 200
        revoked = client.post("/api/v1/telemetry/pricing/revoke", headers=token("admin"), json=review_body)
        assert revoked.status_code == 200 and revoked.json()["rates"] == {}
        assert client.put("/api/v1/telemetry/pricing", headers=token("admin"), json=payload).status_code == 409
        payload["rates"]["test"]["input_per_million"] = -1
        assert client.put("/api/v1/telemetry/pricing", headers=token("admin"), json=payload).status_code == 422
        assert client.get("/api/v1/telemetry?start=2020-01-01&end=2026-01-01", headers=token()).status_code == 422
        assert client.get("/api/v1/telemetry?mode=unknown", headers=token()).status_code == 422


def test_tls_connectors_approved_knowledge_and_native_analysis_complete_one_cited_run(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    captured = []
    class LocalModel(UsageModel):
        async def generate_content_async(self, llm_request, stream=False):
            captured.append(str(llm_request.config.system_instruction))
            async for response in super().generate_content_async(llm_request, stream):
                for part in response.content.parts or []:
                    if part.function_call and part.function_call.name == "get_ticket":
                        part.function_call.args["ticket_id"] = "LOCAL-1"
                yield response
    with ConnectorMockServer(tmp_path / "tls") as server:
        trust = ssl.create_default_context(cafile=str(server.cert_path))
        providers = {
            "itsm": JiraConnector(base_url=server.endpoint, project_key="LOCAL", user_email=server.account, api_token=server.token,
                client=httpx2.AsyncClient(base_url=server.endpoint, verify=trust, trust_env=False)),
            "log_search": SplunkConnector(endpoint=server.endpoint, token=server.token, index="local_test",
                client=httpx2.AsyncClient(base_url=server.endpoint, verify=trust, trust_env=False)),
        }
        with TestClient(create_app(settings, connectors=providers, model_factory=lambda stage, config: LocalModel(stage=stage, model=config.model))) as client:
            item = client.post("/api/v1/knowledge", headers=token("owner"), json={
                "title": "Checkout customer guidance", "content": "For checkout customer impact, inspect queue pressure. Distinguish current observations from old guidance.",
            }).json()
            body = {"expected_hash": item["content_hash"], "reason": "Reviewed local guidance"}
            assert client.post(f"/api/v1/knowledge/{item['id']}/submit", headers=token("owner"), json=body).status_code == 200
            assert client.post(f"/api/v1/knowledge/{item['id']}/approve", headers=token("admin"), json=body).status_code == 200
            response = client.post("/api/v1/runs?stream=true", headers=token(), json={
                "prompt": "What happened to checkout customers? Give me the short answer and what to check next.",
                "incident_id": "LOCAL-1", "capability": "incident_triage",
            })
            assert response.status_code == 200, response.text
            assert "event: run\n" in response.text and "event: complete\n" in response.text
            complete = [json.loads(chunk.split("data: ", 1)[1]) for chunk in response.text.strip().split("\n\n") if "\nevent: complete\n" in "\n" + chunk][0]
            assert complete["status"] == "SUCCEEDED", complete
            evidence = client.get(f"/api/v1/runs/{complete['run_id']}/evidence", headers=token()).json()
            assert {item["source"]["connector"] for item in evidence} == {"itsm", "log_search", "knowledge"}
            assert len(complete["result"]["summary"]) < 500
            assert complete["result"]["recommended_actions"] and complete["result"]["uncertainties"]
            assert set(complete["result"]["findings"][0]["evidence_ids"]) == {item["evidence_id"] for item in evidence}
            assert any("inspect queue pressure" in instruction for instruction in captured)
            assert "/rest/api/3/issue/LOCAL-1" in server.requests
            assert "/services/search/jobs/export" in server.requests


def test_incomplete_and_legacy_coverage_never_show_zero_cost_in_groups(tmp_path, monkeypatch):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=factory)) as client:
        prices(client, token)
        result = run(client, token)
        # A durable start without a terminal call record represents an interrupted call.
        asyncio.run(client.app.state.run_events.append(result["run_id"], settings.principals["analyst"],
            "model:balanced-investigation", "model_started", {"call_id": "interrupted", "model": "unpriced", "stage": "synthesis"}))
        report = client.get("/api/v1/telemetry", headers=token()).json()
        assert report["summary"]["estimated_cost_usd"] is None
        assert report["summary"]["unfinished_model_calls"] == 1
        assert report["daily"][0]["estimated_cost_usd"] is None
        assert report["by_capability"][0]["estimated_cost_usd"] is None
        assert next(row for row in report["by_stage"] if row["stage"] == "synthesis")["estimated_cost_usd"] is None
        async def make_legacy():
            async with client.app.state.store.engine.begin() as connection:
                raw = await connection.scalar(select(runs.c.contract_json).where(runs.c.run_id == result["run_id"]))
                contract = json.loads(raw)
                snapshot = json.loads(contract["model_config_json"])
                snapshot.pop("model_telemetry_version")
                contract["model_config_json"] = json.dumps(snapshot)
                await connection.execute(update(runs).where(runs.c.run_id == result["run_id"]).values(contract_json=json.dumps(contract)))
        asyncio.run(make_legacy())
        legacy = client.get("/api/v1/telemetry?stage=triage", headers=token()).json()
        assert legacy["summary"]["estimated_cost_usd"] is None
        assert legacy["by_stage"][0]["estimated_cost_usd"] is None
        assert legacy["by_model"][0]["estimated_cost_usd"] is None
        monkeypatch.setattr("app.persistence.telemetry.EVENT_LIMIT", 2)
        bounded = client.get("/api/v1/telemetry", headers=token()).json()
        assert bounded["coverage"]["truncated"] is True
        assert bounded["daily"][0]["estimated_cost_usd"] is None


def test_provider_error_is_counted_as_failure_when_adk_closes_the_model_generator(tmp_path):
    class ErrorModel(FixtureModel):
        async def generate_content_async(self, llm_request, stream=False):
            if self.stage == "triage":
                yield LlmResponse(error_code="503", error_message="Offline provider failure test")
            else:
                async for response in super().generate_content_async(llm_request, stream):
                    yield response
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=lambda stage, config: ErrorModel(stage=stage, model=config.model))) as client:
        response = client.post("/api/v1/runs", headers=token(), json={
            "capability": "ticket_review", "prompt": "Check the current impact", "incident_id": "SAMSON-101",
        })
        assert response.status_code == 200 and response.json()["status"] == "FAILED"
        summary = client.get("/api/v1/telemetry", headers=token()).json()["summary"]
        assert summary["failed_model_calls"] == 1
        assert summary["cancelled_model_calls"] == 0
        assert summary["estimated_cost_usd"] is None


def test_budget_edit_cannot_replace_a_newer_reviewed_price_or_pending_proposal(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        original = prices(client, token)
        replacement = prices(client, token, rate=4, revision=original["revision"])
        proposed = client.put("/api/v1/telemetry/pricing", headers=token("admin"), json={
            "expected_revision": replacement["revision"],
            "rates": {"new-model": {"input_per_million": 8, "output_per_million": 9}},
        }).json()
        assert proposed["proposal"]["status"] == "PENDING"
        for actor in ("admin", "owner"):
            stale_budget = client.put("/api/v1/billing", headers=token(actor), json={
                "monthly_spend_budget": 777, "pricing_matrix": original["rates"],
            })
            assert stale_budget.status_code == 422, stale_budget.text
            saved = client.put("/api/v1/billing", headers=token(actor), json={"monthly_spend_budget": 777})
            assert saved.status_code == 200, saved.text
            assert saved.json()["monthly_spend_budget"] == 777
            current = client.get("/api/v1/telemetry/pricing", headers=token("admin")).json()
            assert current == proposed


def test_each_token_counter_reports_its_own_coverage_when_provider_only_reports_input(tmp_path):
    class InputOnlyModel(FixtureModel):
        async def generate_content_async(self, llm_request, stream=False):
            async for response in super().generate_content_async(llm_request, stream):
                response.usage_metadata = types.GenerateContentResponseUsageMetadata(prompt_token_count=100)
                yield response
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=lambda stage, config: InputOnlyModel(stage=stage, model=config.model))) as client:
        run(client, token)
        report = client.get("/api/v1/telemetry", headers=token()).json()
        for row in [report["summary"], *report["by_stage"], *report["by_model"], *report["by_capability"], *report["daily"]]:
            assert row["input_tokens"] == row["model_calls"] * 100
            assert row["reported_token_fields"]["input_tokens"] == row["model_calls"]
            assert row["usage_reported_calls"] == row["model_calls"]
            for field in ("output_tokens", "total_tokens", "thinking_tokens", "cached_input_tokens"):
                assert row["reported_token_fields"][field] == 0
            assert row["estimated_cost_usd"] is None
