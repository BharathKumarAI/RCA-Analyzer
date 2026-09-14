"""Authenticated, bounded execution over native ADK and durable run records."""

import asyncio
import hashlib
import json
import logging
import os
import time
from contextlib import aclosing, asynccontextmanager

from google.adk.apps import App
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from app.persistence.database import session_service
from google.genai import types

from app.agents.root import build_root_agent
from app.capabilities.resolver import CapabilityResolver, required_connector_error
from app.connectors.health import CheckStatus, ConnectorHealth
from app.connectors.providers.registry import resolve_project_connector
from app.configuration.platform import PlatformConfiguration
from app.configuration.models import ExecutionLimits
from app.observability.otel import get_tracer
from app.observability.mlflow_adapter import record_run_metrics
from app.policy.engine import PolicyEngine
from app.policy.sources import enforcement_sources
from app.policy.redaction import redact
from app.runtime.governance import RunGovernance
from app.runtime.context import ContextLimitExceeded
from app.runtime.run_contract import (
    InvestigationResult,
    RunContract,
    RunRequest,
    content_hash,
)

logger = logging.getLogger(__name__)


class ExecutionRunner:
    def __init__(
        self,
        settings,
        registry,
        store,
        connectors,
        configuration_service=None,
        model_factory=None,
        optimization_service=None,
        platform=None,
        chat_artifacts=None,
        connector_instance_store=None,
        connector_secret_references=None,
        connector_allowed_hosts=None,
        connector_enabled_adapters=None,
    ):
        self.settings, self.registry, self.store, self.connectors = (
            settings,
            registry,
            store,
            connectors,
        )
        self.chat_artifacts = chat_artifacts
        self.connector_instance_store = connector_instance_store
        self.connector_secret_references = connector_secret_references
        self.connector_allowed_hosts = connector_allowed_hosts
        self.connector_enabled_adapters = connector_enabled_adapters
        self._run_connectors: dict[str, list] = {}
        self.harness = registry.harness
        self.configuration_service = configuration_service
        self.model_factory = model_factory
        self.optimization_service = optimization_service
        self.platform = platform or PlatformConfiguration.load(settings, registry)
        self.profiles = self.platform.profiles
        self.prompts = self.platform.prompts
        self.policy = PolicyEngine()
        self.run_limiter = asyncio.Semaphore(settings.max_concurrent_runs)
        self._run_limit = settings.max_concurrent_runs
        self.runtime_settings_lock = asyncio.Lock()
        self.model_limiter = asyncio.Semaphore(settings.max_parallel_models)
        self.tasks: dict[str, asyncio.Task] = {}
        self.session_service = session_service(settings.session_database_url.get_secret_value())
        self.policy_hash = content_hash(enforcement_sources())

    @asynccontextmanager
    async def _run_slot(self):
        async with self.runtime_settings_lock:
            if self.run_limiter.locked():
                raise OverflowError("Investigation capacity reached; retry later")
            await self.run_limiter.acquire()
        try:
            yield
        finally:
            self.run_limiter.release()

    def update_runtime_settings(self, settings):
        """Apply operational settings without interrupting active investigations."""
        old_limit = self._run_limit
        new_limit = settings.max_concurrent_runs
        if new_limit != old_limit:
            if self.run_limiter._value != old_limit:
                raise ValueError("Concurrency can only change while investigations are idle")
            self.run_limiter = asyncio.Semaphore(new_limit)
            self._run_limit = new_limit
        self.settings = settings

    async def health(self, connector_names=None, connectors=None):
        connectors = self.connectors if connectors is None else connectors

        async def probe(name, connector):
            try:
                async with asyncio.timeout(self.settings.health_timeout_seconds):
                    return name, await connector.probe_health()
            except Exception:
                return name, ConnectorHealth(
                    connector_id=name,
                    overall=CheckStatus.UNHEALTHY,
                    latency_ms=0,
                    message="Health probe could not complete",
                )

        return dict(
            await asyncio.gather(
                *(
                    probe(name, connector)
                    for name, connector in connectors.items()
                    if connector_names is None or name in connector_names
                )
            )
        )

    async def _connectors_for_run(self, principal, connector_names, required_connectors=None):
        """Overlay enabled, project-scoped instances onto deployment clients."""
        if self.connector_instance_store is None:
            return self.connectors, []
        instances = await self.connector_instance_store.list_project_connector_instances(
            principal.tenant_id, principal.project_id
        )
        managed: dict[str, list[dict]] = {}
        required_connectors = set(required_connectors or ())
        project = self.registry.inheritance.project(principal)
        active_project_environments = {
            environment.id
            for environment in project.environments
            if environment.enabled
        } if project else set()
        for instance in instances:
            adapter = instance.get("provider_adapter_id") or instance.get("template_id")
            if adapter in connector_names:
                managed.setdefault(adapter, []).append(instance)

        resolved = dict(self.connectors)
        created = []

        async def close_created():
            await asyncio.gather(
                *(item.aclose() for item in created if hasattr(item, "aclose")),
                return_exceptions=True,
            )

        for adapter, candidates in managed.items():
            is_required = adapter in required_connectors
            template_id = candidates[0].get("template_id") if candidates else adapter
            template_version = candidates[0].get("template_version", "1.0.0") if candidates else "1.0.0"
            current_template = next(
                (
                    item for item in getattr(self.platform, "connector_templates", ())
                    if (item.system_name == template_id or item.type == template_id)
                    and getattr(item, "version", "1.0.0") == template_version
                ),
                None,
            )
            if (
                current_template is None
                or getattr(current_template, "availability", "published") != "published"
                or not getattr(current_template, "platform_enabled", True)
                or not getattr(current_template, "is_enabled_by_policy", True)
            ):
                if not is_required:
                    resolved.pop(adapter, None)
                    continue
                await close_created()
                raise PermissionError(
                    f"Connector '{adapter}' uses an unavailable or mismatched template version"
                )
            if self.connector_enabled_adapters is not None and adapter not in self.connector_enabled_adapters:
                if not is_required:
                    resolved.pop(adapter, None)
                    continue
                await close_created()
                raise PermissionError(
                    f"Connector '{adapter}' is disabled by deployment configuration"
                )
            enabled = [
                item for item in candidates
                if item.get("status") == "enabled" and item.get("enabled") is True
            ]
            if len(enabled) != 1:
                if not is_required:
                    resolved.pop(adapter, None)
                    continue
                await close_created()
                raise PermissionError(
                    f"Connector '{adapter}' requires exactly one enabled project instance; "
                    "an explicit authenticated selector is required for multiple instances"
                )
            instance = enabled[0]
            definition = instance.get("definition_json") or {}
            dependency = definition.get("environment_dependency") or instance.get("environment_dependency")
            bindings = [
                binding for binding in instance.get("bindings", [])
                if isinstance(binding, dict) and binding.get("status", "active") == "active"
            ]
            all_bindings = [
                binding for binding in instance.get("bindings", [])
                if isinstance(binding, dict)
            ]
            invalid_environments = {
                binding.get("project_env_id")
                for binding in all_bindings
                if binding.get("project_env_id") not in active_project_environments
            }
            if invalid_environments:
                if not is_required:
                    resolved.pop(adapter, None)
                    continue
                await close_created()
                invalid = ", ".join(sorted(value or "<missing>" for value in invalid_environments))
                raise PermissionError(
                    f"Connector '{adapter}' references inactive or out-of-scope project environments: {invalid}"
                )
            environment_id = None
            if dependency == "dependent":
                if len(bindings) != 1 or not bindings[0].get("project_env_id"):
                    if not is_required:
                        resolved.pop(adapter, None)
                        continue
                    await close_created()
                    raise PermissionError(
                        f"Connector '{adapter}' has ambiguous environment bindings; "
                        "an authenticated environment selector is required"
                    )
                environment_id = bindings[0]["project_env_id"]
            try:
                provider = resolve_project_connector(
                    instance,
                    environment_id=environment_id,
                    deployment_tenant_id=principal.tenant_id,
                    deployment_project_id=principal.project_id,
                    allowed_secret_references=self.connector_secret_references,
                    allowed_hosts=self.connector_allowed_hosts,
                )
            except Exception:
                if not is_required:
                    resolved.pop(adapter, None)
                    continue
                await close_created()
                raise
            resolved[adapter] = provider
            created.append(provider)
        return resolved, created

    async def _close_run_connectors(self, run_id: str):
        providers = self._run_connectors.pop(run_id, [])
        if providers:
            await asyncio.gather(
                *(provider.aclose() for provider in providers if hasattr(provider, "aclose")),
                return_exceptions=True,
            )

    async def execute(
        self, principal, request: RunRequest, capability_id: str, idempotency_key=None, on_created=None
    ):
        if (principal.tenant_id, principal.project_id) != (
            self.settings.tenant_id,
            self.settings.project_id,
        ):
            raise PermissionError("Identity is outside deployment scope")
        preliminary = CapabilityResolver(self.registry).resolve(
            capability_id, principal, check_health=False
        )
        if not preliminary.is_authorized:
            raise PermissionError(preliminary.rejection_reason)
        runtime = self.registry.inheritance.runtime(
            principal, self.settings, self.prompts
        )
        effective_settings = runtime["settings"]
        if request.attachment_ids and not runtime["workflow"].attachments:
            raise PermissionError(
                "Attachment investigations are disabled by project policy"
            )
        if len(request.text) > self.settings.max_input_chars:
            raise ValueError("Prompt exceeds configured input limit")
        async with self._run_slot():
            capability = preliminary.capability
            files = (
                await self.store.get_attachments(
                    list(request.attachment_ids), principal
                )
                if request.attachment_ids
                else []
            )
            chat_id = request.chat_id or (files[0].get("chat_id") if files else None)
            if chat_id:
                await self.store.require_chat(chat_id, principal)
            if any(f.get("chat_id") != chat_id for f in files):
                raise PermissionError("Attachments must belong to the requested chat")
            approved = (
                await self.configuration_service.approved(principal, capability_id)
                if self.configuration_service and runtime["workflow"].specialists
                else []
            )
            project = self.registry.inheritance.project(principal)
            approved = self.harness.filter_approved(
                approved, project.harness if project else None
            )
            if len(approved) > self.settings.max_project_agents:
                raise ValueError(
                    "Approved specialist count exceeds configured per-run limit"
                )
            optimized = (
                await self.optimization_service.effective(principal)
                if self.optimization_service
                else None
            )
            runtime = self.registry.inheritance.runtime(
                principal,
                self.settings,
                optimized["bundle"]["prompts"] if optimized else self.prompts,
            )
            prompts = runtime["prompts"]
            skill_contents = (
                optimized["bundle"]["skills"]
                if optimized
                else self.registry.skill_contents
            )
            resolved = (
                CapabilityResolver(self.registry).resolve(
                    capability_id,
                    principal,
                    check_health=False,
                    platform_contents=skill_contents,
                )
                if optimized
                else preliminary
            )
            capability = resolved.capability
            skill_contents = resolved.skill_contents
            profile = self.profiles.profiles[capability.model_profile]
            tool_limit = min(
                profile.tool_call_limit,
                runtime["max_tool_calls"] or profile.tool_call_limit,
            )
            snapshot = {
                "harness_revision": self.harness.revision,
                "harness_selection": project.harness.model_dump(mode="json") if project else {},
                "workflow": runtime["workflow"].model_dump(mode="json"),
                "preferences": runtime["preferences"].model_dump(mode="json"),
                "disabled_connectors": list(runtime["disabled_connectors"]),
                "environments": [
                    env.model_dump(mode="json")
                    for env in runtime.get("environments", ())
                ],
                "limits": {
                    name: getattr(effective_settings, name)
                    for name in ExecutionLimits.model_fields
                    if name != "max_tool_calls"
                },
                "skill_resolution": resolved.skill_sources,
                "allowed_actions": list(capability.allowed_actions),
                "stages": {
                    k: v.model_dump(mode="json")
                    for k, v in self.profiles.resolve(capability.model_profile).items()
                },
                "prompts": prompts,
                "optimization_revision_hash": optimized["revision_hash"]
                if optimized
                else None,
                "tool_call_limit": tool_limit,
                "max_llm_calls": effective_settings.max_llm_calls,
                "parallel_evidence": runtime["workflow"].parallel_evidence,
                "specialists": [a.model_dump(mode="json") for a in approved],
                "specialist_models": {
                    a.definition.id: (
                        self.profiles.resolve(a.definition.model_profile).get(
                            a.definition.stage_model
                        )
                        or self.profiles.stages[a.definition.stage_model]
                    ).model_dump(mode="json")
                    for a in approved
                },
            }
            workspace = getattr(self, "harness_workspace", None)
            if workspace:
                snapshot["harness_bundle"] = await workspace.effective(principal, capability_id)
            from app.configuration.workflow import available_builtins, default_workflow, graph_view
            names = available_builtins(capability, self.profiles.resolve(capability.model_profile), runtime["workflow"],
                capability.allowed_actions, bool(request.attachment_ids), bool(approved))
            snapshot["resolved_graph"] = graph_view(default_workflow(names, runtime["workflow"].parallel_evidence and effective_settings.parallel_evidence))
            if snapshot.get("harness_bundle"):
                from app.configuration.harness_bundles import Compilation, enriched_graph
                planned = Compilation.model_validate(snapshot["harness_bundle"]["compilation"])
                snapshot["resolved_graph"] = enriched_graph(planned, capability, self.profiles).model_dump(mode="json")
            clean_request = RunRequest(
                text=redact(request.text),
                chat_id=chat_id,
                incident_id=request.incident_id,
                attachment_ids=request.attachment_ids,
            )
            contract = RunContract(
                tenant_id=principal.tenant_id,
                project_id=principal.project_id,
                principal=principal,
                request=clean_request,
                capability=capability.id,
                capability_version=capability.version,
                capability_hash=self.registry.content_hash,
                policy_hash=self.policy_hash,
                skill_hashes=tuple(
                    "sha256:" + hashlib.sha256(skill_contents[s].encode()).hexdigest()
                    for s in capability.skills
                ),
                agent_hashes=tuple(a.content_hash for a in approved),
                attachment_hashes=tuple(f["sha256"] for f in files),
                model_profile=capability.model_profile,
                model_config_json=json.dumps(snapshot, sort_keys=True),
                data_scope=f"tenant:{principal.tenant_id}/project:{principal.project_id}",
                mode=self.settings.mode,
            )
            response, created = await self.store.create_run(
                contract,
                idempotency_key,
                content_hash(
                    {
                        "request": request.model_dump(mode="json"),
                        "capability": capability_id,
                        "mode": self.settings.mode,
                    }
                ),
                time.time() + effective_settings.run_timeout_seconds,
            )
            if on_created:
                await on_created(response)
            if not created:
                await self._save_chat_output(response, principal)
                return response
            started = time.perf_counter()
            self.tasks[contract.run_id] = asyncio.current_task()
            governance = RunGovernance(
                contract,
                capability,
                self.policy,
                self.store,
                effective_settings,
                tool_limit,
            )
            governance.run_events = getattr(self, "run_events", None)
            span = get_tracer().start_span("rca.investigation")
            from opentelemetry import trace

            with trace.use_span(
                span,
                end_on_exit=True,
                record_exception=False,
                set_status_on_exception=False,
            ):
                span.set_attribute("rca.run_id", contract.run_id)
                span.set_attribute("rca.capability", capability.id)
                trace_id = (
                    format(span.get_span_context().trace_id, "032x")
                    if span.is_recording()
                    else None
                )
                await self.store.update_run(
                    contract.run_id, principal, stage="preflight", trace_id=trace_id
                )
                try:
                    async with asyncio.timeout(effective_settings.run_timeout_seconds):
                        response = await self._execute_contract(
                            contract,
                            capability,
                            governance,
                            files,
                            approved,
                            prompts,
                            skill_contents,
                        )
                except asyncio.CancelledError:
                    response = await asyncio.shield(
                        self.store.update_run(
                            contract.run_id,
                            principal,
                            status="CANCELLED",
                            stage="cancelled",
                            reason="Run was cancelled",
                        )
                    )
                except TimeoutError:
                    response = await self.store.update_run(
                        contract.run_id,
                        principal,
                        status="FAILED",
                        stage="timeout",
                        reason="Investigation exceeded its time budget",
                    )
                except ContextLimitExceeded:
                    response = await self.store.update_run(
                        contract.run_id, principal, status="FAILED", stage="context_limit",
                        reason="Required model input exceeds the configured context limit",
                    )
                except PermissionError:
                    response = await self.store.update_run(
                        contract.run_id,
                        principal,
                        status="BLOCKED",
                        stage="blocked",
                        reason="Run was blocked by its execution policy",
                    )
                except Exception as exc:
                    logger.error(
                        "Investigation failed run_id=%s error_type=%s",
                        contract.run_id,
                        type(exc).__name__,
                    )
                    response = await self.store.update_run(
                        contract.run_id,
                        principal,
                        status="FAILED",
                        stage="context_limit" if governance.context_limit_exceeded else "failed",
                        reason="Required model input exceeds the configured context limit"
                        if governance.context_limit_exceeded
                        else "Investigation could not produce a valid evidence-grounded result",
                    )
                finally:
                    try:
                        await asyncio.shield(governance.finish_pending_tools(
                            cancelled=response.status == "CANCELLED"
                        ))
                    finally:
                        await self._close_run_connectors(contract.run_id)
                        self.tasks.pop(contract.run_id, None)
                record_run_metrics(
                    span,
                    status=response.status,
                    latency_ms=(time.perf_counter() - started) * 1000,
                    evidence_count=len(governance.evidence),
                )
                await self._save_chat_output(response, principal)
                return response

    async def _save_chat_output(self, response, principal):
        if self.chat_artifacts and response.chat_id:
            try:
                await self.chat_artifacts.save_output(response, principal)
            except Exception as exc:
                logger.error(
                    "Chat output sync pending run_id=%s error_type=%s",
                    response.run_id,
                    type(exc).__name__,
                )

    async def _execute_contract(
        self, contract, capability, governance, files, approved, prompts, skill_contents
    ):
        principal = contract.principal
        current = await self.store.get_run(contract.run_id, principal)
        if current and current.status != "RUNNING":
            return current
        if contract.mode == "demo":
            return await self.store.update_run(
                contract.run_id,
                principal,
                status="SIMULATED",
                stage="demo",
                reason="Demo only: no model or live connector was invoked; no diagnosis was produced",
            )
        connector_names = set(capability.requires.connectors) | {
            action.split(".", 1)[0] for action in capability.allowed_actions
        }
        runtime_connectors, created_connectors = await self._connectors_for_run(
            principal, connector_names, capability.requires.connectors
        )
        self._run_connectors[contract.run_id] = created_connectors
        health = await self.health(connector_names, runtime_connectors)
        reason = required_connector_error(capability, health)
        if reason:
            return await self.store.update_run(
                contract.run_id,
                principal,
                status="BLOCKED",
                stage="preflight",
                reason=reason,
            )
        if self.model_factory is None and not (
            os.getenv("GOOGLE_API_KEY")
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
        ):
            return await self.store.update_run(
                contract.run_id,
                principal,
                status="BLOCKED",
                stage="preflight",
                reason="Live model credentials/backend are not configured",
            )
        usable = {
            name: connector
            for name, connector in runtime_connectors.items()
            if name in health and health[name].overall == CheckStatus.HEALTHY
        }
        for name in capability.optional.connectors:
            if name not in usable and any(
                action.startswith(name + ".") for action in capability.allowed_actions
            ):
                governance.failures.append(f"Optional connector unavailable: {name}")
        for file in files:
            await governance.capture(
                "attachments",
                file["filename"],
                {"sha256": file["sha256"], "attachment_id": file["attachment_id"]},
                {"text": file["text"], "warnings": file.get("warnings", [])},
            )
            governance.failures.extend(file.get("warnings", []))
        snapshot = json.loads(contract.model_config_json)
        snapshot["chat_history"] = await self.store.chat_context(
            contract, governance.settings.max_context_chars // 4
        )
        contract = contract.model_copy(update={"model_config_json": json.dumps(snapshot, sort_keys=True)})
        governance.contract = contract
        root = build_root_agent(
            contract,
            capability,
            governance,
            self.profiles,
            prompts,
            usable,
            self.model_limiter,
            [skill_contents[s] for s in capability.skills],
            approved,
            self.model_factory,
        )
        # Freeze the exact post-preflight topology before the first native event.
        snapshot = json.loads(contract.model_config_json)
        snapshot["resolved_graph"] = governance.resolved_graph
        frozen = contract.model_copy(update={"model_config_json": json.dumps(snapshot, sort_keys=True)})
        from sqlalchemy import update
        from app.persistence.store import runs
        async with self.store.engine.begin() as connection:
            await connection.execute(update(runs).where(runs.c.run_id == contract.run_id,
                runs.c.tenant_id == principal.tenant_id, runs.c.project_id == principal.project_id,
                runs.c.status == "RUNNING").values(contract_json=frozen.model_dump_json(), snapshot_hash=frozen.snapshot_hash))
        contract = frozen
        governance.contract = frozen
        attach_trace_callbacks(root, governance)
        session = await self.session_service.create_session(
            app_name="app",
            user_id=content_hash(
                [principal.tenant_id, principal.project_id, principal.subject]
            ),
            session_id=contract.run_id,
            state={
                "triage_result": "Unavailable",
                "logs_result": "Unavailable",
                "file_result": "Unavailable",
                "specialist_result": "Unavailable",
                "contract_hash": contract.snapshot_hash,
            },
        )
        runner = Runner(
            app=App(name="app", root_agent=root),
            session_service=self.session_service,
        )
        final = None
        try:
            async with aclosing(runner.run_async(
                user_id=session.user_id,
                session_id=session.id,
                new_message=types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=contract.request.text)],
                ),
                run_config=RunConfig(max_llm_calls=governance.settings.max_llm_calls),
            )) as events:
                async for event in events:
                    current = await self.store.get_run(contract.run_id, principal)
                    if current.status != "RUNNING":
                        return current
                    await self.store.update_run(
                        contract.run_id,
                        principal,
                        stage=event.author,
                        evidence_count=len(governance.evidence),
                    )
                    event_store = getattr(self, "run_events", None)
                    if event_store:
                        details = {"event_id": event.id, "final": event.is_final_response()}
                        usage = getattr(event, "usage_metadata", None)
                        if usage:
                            details["usage"] = usage.model_dump(mode="json", exclude_none=True)
                        await event_store.append(contract.run_id, principal, event.author, "agent_event", details)
                    if event.error_code:
                        raise RuntimeError("ADK returned an error event")
                    if (
                        event.author == "rca_synthesizer"
                        and event.is_final_response()
                        and event.content
                    ):
                        text = "".join(
                            part.text
                            for part in event.content.parts or []
                            if part.text and not part.thought
                        )
                        if text:
                            final = InvestigationResult.model_validate_json(text)
        finally:
            await runner.close()
        if governance.context_limit_exceeded:
            raise ContextLimitExceeded("A model stage exceeded the configured context limit")
        if final is None:
            raise ValueError("ADK did not produce a structured final response")
        evidence = await self.store.list_by_run(contract.run_id, principal)
        valid_ids = {item.evidence_id for item in evidence}
        if any(
            not set(finding.evidence_ids).issubset(valid_ids)
            for finding in final.findings
        ):
            raise ValueError("Synthesis cited unknown evidence")
        if not evidence and final.outcome == "FINDINGS":
            raise ValueError("Findings require recorded evidence")
        limitations = list(
            dict.fromkeys(
                governance.failures
                + (
                    ["Evidence was truncated to configured limits"]
                    if governance.truncated
                    else []
                )
            )
        )
        final = InvestigationResult.model_validate(
            redact(final.model_dump(mode="json"))
        )
        final.uncertainties = (final.uncertainties + limitations)[:20]
        return await self.store.update_run(
            contract.run_id,
            principal,
            status="PARTIAL"
            if limitations or final.outcome == "INSUFFICIENT_EVIDENCE"
            else "SUCCEEDED",
            stage="completed",
            result=final,
            evidence_count=len(evidence),
        )

    async def cancel(self, run_id, principal):
        response = await self.store.update_run(
            run_id,
            principal,
            status="CANCELLED",
            stage="cancelled",
            reason="Cancelled by an authorized project user",
        )
        if response and response.status == "CANCELLED" and run_id in self.tasks:
            self.tasks[run_id].cancel()
        return response

    async def aclose(self):
        for task in list(self.tasks.values()):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*list(self.tasks.values()), return_exceptions=True)
        await self.session_service.close()


