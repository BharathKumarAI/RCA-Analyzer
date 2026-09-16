"""Capture settings and ordering remain safe under retries and delayed refreshes."""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.knowledge_structure import KnowledgeStructure, structure_from_markdown
from app.configuration.parameters import ParameterStore
from app.runtime.run_contract import content_hash
from tests.integration.test_knowledge_lifecycle import approve, draft
from tests.support import connectors, settings_for


@pytest.mark.parametrize("name,value", [
    ("closure_deviation_threshold", True), ("closure_min_confidence", -0.1),
    ("closure_deviation_threshold", float("nan")), ("closure_min_confidence", 1.01),
    ("closure_judge_stage", " "), ("closure_judge_stage", "x" * 129),
    ("closure_judge_instruction", "x" * 16001),
])
def test_closure_parameters_reject_invalid_values_at_write_boundary(name, value):
    with pytest.raises(ValueError):
        ParameterStore.runtime_value("knowledge", name, value)


def test_capture_settings_use_scoped_revision_checked_parameters(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        endpoint = "/api/v1/knowledge/settings"
        saved = client.get(endpoint, headers=token("owner")).json()
        assert saved["lookback_months"] == 3 and saved["revision"] is None
        payload = {"lookback_months": 6, "expected_revision": saved["revision"], "expected_definition_revision": saved["definition_revision"]}
        assert client.put(endpoint, headers=token("viewer"), json=payload).status_code == 403
        updated = client.put(endpoint, headers=token("owner"), json=payload)
        assert updated.status_code == 200, updated.text
        assert updated.json()["lookback_months"] == 6 and updated.json()["revision"] == 1
        assert client.put(endpoint, headers=token("owner"), json=payload).status_code == 409
        assert client.put(endpoint, headers=token("owner"), json=payload | {"lookback_months": 25}).status_code == 422
        assert client.put(endpoint, headers=token("owner"), json=payload | {"lookback_months": True}).status_code == 422


def test_late_source_snapshot_cannot_reactivate_obsolete_guidance(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service, principal = client.app.state.knowledge, settings.principals["owner"]

        async def capture(text, modified):
            return await service.ingest_capture(principal,
                source={"kind": "confluence", "id": "instance:prod:page", "content_hash": content_hash(text), "metadata": {"modified_at": modified, "observed_at": time.time()}},
                title="Connection pool", structure=structure_from_markdown("Connection pool", "## Checks\n" + text, "Payments"), max_text_chars=10000)

        async def simultaneous():
            return await asyncio.gather(capture("Inspect recorded pool saturation.", 2000), capture("Inspect recorded pool saturation.", 2000))

        results = asyncio.run(simultaneous())
        assert {row["capture_outcome"] for row in results} == {"created", "unchanged"}
        assert len({row["id"] for row in results}) == 1
        newest = approve(client, token, results[0])
        older = asyncio.run(capture("Old pool check.", 1000))
        assert older["capture_outcome"] == "created"
        # A delayed scan or repeated old page must not supersede a newer observed revision.
        asyncio.run(capture("Old pool check.", 1000))
        visible = client.get("/api/v1/knowledge", headers=token("viewer")).json()
        assert [row["id"] for row in visible] == [newest["id"]]
        all_rows = client.get("/api/v1/knowledge", headers=token("owner")).json()
        assert not next(row for row in all_rows if row["id"] == older["id"])["capture_eligibility"]["eligible"]


def test_block_extraction_preserves_code_and_removes_exact_redundancy():
    source = "## Queries\n```python\n# This is a code comment\nprint('read only')\n```\n## Sanity checks\nInspect the recorded outcome."
    structure = structure_from_markdown("Playbook", source, "Checkout")
    assert [block.kind for block in structure.blocks] == ["query", "sanity"]
    assert "# This is a code comment" in structure.blocks[0].content
    assert "print('read only')" in structure.markdown()
    duplicate = KnowledgeStructure.model_validate({"topic": "Checkout", "blocks": [structure.blocks[0].model_dump()] * 2})
    assert len(duplicate.blocks) == 1
    nested = structure_from_markdown("Example", "## Process\n````markdown\n```python\n# Inside fenced source\n```\n````\n## Checks\nInspect result.")
    assert len(nested.blocks) == 2 and "# Inside fenced source" in nested.blocks[0].content


def test_editing_derived_blocks_cannot_widen_original_scope(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        parent = approve(client, token, draft(client, token, associations={"capability_ids": ["attachment_review"]}))
        structure = structure_from_markdown("Checkout", parent["content"])
        derived = asyncio.run(client.app.state.knowledge.ingest_capture(settings.principals["owner"],
            source={"kind": "document", "id": parent["id"], "content_hash": parent["content_hash"]},
            title="Checkout guidance", structure=structure, max_text_chars=10000))
        response = client.put(f"/api/v1/knowledge/{derived['id']}", headers=token("owner"), json={
            "title": derived["title"], "structure": structure.model_dump(), "expected_hash": derived["content_hash"],
            "associations": {"capability_ids": ["incident_triage"]}})
        assert response.status_code == 422, response.text


def test_source_tombstone_fences_delayed_existing_and_new_capture_versions(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service, principal = client.app.state.knowledge, settings.principals["owner"]
        base = time.time() - 100

        async def capture(text, modified, observed):
            return await service.ingest_capture(principal,
                source={"kind": "jira_ticket", "id": "jira:prod:PAY-7", "content_hash": content_hash(text),
                        "metadata": {"modified_at": modified, "observed_at": observed}},
                title="Recorded resolution", structure=structure_from_markdown("Payments", text), max_text_chars=10000)

        async def eligible(row):
            return (await service.capture_admissions(principal, [row]))[row["id"]]["eligible"]

        first = asyncio.run(capture("Original recorded closure", 100, base + 10))
        asyncio.run(service.mark_source_unavailable(principal, "jira_ticket", "jira:prod:PAY-7", base + 20, modified_at=200))
        # A read begun before reopening arrives late; processing time is not freshness.
        replay = asyncio.run(capture("Original recorded closure", 100, base + 10))
        assert replay["id"] == first["id"]
        assert not asyncio.run(eligible(replay))
        # Even a newly issued read can return an older cached source version.
        replay = asyncio.run(capture("Original recorded closure", 100, base + 30))
        assert not asyncio.run(eligible(replay))
        # Tombstones apply to versions first inserted after the unavailable check.
        delayed = asyncio.run(capture("Another stale closed excerpt", 150, base + 15))
        assert not asyncio.run(eligible(delayed))
        current = asyncio.run(capture("Subsequent recorded closure", 300, base + 40))
        assert asyncio.run(eligible(current))
        assert not asyncio.run(eligible(first))


def test_absence_before_first_capture_and_monotonic_observation_receipts(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service, principal = client.app.state.knowledge, settings.principals["owner"]
        base = time.time() - 100
        asyncio.run(service.mark_source_unavailable(principal, "confluence", "wiki:prod:page", base + 20))

        async def capture(observed):
            return await service.ingest_capture(principal,
                source={"kind": "confluence", "id": "wiki:prod:page", "content_hash": content_hash("Recorded procedure"),
                        "metadata": {"modified_at": 100, "observed_at": observed}},
                title="Recorded procedure", structure=structure_from_markdown("Payments", "Recorded procedure"), max_text_chars=10000)

        async def eligible(row):
            return (await service.capture_admissions(principal, [row]))[row["id"]]["eligible"]

        late = asyncio.run(capture(base + 10))
        assert not asyncio.run(eligible(late))
        fresh = asyncio.run(capture(base + 30))
        assert fresh["id"] == late["id"] and asyncio.run(eligible(fresh))
        # Older retries cannot lower the receipt's last successful observation.
        asyncio.run(capture(base + 5))
        assert asyncio.run(eligible(fresh))
        # An absent source in another project cannot retire this project's source.
        foreign = principal.model_copy(update={"project_id": "another-project"})
        asyncio.run(service.mark_source_unavailable(foreign, "confluence", "wiki:prod:page", base + 50))
        assert asyncio.run(eligible(fresh))


def test_same_content_versions_cannot_combine_incompatible_freshness_observations(tmp_path):
    settings, _ = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service, principal = client.app.state.knowledge, settings.principals["owner"]
        base = time.time() - 100

        async def capture(modified, observed):
            return await service.ingest_capture(principal,
                source={"kind": "jira_ticket", "id": "jira:prod:PAY-8", "content_hash": content_hash("Same extracted facts"),
                        "metadata": {"modified_at": modified, "observed_at": observed}},
                title="Recorded facts", structure=structure_from_markdown("Payments", "Same extracted facts"), max_text_chars=10000)

        async def eligible(row):
            return (await service.capture_admissions(principal, [row]))[row["id"]]["eligible"]

        row = asyncio.run(capture(100, base + 30))
        # A newer source version arrived from an earlier-started request. Its
        # freshness cannot be borrowed from the older cached version's later read.
        asyncio.run(capture(300, base + 10))
        asyncio.run(service.mark_source_unavailable(principal, "jira_ticket", "jira:prod:PAY-8", base + 20, modified_at=200))
        assert not asyncio.run(eligible(row))
        asyncio.run(capture(100, base + 40))
        assert not asyncio.run(eligible(row)), "An older source version must not advance observation freshness"
        asyncio.run(capture(300, base + 40))
        assert asyncio.run(eligible(row))
        asyncio.run(capture(300, base + 5))
        assert asyncio.run(eligible(row)), "Observation time is monotonic within the same source version"
