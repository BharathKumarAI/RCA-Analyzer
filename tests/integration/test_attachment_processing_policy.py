"""Integration tests for attachment_processing policy enforcement, isolation, and Harness projection."""

import json
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import insert, select

from app.api.application import create_app
from app.configuration.parameters import projects
from app.identity.principals import UserPrincipal, Role
from app.runtime.run_contract import RunRequest
from tests.support import settings_for


def test_attachment_processing_policy_and_harness_projection(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        headers = token("admin")

        # 1. Verify Harness projection for project.attachment_processing
        workspace = client.get("/api/v1/harness/workspace", headers=headers).json()
        att_node = next(
            (n for n in workspace["graph"]["nodes"] if n["id"] == "parameter:itsm.attachment_processing"),
            None,
        )
        assert att_node is not None, "parameter:itsm.attachment_processing node missing from Harness"
        assert att_node["details"]["runtime_binding"] == "project.attachment_processing"
        assert att_node["details"]["execution_status"] == "runtime_bound"
        assert att_node["details"]["execution_consumers"], "execution_consumers must not be empty"
        assert att_node["details"]["consumer_resolution"] == "enforced by runner execution pipeline during ticket triage"

        # 2. Verify declared unconsumed controls have empty execution_consumers
        unconsumed_node = next(
            (n for n in workspace["graph"]["nodes"] if n["id"] == "parameter:confluence.timeout_seconds"),
            None,
        )
        assert unconsumed_node is not None, "parameter:confluence.timeout_seconds node missing from Harness"
        assert unconsumed_node["details"]["execution_status"] == "declared_unconsumed"
        assert unconsumed_node["details"]["execution_consumers"] == []

        # 3. Verify platform template default for attachment_processing is "disabled"
        shared = client.get("/api/v1/parameters?view=template", headers=headers).json()
        param = next(p for p in shared if p["tool"] == "itsm" and p["variable_name"] == "attachment_processing")
        assert param["default_value"] == "disabled"
        assert set(param["allowed_values"]) == {"disabled", "local_upload"}

        # 4. Save template parameter as "local_upload"
        path = "/api/v1/parameters/itsm/template"
        changes = {
            "attachment_processing": {"value": "local_upload", "expected_revision": param["revision"]},
        }
        res = client.put(path, headers=headers, json={"changes": changes})
        assert res.status_code == 200, res.text

        shared_after = client.get("/api/v1/parameters?view=template", headers=headers).json()
        param_after = next(p for p in shared_after if p["tool"] == "itsm" and p["variable_name"] == "attachment_processing")
        assert param_after["default_value"] == "local_upload"
        assert param_after["revision"] == param["revision"] + 1

        # 5. Project override precedence: override back to "disabled" for project
        async def register_project():
            async with client.app.state.parameters.engine.begin() as connection:
                existing = await connection.execute(select(projects).where(
                    projects.c.tenant_id == settings.tenant_id,
                    projects.c.project_id == settings.project_id,
                ))
                if existing.first() is None:
                    await connection.execute(insert(projects).values(
                        tenant_id=settings.tenant_id, project_id=settings.project_id,
                        project_name="Test Project",
                    ))
        client.portal.call(register_project)

        override_res = client.put(
            "/api/v1/parameters/itsm/attachment_processing/override",
            headers=token("owner"),
            json={
                "value": "disabled",
                "expected_revision": 0,
                "expected_definition_revision": param_after["revision"],
            },
        )
        assert override_res.status_code == 200, override_res.text

        # 6. Verify effective value in Harness reflects the project override
        workspace_project = client.get("/api/v1/harness/workspace", headers=token("owner")).json()
        att_node_project = next(
            n for n in workspace_project["graph"]["nodes"] if n["id"] == "parameter:itsm.attachment_processing"
        )
        assert att_node_project["details"]["effective_value"] == "disabled"
        assert att_node_project["details"]["provenance"]["source"] == "project.parameter_overrides"


def test_runner_attachment_policy_isolation_and_workflow_checks(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        runner = client.app.state.runner
        principal = UserPrincipal(
            tenant_id=settings.tenant_id,
            project_id=settings.project_id,
            subject="test-user",
            username="test-user",
            roles=(Role.PLATFORM_ADMIN, Role.PROJECT_OWNER),
        )

        # 1. Unauthorized attachment reference rejection
        req = RunRequest(
            text="Analyze issue",
            incident_id="INC-123",
            attachment_ids=("att_unauthorized_12345",),
        )
        with pytest.raises(PermissionError, match="attachment missing, expired, or outside principal scope"):
            client.portal.call(runner.execute, principal, req, "incident_triage")

        # 2. Workflow restriction rejection when workflow.attachments is false
        orig_runtime = runner.registry.inheritance.runtime
        def mocked_runtime(*args, **kwargs):
            rt = orig_runtime(*args, **kwargs)
            rt["workflow"] = rt["workflow"].model_copy(update={"attachments": False})
            return rt

        runner.registry.inheritance.runtime = mocked_runtime
        try:
            with pytest.raises(PermissionError, match="Attachment investigations are disabled by project policy"):
                client.portal.call(runner.execute, principal, req, "incident_triage")
        finally:
            runner.registry.inheritance.runtime = orig_runtime


def test_root_agent_triage_and_file_investigator_isolation(tmp_path):
    from unittest.mock import MagicMock
    from app.agents.root import build_root_agent
    from app.configuration.models import WorkflowOptions
    from app.runtime.run_contract import RunContract, RunRequest

    settings, _ = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        runner = client.app.state.runner
        principal = UserPrincipal(
            tenant_id=settings.tenant_id,
            project_id=settings.project_id,
            subject="test-user",
            username="test-user",
            roles=(Role.PLATFORM_ADMIN,),
        )
        cap = runner.registry.get("incident_triage")
        contract_req = RunRequest(
            text="Issue report with logs",
            incident_id="INC-999",
            attachment_ids=("att_test_file_1",),
        )

        # 1. Test when jira_attachment_processing is 'disabled'
        snapshot_disabled = {
            "jira_attachment_processing": "disabled",
            "workflow": WorkflowOptions(attachments=True).model_dump(mode="json"),
        }
        contract_disabled = RunContract(
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            principal=principal,
            request=contract_req,
            capability=cap.id,
            capability_version=cap.version,
            capability_hash="hash-1",
            policy_hash="policy-1",
            skill_hashes=(),
            agent_hashes=(),
            attachment_hashes=("sha256:abc",),
            model_profile=cap.model_profile,
            model_config_json=json.dumps(snapshot_disabled),
            data_scope=f"tenant:{principal.tenant_id}/project:{principal.project_id}",
            mode="live",
        )

        gov = MagicMock()
        gov.attachment_marker = "[ATTACHMENT:att_test_file_1: crash.log]"
        gov.settings.max_llm_calls = 10
        gov.settings.default_log_window = "1h"
        gov.prepare_model_request = lambda r: r

        from app.connectors.providers.jira import JiraConnector
        jira = JiraConnector(base_url="https://jira.example.com", project_key="INC", user_email="a@b.c", api_token="tok")
        usable_connectors = {"itsm": jira}

        root_disabled = build_root_agent(
            contract_disabled,
            cap,
            gov,
            runner.profiles,
            runner.prompts,
            usable_connectors,
            MagicMock(),
            [],
        )

        def find_agents(obj):
            found = {}
            if hasattr(obj, "edges"):
                for s, t in obj.edges:
                    found.update(find_agents(s))
                    found.update(find_agents(t))
            elif hasattr(obj, "name"):
                found[obj.name] = obj
            return found

        agents_disabled = find_agents(root_disabled)
        triage_agent = agents_disabled["triage_agent"]
        ctx_mock = MagicMock()
        ctx_mock.state = {}
        triage_prompt = triage_agent.instruction(ctx_mock) if callable(triage_agent.instruction) else triage_agent.instruction
        assert "Attached file evidence" not in triage_prompt

        # But independent file investigator exists and receives attachment marker
        file_agent = agents_disabled.get("file_investigator")
        assert file_agent is not None, "Independent file investigator must run and not be starved"
        file_prompt = file_agent.instruction(ctx_mock) if callable(file_agent.instruction) else file_agent.instruction
        assert gov.attachment_marker in file_prompt

        # 2. Test when jira_attachment_processing is 'local_upload'
        snapshot_local = {
            "jira_attachment_processing": "local_upload",
            "workflow": WorkflowOptions(attachments=True).model_dump(mode="json"),
        }
        contract_local = contract_disabled.model_copy(update={"model_config_json": json.dumps(snapshot_local)})
        root_local = build_root_agent(
            contract_local,
            cap,
            gov,
            runner.profiles,
            runner.prompts,
            usable_connectors,
            MagicMock(),
            [],
        )
        agents_local = find_agents(root_local)
        triage_agent_local = agents_local["triage_agent"]
        triage_prompt_local = triage_agent_local.instruction(ctx_mock) if callable(triage_agent_local.instruction) else triage_agent_local.instruction
        assert "Attached file evidence (validated local uploads for ticket context):" in triage_prompt_local
        assert gov.attachment_marker in triage_prompt_local

        # 3. Verify Jira remote download prohibition (no remote attachment download tools)
        assert not hasattr(JiraConnector, "download_attachment")
        assert not hasattr(JiraConnector, "fetch_attachment")

