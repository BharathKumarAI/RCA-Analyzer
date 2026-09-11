"""Single application composition and resource-cleanup boundary."""

import asyncio

from app.configuration.parameters import ParameterStore
from app.configuration.database_bundle import load_effective_settings
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

from app.connectors.providers.registry import build_connectors


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
            api.state.parameters = ParameterStore(api.state.store.engine)
            await api.state.parameters.initialize()
            configured, parameters = await load_effective_settings(
                api.state.store.engine, configured, cleanup
            )
            reference_keys = {
                ("jira", "api_token"): "itsm",
                ("splunk", "token"): "log_search",
            }
            secret_references = {
                reference_keys[(row["tool"], row["variable_name"])]: row[
                    "effective_value"
                ]
                for row in parameters
                if (row["tool"], row["variable_name"]) in reference_keys
            }
            api.state.settings = configured
            api.state.upload_limiter = asyncio.Semaphore(
                configured.max_concurrent_uploads
            )
            platform = PlatformConfiguration.load(configured)
            api.state.platform = platform
            api.state.registry = platform.registry
            api.state.file_limits = platform.file_limits
            providers = build_connectors(
                platform.connector_options,
                configured.mode,
                cleanup,
                connectors,
                secret_references,
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
            cleanup.push_async_callback(api.state.runner.aclose)
            await api.state.runner.session_service.prepare_tables()
            telemetry = setup_telemetry() if configured.mode == "live" else None
            try:
                yield
            finally:
                if telemetry:
                    await asyncio.to_thread(telemetry.force_flush, 5000)

    return lifespan
