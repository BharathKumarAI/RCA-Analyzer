"""Authenticated, bounded execution over native ADK and durable run records."""

import asyncio
import hashlib
import json
import logging
import os
import time

from google.adk.apps import App
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from app.persistence.database import session_service
from google.genai import types

from app.agents.root import build_root_agent
from app.capabilities.resolver import CapabilityResolver, required_connector_error
from app.connectors.health import CheckStatus, ConnectorHealth
from app.configuration.platform import PlatformConfiguration
from app.configuration.models import ExecutionLimits
from app.observability.otel import get_tracer
from app.observability.mlflow_adapter import record_run_metrics
from app.policy.engine import PolicyEngine
from app.policy.sources import enforcement_sources
from app.policy.redaction import redact
from app.runtime.governance import RunGovernance
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
    ):
        self.settings, self.registry, self.store, self.connectors = (
            settings,
            registry,
            store,
            connectors,
        )
        self.chat_artifacts = chat_artifacts
        self.harness = registry.harness
        self.configuration_service = configuration_service
        self.model_factory = model_factory
        self.optimization_service = optimization_service
        self.platform = platform or PlatformConfiguration.load(settings, registry)
        self.profiles = self.platform.profiles
        self.prompts = self.platform.prompts
        self.policy = PolicyEngine()
        self.run_limiter = asyncio.Semaphore(settings.max_concurrent_runs)
        self.model_limiter = asyncio.Semaphore(settings.max_parallel_models)
        self.tasks: dict[str, asyncio.Task] = {}
        self.session_service = session_service(settings.session_database_url.get_secret_value())
        self.policy_hash = content_hash(enforcement_sources())

    async def health(self, connector_names=None):
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
                    for name, connector in self.connectors.items()
                    if connector_names is None or name in connector_names
                )
            )
        )

    async def execute(
        self, principal, request: RunRequest, capability_id: str, idempotency_key=None
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
        if self.run_limiter.locked():
            raise OverflowError("Investigation capacity reached; retry later")
        async with self.run_limiter:
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
                        stage="failed",
                        reason="Investigation could not produce a valid evidence-grounded result",
                    )
                finally:
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
        health = await self.health(connector_names)
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
            for name, connector in self.connectors.items()
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
            async for event in runner.run_async(
                user_id=session.user_id,
                session_id=session.id,
                new_message=types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=contract.request.text)],
                ),
                run_config=RunConfig(max_llm_calls=governance.settings.max_llm_calls),
            ):
                current = await self.store.get_run(contract.run_id, principal)
                if current.status != "RUNNING":
                    return current
                await self.store.update_run(
                    contract.run_id,
                    principal,
                    stage=event.author,
                    evidence_count=len(governance.evidence),
                )
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
