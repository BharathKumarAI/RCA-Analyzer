"""Real, isolated project-layer trials with receipts bound to current dependencies."""

import copy
import json
import time

from fastapi import HTTPException
from sqlalchemy import insert, select

from app.capabilities.resolver import CapabilityResolver
from app.configuration.models import ProjectLayer
from app.configuration.parameters import audit, definitions, overrides, system_configurations
from app.configuration.yaml_data import load_yaml_data
from app.persistence.platform_admin import (
    connector_environment_connections_table, connector_templates_table,
    platform_knowledge, project_connector_instances_table, project_environment_bindings_table,
)
from app.persistence.store import runs
from app.runtime.run_contract import RunContract, RunRequest, content_hash


def scoped_registry(registry, principal, content):
    candidate = copy.copy(registry)
    candidate.inheritance = copy.copy(registry.inheritance)
    candidate.inheritance.projects = dict(registry.inheritance.projects)
    candidate.inheritance.projects[(principal.tenant_id, principal.project_id)] = ProjectLayer.model_validate(content)
    return candidate


async def candidate_configuration(payload, request, principal, *, check_readiness=True):
    from app.api.routes.catalog import _project_environment_dependency_errors, _validate_project_yaml
    from app.api.routes.harness import _project_revision
    from app.api.routes.project_editor import validate_setup_draft
    current = request.app.state.registry.inheritance.project(principal)
    if payload.expected_project_revision is not None and payload.expected_project_revision != _project_revision(current):
        raise HTTPException(409, "Project settings changed; reload before testing or applying")
    if payload.expected_editor_version is not None:
        await validate_setup_draft(request, principal, payload.expected_editor_version)
    valid, errors, _, validated = _validate_project_yaml(payload.yaml, request, principal)
    errors.extend(await _project_environment_dependency_errors(request, principal, validated))
    if not valid or errors:
        raise HTTPException(422, "Project candidate is invalid: " + "; ".join(errors))
    content = load_yaml_data(payload.yaml) | {"tenant_id": principal.tenant_id, "project_id": principal.project_id}
    if validated.get("project_template"):
        content["project_template"] = validated["project_template"]
    content = ProjectLayer.model_validate(content).model_dump(mode="json", exclude_unset=True)
    registry = scoped_registry(request.app.state.registry, principal, content)
    if not check_readiness:
        return content, registry
    environments = {item["id"] for item in validated.get("environments", []) if item.get("enabled", True)}
    async with request.app.state.store.engine.connect() as connection:
        required = (await connection.execute(select(platform_knowledge.c.required_associations).where(
            platform_knowledge.c.tenant_id == principal.tenant_id, platform_knowledge.c.project_id == principal.project_id,
            platform_knowledge.c.required_associations["required"].as_boolean().is_(True),
        ).limit(501))).scalars().all()
    if len(required) > 500:
        raise HTTPException(409, "Required knowledge exceeds its review limit")
    if any(set(item.get("environment_ids", [])) - environments for item in required):
        raise HTTPException(409, "An approved knowledge requirement still references an environment being removed; independently review its replacement first")
    for capability in registry.list_all():
        if CapabilityResolver(registry).resolve(capability.id, principal, check_health=False).is_authorized:
            errors.extend(await request.app.state.knowledge.required_readiness(principal, capability.id, all_associations=True))
    if errors:
        raise HTTPException(409, "; ".join(errors))
    return content, registry


async def validate_activation(request, principal, registry, kind, resource_id):
    """A narrow availability switch still proves required source readiness."""
    from app.connectors.health import CheckStatus
    runner = copy.copy(request.app.state.runner)
    runner.registry = registry
    names = set()
    if kind == "connectors":
        names.add(resource_id)
    else:
        for capability in registry.list_all():
            if (kind == "capabilities" and capability.id != resource_id) or (kind == "skills" and resource_id not in capability.skills):
                continue
            resolved = CapabilityResolver(registry).resolve(capability.id, principal, check_health=False)
            if not resolved.is_authorized:
                raise HTTPException(409, "The selected resource cannot execute under current project policy")
            names.update(resolved.capability.requires.connectors)
    created = []
    try:
        async with request.app.state.runner._run_slot():
            providers, created = await runner._connectors_for_run(principal, names, names)
            health = await runner.health(names, providers)
            if any(name not in health or health[name].overall != CheckStatus.HEALTHY for name in names):
                raise HTTPException(409, "Required connectors are not healthy; configure and test them before enabling")
    except (ValueError, PermissionError) as exc:
        raise HTTPException(409, str(exc)) from None
    except OverflowError:
        raise HTTPException(429, "Investigation capacity reached", headers={"Retry-After": "5"}) from None
    finally:
        for provider in created:
            if hasattr(provider, "aclose"):
                await provider.aclose()


