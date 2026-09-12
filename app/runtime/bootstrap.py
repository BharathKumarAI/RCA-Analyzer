"""Single application composition and resource-cleanup boundary."""

import asyncio

from app.configuration.parameters import ParameterStore
from app.configuration.integrations import IntegrationStore
from app.configuration.database_bundle import load_effective_settings
from app.persistence.platform_admin import PlatformAdminStore
from contextlib import AsyncExitStack, asynccontextmanager


from app.configuration.platform import PlatformConfiguration
from app.configuration.service import (
    AgentConfigurationService,
)
from app.connectors.providers.blob import ConfigurationBlobStore
from app.connectors.providers.framework_stages import FrameworkStageStore
from app.persistence.store import InvestigationStore
from app.persistence.chat_artifacts import ChatArtifactStore
from app.identity.auth import validate_public_key
from app.observability.otel import setup_telemetry
from app.runtime.runner import ExecutionRunner
from app.optimization.service import OptimizationService
from app.settings import Settings
from typing import Any

from app.connectors.providers.registry import build_connectors, configured_connector_values


def _resolve_connector_secret_overrides(platform_options: dict[str, Any], parameter_rows):
    defaults: dict[str, dict[str, str]] = {}
    for name, options in platform_options.items():
        secrets = getattr(options, "secrets", None) if not isinstance(options, dict) else options.get("secrets")
        if isinstance(secrets, dict):
            defaults[name] = {
                key: value for key, value in secrets.items() if isinstance(key, str) and isinstance(value, str)
            }
    for row in parameter_rows or []:
        tool = row.get("tool")
        variable = row.get("variable_name")
        value = row.get("effective_value")
        if tool in defaults and isinstance(variable, str) and variable in defaults[tool]:
            defaults[tool][variable] = value
    return {tool: overrides for tool, overrides in defaults.items() if overrides}


def application_lifespan(settings=None, *, connectors=None, model_factory=None):
    @asynccontextmanager
    async def lifespan(api):
        configured = settings or Settings.from_env()
        configured.validate_runtime()
        if configured.auth_public_key:
            validate_public_key(configured.auth_public_key)
        async with AsyncExitStack() as cleanup:
            for provider in (connectors or {}).values():
                cleanup.push_async_callback(provider.aclose)
            api.state.store = InvestigationStore(
                configured.database_url.get_secret_value()
            )
            cleanup.push_async_callback(api.state.store.aclose)
            await api.state.store.initialize()
            from app.persistence.run_events import RunEventStore
            api.state.run_events = RunEventStore(api.state.store.engine)
            await api.state.run_events.initialize()
            api.state.parameters = ParameterStore(api.state.store.engine)
            await api.state.parameters.initialize()
            api.state.integrations = IntegrationStore(api.state.store.engine)
            await api.state.integrations.initialize()
            api.state.platform_admin = PlatformAdminStore(api.state.store.engine)
            await api.state.platform_admin.initialize()
            api.state.integration_probe_limiter = asyncio.Semaphore(4)
            configured, parameters = await load_effective_settings(
                api.state.store.engine, configured, cleanup
            )
            api.state.settings = configured
            api.state.upload_limiter = asyncio.Semaphore(
                configured.max_concurrent_uploads
            )
            platform = PlatformConfiguration.load(configured)
            secret_references = _resolve_connector_secret_overrides(
                platform_options=platform.connector_options,
                parameter_rows=parameters,
            )
            api.state.platform = platform
            api.state.registry = platform.registry
            api.state.harness = api.state.registry.harness
            api.state.file_limits = platform.file_limits
            providers = build_connectors(
                platform.connector_options,
                configured.mode,
                cleanup,
                connectors,
                secret_references,
                configured_connector_values(parameters),
            )
            api.state.chat_artifacts = ChatArtifactStore(
                api.state.store, configured, platform.file_limits.max_file_bytes
            )
            api.state.blobs = ConfigurationBlobStore(
                configured.artifact_uri("agent-configurations"),
                configured.max_agent_yaml_bytes,
            )
            api.state.configurations = AgentConfigurationService(
                api.state.store.engine,
                api.state.blobs,
                api.state.registry,
                platform.profiles,
                stage_store=FrameworkStageStore(configured),
            )
            await api.state.configurations.initialize()
            from app.configuration.harness_workspace import HarnessWorkspaceService
            api.state.harness_workspace = HarnessWorkspaceService(
                api.state.store.engine,
                ConfigurationBlobStore(configured.artifact_uri("agent-configurations") + "/harness", 1048576, suffix=".json"),
                platform, configured, api.state.configurations,
            )
            await api.state.harness_workspace.initialize()
            api.state.optimizations = OptimizationService(
                api.state.store.engine,
                configured,
                api.state.configurations,
                model_factory,
                platform=platform,
            )
            cleanup.push_async_callback(api.state.optimizations.aclose)
            await api.state.optimizations.initialize()
            api.state.runner = ExecutionRunner(
                configured,
                api.state.registry,
                api.state.store,
                providers,
                api.state.configurations,
                model_factory,
                optimization_service=api.state.optimizations,
                chat_artifacts=api.state.chat_artifacts,
                platform=platform,
            )
            api.state.runner.harness_workspace = api.state.harness_workspace
            api.state.runner.run_events = api.state.run_events
            cleanup.push_async_callback(api.state.runner.aclose)
            await api.state.runner.session_service.prepare_tables()
            telemetry = setup_telemetry() if configured.mode == "live" else None
            try:
                yield
            finally:
                if telemetry:
                    await asyncio.to_thread(telemetry.force_flush, 5000)

    return lifespan
