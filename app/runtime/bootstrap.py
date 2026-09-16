"""Single application composition and resource-cleanup boundary."""

import asyncio

from app.configuration.parameters import ParameterStore
from app.configuration.integrations import IntegrationStore
from app.configuration.database_bundle import load_effective_settings
from app.configuration.connector_catalog import refresh_published_templates
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

from app.connectors.providers.registry import (
    build_connectors, configured_connector_values,
    configured_connector_secrets as _resolve_connector_secret_overrides,
)



def application_lifespan(settings=None, *, connectors=None, model_factory=None, managed_projects=True):
    @asynccontextmanager
    async def lifespan(api):
        configured = settings or Settings.from_env()
        api.state.deployment_settings = configured
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
            from app.persistence.triage import TriageStore
            api.state.triage_store = TriageStore(api.state.store.engine)
            await api.state.triage_store.initialize()
            from app.persistence.run_events import RunEventStore
            api.state.run_events = RunEventStore(api.state.store.engine)
            await api.state.run_events.initialize()
            api.state.parameters = ParameterStore(api.state.store.engine)
            await api.state.parameters.initialize()
            from app.configuration.oidc import OidcService
            api.state.oidc = OidcService(api.state.store.engine, configured)
            await api.state.oidc.initialize()
            cleanup.push_async_callback(api.state.oidc.aclose)
            from app.configuration.project_templates import ProjectTemplateStore
            api.state.project_templates = ProjectTemplateStore(api.state.store.engine)
            await api.state.project_templates.initialize()
            api.state.integrations = IntegrationStore(api.state.store.engine)
            await api.state.integrations.initialize()
            api.state.platform_admin = PlatformAdminStore(api.state.store.engine)
            await api.state.platform_admin.initialize()
            if managed_projects:
                from app.configuration.projects import ProjectStore
                api.state.projects = ProjectStore(api.state.store.engine, configured)
                await api.state.projects.initialize()
            from app.configuration.knowledge import KnowledgeService
            api.state.knowledge = KnowledgeService(api.state.store.engine, configured)
            api.state.integration_probe_limiter = asyncio.Semaphore(4)
            configured, parameters = await load_effective_settings(
                api.state.store.engine,
                configured,
                cleanup,
                connector_template_store=api.state.platform_admin,
            )
            api.state.settings = configured
            api.state.upload_limiter = asyncio.Semaphore(
                configured.max_concurrent_uploads
            )
            platform = await PlatformConfiguration.load_async(
                api.state.store.engine,
                configured,
                tenant_id=configured.tenant_id,
            )
            # Persisted lifecycle records are the authoritative catalog for the
            # running process. Keep every API, Harness, and runtime consumer on
            # the same published version set as parameter resolution.
            platform = await refresh_published_templates(
                platform,
                api.state.platform_admin,
            )
            secret_references = _resolve_connector_secret_overrides(
                platform_options=platform.connector_options,
                parameter_rows=parameters,
            )
            api.state.platform = platform
            api.state.registry = platform.registry
            api.state.harness = api.state.registry.harness
            api.state.file_limits = platform.file_limits
            project_secret_references = {
                reference
                for options in platform.connector_options.values()
                for reference in (
                    options.get("secrets", {}).values()
                    if isinstance(options, dict)
                    else getattr(options, "secrets", {}).values()
                )
                if isinstance(reference, str)
            }
            project_secret_references.update(
                template.default_secret
                for template in platform.connector_templates
                if isinstance(template.default_secret, str)
            )
            allowed_hosts = {
                host.strip().lower()
                for host in configured.integration_allowed_hosts.split(",")
                if host.strip()
            }
            enabled_connector_adapters = {
                name
                for name, options in platform.connector_options.items()
                if (options.get("enabled") if isinstance(options, dict) else getattr(options, "enabled", False))
            }
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
                platform,
                configured,
                api.state.configurations,
                parameter_store=api.state.parameters,
                connector_instance_store=api.state.platform_admin,
            )
            api.state.harness_workspace.project_templates = api.state.project_templates
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
                connector_instance_store=api.state.platform_admin,
                parameter_store=api.state.parameters,
                refresh_deployment_connectors=connectors is None,
                connector_secret_references=project_secret_references,
                connector_allowed_hosts=allowed_hosts or None,
                connector_enabled_adapters=enabled_connector_adapters,
            )
            api.state.runner.harness_workspace = api.state.harness_workspace
            api.state.runner.knowledge = api.state.knowledge
            api.state.runner.run_events = api.state.run_events
            cleanup.push_async_callback(api.state.runner.aclose)
            from app.runtime.playground import Playground
            api.state.playground = Playground(api.state.runner)
            await api.state.playground.initialize()
            await api.state.runner.session_service.prepare_tables()
            if managed_projects:
                from app.runtime.projects import ProjectRuntimeManager
                api.state.project_runtimes = ProjectRuntimeManager(api, model_factory)
                cleanup.push_async_callback(api.state.project_runtimes.aclose)
            telemetry = setup_telemetry() if managed_projects and configured.mode == "live" else None
            try:
                yield
            finally:
                if telemetry:
                    await asyncio.to_thread(telemetry.force_flush, 5000)

    return lifespan