async def dependency_hash(request, principal):
    """Fingerprint governed revision identities, never return credentials or row payloads."""
    from app.api.routes.harness import _project_revision
    from app.configuration.harness_workspace import activations, bundles
    from app.configuration.project_templates import templates as project_templates
    from app.configuration.service import active as active_agents, drafts
    from app.optimization.service import active as optimized
    state = request.app.state
    tables = (definitions, overrides, system_configurations, connector_templates_table,
              project_connector_instances_table, project_environment_bindings_table, connector_environment_connections_table,
              platform_knowledge, activations, bundles, active_agents, drafts, optimized, project_templates)
    payload = {"project_revision": _project_revision(state.registry.inheritance.project(principal)),
               "harness_revision": state.registry.harness.revision,
               "platform_hash": state.optimizations.platform_hash,
               "settings": {key: getattr(state.runner.settings, key) for key in ("mode", "max_llm_calls", "max_input_chars", "max_evidence_chars", "max_context_chars", "run_timeout_seconds")}}
    state.optimizations.check_platform()
    excluded = {"content", "structure", "capture", "content_json", "definition_json", "default_value", "value", "credentials_json", "target_json", "mcp_configuration_json", "definition"}
    async with state.store.engine.connect() as connection:
        for table in tables:
            statement = select(*[column for column in table.c if column.name not in excluded])
            if "tenant_id" in table.c:
                statement = statement.where(table.c.tenant_id == principal.tenant_id)
            if "project_id" in table.c:
                statement = statement.where(table.c.project_id == principal.project_id)
            rows = [dict(row) for row in (await connection.execute(statement.limit(2001))).mappings()]
            if len(rows) > 2000:
                raise ValueError("Candidate dependency catalog exceeds its validation bound")
            payload[table.fullname] = sorted(rows, key=lambda row: json.dumps(row, sort_keys=True))
    return content_hash(payload)


async def trial(payload, request, principal, idempotency_key=None):
    from app.api.routes.harness import _project_revision
    content, registry = await candidate_configuration(payload, request, principal)
    context = {"candidate_hash": content_hash(content), "dependency_hash": await dependency_hash(request, principal),
               "project_revision": _project_revision(request.app.state.registry.inheritance.project(principal)),
               "editor_version": payload.expected_editor_version, "configuration": content}
    live = request.app.state.runner
    # All capacity, tasks, sessions, providers and cleanup stay owned by the live
    # runner. Only the immutable project-layer view and workspace resolver differ.
    runner = copy.copy(live)
    runner.registry = registry
    runner._run_slot = live._run_slot
    runner.project_candidate = context
    if getattr(live, "harness_workspace", None) is not None:
        runner.harness_workspace = copy.copy(live.harness_workspace)
        runner.harness_workspace.registry = registry
    run_input = payload.run
    result = await runner.execute(principal, RunRequest(
        text=run_input.prompt, incident_id=run_input.incident_id, chat_id=run_input.chat_id,
        attachment_ids=tuple(run_input.attachment_ids), connector_selections=run_input.connector_selections,
        environment_id=run_input.environment_id, knowledge_document_ids=tuple(run_input.knowledge_document_ids),
    ), run_input.capability, idempotency_key)
    passed = result.mode == "live" and result.status == "SUCCEEDED"
    receipt = {key: value for key, value in context.items() if key != "configuration"} | {"run_id": result.run_id, "passed": passed}
    async with request.app.state.store.engine.begin() as connection:
        await connection.execute(insert(audit).values(tenant_id=principal.tenant_id, project_id=principal.project_id,
            tool="project_candidate", variable_name=result.run_id[-64:], actor_subject=principal.subject,
            action="test", revision=result.revision, details=receipt, created_at=time.time()))
    return {"run": result, "receipt": receipt}


async def require_receipt(payload, request, principal, content):
    if not payload.candidate_run_id:
        raise HTTPException(409, "Run this project candidate successfully before applying it")
    async with request.app.state.store.engine.connect() as connection:
        row = (await connection.execute(select(runs).where(runs.c.run_id == payload.candidate_run_id,
            runs.c.tenant_id == principal.tenant_id, runs.c.project_id == principal.project_id,
            runs.c.subject == principal.subject))).mappings().first()
    if row is None or row["status"] != "SUCCEEDED":
        raise HTTPException(409, "A successful candidate investigation by this project administrator is required")
    contract = RunContract.model_validate_json(row["contract_json"])
    if contract.snapshot_hash != row["snapshot_hash"] or contract.mode != "live":
        raise HTTPException(409, "Candidate receipt integrity check failed")
    context = json.loads(contract.model_config_json).get("project_candidate")
    if not context or context["candidate_hash"] != content_hash(content) or context.get("editor_version") != payload.expected_editor_version:
        raise HTTPException(409, "The project draft differs from the tested candidate; run it again")
    if context["dependency_hash"] != await dependency_hash(request, principal):
        raise HTTPException(409, "Project dependencies changed after this test; run the candidate again")
    return context