def attach_trace_callbacks(root, governance):
    """Observe native agent lifecycle without replacing governance callbacks."""
    from google.adk.agents import LlmAgent
    from google.adk.tools import AgentTool
    from google.adk.workflow import Workflow
    seen = set()
    def visit(node):
        if id(node) in seen:
            return
        seen.add(id(node))
        if isinstance(node, LlmAgent):
            started = {}
            async def before(callback_context, name=node.name):
                started[name] = time.perf_counter()
                if governance.run_events:
                    await governance.run_events.append(governance.contract.run_id, governance.contract.principal, name, "started", {})
            async def after(callback_context, name=node.name):
                if governance.run_events:
                    elapsed = time.perf_counter() - started.pop(name, time.perf_counter())
                    await governance.run_events.append(governance.contract.run_id, governance.contract.principal, name, "completed", {"duration_ms": elapsed * 1000})
            previous_before = node.before_agent_callback
            previous_after = node.after_agent_callback
            node.before_agent_callback = [*(previous_before if isinstance(previous_before, list) else [previous_before] if previous_before else []), before]
            node.after_agent_callback = [*(previous_after if isinstance(previous_after, list) else [previous_after] if previous_after else []), after]
            for tool in node.tools:
                if isinstance(tool, AgentTool):
                    visit(tool.agent)
        elif isinstance(node, Workflow):
            # ADK clones LlmAgent instances while compiling edges; observe the
            # compiled graph nodes that actually execute, not the input objects.
            for child in node.graph.nodes if node.graph else ():
                visit(child)
    visit(root)
