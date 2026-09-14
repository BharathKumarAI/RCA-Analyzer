"""Deployment-owned connector inventory; credentials stay in providers."""

from app.connectors.providers.secrets import environment_secret
import re
from typing import Literal
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector

from app.connectors.providers.evidence import (
    ConfluenceConnector, GitLabConnector, QTestConnector, SignalFxConnector, KubernetesConnector,
)
from app.connectors.providers.oracle import OracleConnector
from app.connectors.providers.infrastructure import KafkaConnector, UnixConnector
from app.connectors.providers.mcp_evidence import McpEvidenceConnector

NATIVE_FACTORIES = {
    "itsm": JiraConnector, "log_search": SplunkConnector,
    "confluence": ConfluenceConnector, "gitlab": GitLabConnector,
    "qtest": QTestConnector, "signalfx": SignalFxConnector,
    "kubernetes": KubernetesConnector, "oracle": OracleConnector,
    "kafka": KafkaConnector, "unix": UnixConnector,
}
CONNECTOR_IDS = frozenset(NATIVE_FACTORIES)


class McpBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,128}$")
    scope_argument: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
    arguments: dict = Field(default_factory=dict)
    argument_map: dict[str, str] = Field(default_factory=dict)


class ConnectorOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = True
    transport: Literal["native", "mcp"] = "native"
    mcp_tools: dict[str, McpBinding] = Field(default_factory=dict)
    timeout_s: float = Field(default=5, gt=0, le=60)
    max_connections: int = Field(default=8, ge=1, le=100)
    max_keepalive_connections: int = Field(default=4, ge=0, le=100)
    max_response_bytes: int = Field(default=1048576, ge=1024, le=8388608)
    max_results: int = Field(default=100, ge=1, le=1000)
    max_window_seconds: int = Field(default=86400, ge=60, le=604800)
    secrets: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_secrets(self):
        if set(self.mcp_tools) - {"read_evidence", "get_ticket", "query_range"}:
            raise ValueError("Unknown MCP operation binding")
        if self.transport == "mcp" and self.enabled and not self.mcp_tools:
            raise ValueError("Enabled MCP connectors require approved tool bindings")
        for argument, reference in self.secrets.items():
            if not re.fullmatch(r"[a-z_][a-z0-9_]{0,63}", argument):
                raise ValueError("Invalid connector secret argument name")
            if not re.fullmatch(r"env://[A-Z][A-Z0-9_]{0,127}", reference):
                raise ValueError(
                    "Connector secret references must use env:// style references"
                )
        return self


NATIVE_RUNTIME_FIELDS = {
    "endpoint": "endpoint", "service_user": "user_email", "timeout_seconds": "timeout_s",
    "max_response_bytes": "max_response_bytes", "max_results": "max_results",
    "max_window_seconds": "max_window_seconds",
}

_SECRET_REF_PATTERN = re.compile(r"^env://[A-Z][A-Z0-9_]{0,127}$")
_SENSITIVE_FIELD = re.compile(r"(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)", re.I)
_RUNTIME_AUTH_TYPES = {
    "itsm": {"basic_api_token": {"account_identifier", "api_token_secret_ref"}},
    "log_search": {"bearer_token": {"token_secret_ref"}},
    "confluence": {"bearer_token": {"token_secret_ref"}},
    "signalfx": {"api_key_header": {"api_key_secret_ref"}},
    "qtest": {"bearer_token": {"token_secret_ref"}},
    "gitlab": {"api_key_header": {"api_key_secret_ref"}},
    "kubernetes": {"k8s_service_account_token": {"token_secret_ref"}},
    "kafka": {"sasl_scram_tls": {"username", "password_secret_ref"}},
    "unix": {
        "ssh_private_key": {"username", "private_key_ref", "known_hosts_ref"},
        "ssh_password": {"username", "password_secret_ref", "known_hosts_ref"},
    },
}
_RUNTIME_SCOPE_FIELDS = {
    "itsm": "project_key",
    "log_search": "index",
    "confluence": "scope",
    "signalfx": "scope",
    "qtest": "scope",
    "gitlab": "scope",
    "kubernetes": "scope",
    "kafka": "topic",
    "unix": "path",
}


def configured_connector_values(parameter_rows):
    """Use explicitly saved values, never sample catalog defaults, for live clients."""
    result = {}
    for row in parameter_rows or []:
        tool, name = row["tool"], row["variable_name"]
        if tool not in {"itsm", "log_search"} or name not in NATIVE_RUNTIME_FIELDS:
            continue
        if not row.get("override_revision") and row.get("revision", 1) <= 1:
            continue
        if tool == "itsm" and name in {"max_results", "max_window_seconds"}:
            continue
        if tool == "log_search" and name == "service_user":
            continue
        field = "base_url" if tool == "itsm" and name == "endpoint" else NATIVE_RUNTIME_FIELDS[name]
        result.setdefault(tool, {})[field] = row["effective_value"]
    return result


def build_connectors(raw_options, mode, cleanup, injected=None, secret_references=None, runtime_values=None):
    factories = NATIVE_FACTORIES
    if not isinstance(raw_options, dict) or not {"itsm", "log_search"} <= set(raw_options) or set(raw_options) - CONNECTOR_IDS:
        raise ValueError("connectors.yaml must define itsm and log_search")
    options = {
        name: ConnectorOptions.model_validate(raw_options[name]) for name in raw_options
    }
    providers = {}
    if injected is not None:
        if set(injected) - CONNECTOR_IDS:
            raise ValueError("Unknown injected connector")
        providers.update(injected)
    elif mode == "live":
        for name, option in options.items():
            factory = factories.get(name)
            if not options[name].enabled:
                continue
            values = options[name].model_dump(exclude={"enabled", "secrets", "transport", "mcp_tools"})
            values.update((runtime_values or {}).get(name, {}))
            if name == "itsm" and option.transport == "native":
                values.pop("max_results")
                values.pop("max_window_seconds")
            try:
                connector_secrets = (
                    {} if option.transport == "mcp"
                    else _resolve_secret_values(name, options[name], secret_references)
                )
                for arg_name, reference in connector_secrets.items():
                    values[arg_name] = environment_secret(reference)
                if option.transport == "mcp":
                    # Native endpoint/service-user edits do not retarget MCP credentials.
                    for key in ("base_url", "user_email", "api_token"):
                        values.pop(key, None)
                    values.pop("endpoint", None)
                    provider = McpEvidenceConnector(name, mcp_tools=option.mcp_tools, **values)
                elif factory is not None:
                    provider = factory(**values)
                else:
                    raise ValueError("This connector requires MCP transport")
            except ValueError:
                continue  # Missing deployment credentials remain unavailable.
            cleanup.push_async_callback(provider.aclose)
            providers[name] = provider
    return providers


def _resolve_secret_values(name, options: ConnectorOptions, secret_references):
    configured = (secret_references or {}).get(name, {})
    defaults = options.secrets
    if isinstance(configured, str):
        if len(defaults) != 1:
            raise ValueError(
                "Legacy string secret reference requires exactly one configured secret"
            )
        key = next(iter(defaults))
        configured = {key: configured}
    if not isinstance(configured, dict):
        return defaults
    for key in configured:
        if key not in defaults:
            raise ValueError(
                f"Connector secret reference for unknown argument '{key}'"
            )
    return {**defaults, **configured}


def resolve_connector_provider(
    system_name: str,
    *,
    instance_definition: dict | None = None,
    environment_id: str | None = None,
    active_connectors: dict | None = None,
    allowed_secret_references: set[str] | None = None,
    allowed_hosts: set[str] | None = None,
):
    """Resolve an executable connector provider client.

    Resolution path:
    Project -> Instance -> Environment Binding -> Authorized Resource -> Credential Binding -> Provider -> Operation
    """
    if system_name == "oracle":
        raise ValueError("Oracle connector execution is blocked by policy under repository guidance.")

    if instance_definition is not None:
        if not isinstance(instance_definition, dict) or not instance_definition:
            raise ValueError("A saved project connector instance is required")
        instance_definition = _normalise_saved_instance(instance_definition)
        status = instance_definition.get("status")
        if status is not None and status != "enabled":
            raise ValueError("Connector instance is not enabled")
        if "enabled" in instance_definition and instance_definition.get("enabled") is not True:
            raise ValueError("Connector instance is not enabled")
        template_id = instance_definition.get("provider_adapter_id") or instance_definition.get("template_id", system_name)
        if template_id == "oracle":
            raise ValueError("Oracle connector execution is blocked by policy under repository guidance.")
        if template_id not in NATIVE_FACTORIES:
            raise ValueError(f"No native provider is registered for connector '{template_id}'")
        resolved = _resolve_instance_binding(instance_definition, environment_id)
        resolved = _apply_scope_binding(template_id, resolved)
        endpoint = resolved.get("endpoint", "")
        if not isinstance(endpoint, str) or not endpoint.strip():
            raise ValueError("Connector endpoint is required on the saved project instance")
        _validate_endpoint_host(endpoint, allowed_hosts, template_id)
        credentials = resolved.get("credentials", {})
        _validate_runtime_auth(template_id, resolved, credentials)
        timeout_s = float(instance_definition.get("timeout_seconds", 10))

        resolved_secrets = _resolve_instance_secrets(credentials, allowed_secret_references)
        _require_runtime_values(template_id, resolved, credentials, resolved_secrets)

        if template_id == "itsm":
            project_key = resolved.get("project_key") or resolved.get("external_resource")
            if not project_key:
                raise ValueError("Jira project scope is required")
            custom_field_mapping = resolved.get("custom_field_mapping")
            if custom_field_mapping is None and isinstance(resolved.get("parameters"), dict):
                custom_field_mapping = resolved["parameters"].get("custom_field_mapping")
            return JiraConnector(
                base_url=endpoint,
                project_key=project_key,
                user_email=credentials.get("account_identifier", ""),
                api_token=resolved_secrets.get("api_token_secret_ref", ""),
                timeout_s=timeout_s,
                custom_field_mapping=custom_field_mapping,
            )
        elif template_id == "log_search":
            index = resolved.get("index") or resolved.get("external_resource")
            if not index:
                raise ValueError("Splunk index scope is required")
            return SplunkConnector(
                endpoint=endpoint,
                token=resolved_secrets.get("token_secret_ref", ""),
                index=index,
                timeout_s=timeout_s,
                max_results=int(instance_definition.get("max_results", 100)),
            )
        elif template_id in {"confluence", "gitlab", "qtest", "signalfx", "kubernetes"}:
            scope = resolved.get("external_resource") or resolved.get("scope")
            if not scope:
                raise ValueError(f"{template_id} resource scope is required")
            factory = NATIVE_FACTORIES[template_id]
            token = resolved_secrets.get("token_secret_ref") or resolved_secrets.get("api_key_secret_ref", "")
            return factory(endpoint=endpoint, scope=scope, token=token, timeout_s=timeout_s)
        elif template_id == "kafka":
            topic = resolved.get("topic") or resolved.get("external_resource")
            if not topic:
                raise ValueError("Kafka topic scope is required")
            return KafkaConnector(
                bootstrap_servers=endpoint, topic=topic,
                username=credentials.get("username", ""),
                password=resolved_secrets.get("password_secret_ref", ""),
                topic_filter=resolved.get("topic_filter"), timeout_s=timeout_s,
                max_results=int(instance_definition.get("max_results", 100)),
            )
        elif template_id == "unix":
            path = resolved.get("path") or resolved.get("external_resource")
            if not path:
                raise ValueError("Unix log path scope is required")
            return UnixConnector(
                host=_unix_host(endpoint), port=resolved.get("port"),
                username=credentials.get("username", ""),
                private_key_path=resolved_secrets.get("private_key_ref", ""),
                known_hosts=resolved_secrets.get("known_hosts_ref", ""),
                path=path,
                password=resolved_secrets.get("password_secret_ref", ""),
                private_key_passphrase=resolved_secrets.get("private_key_passphrase_ref", ""),
                auth_method=resolved.get("auth_type"),
                timeout_s=timeout_s,
            )

    if active_connectors and system_name in active_connectors:
        return active_connectors[system_name]

    raise ValueError(f"No configured or enabled provider for connector '{system_name}'")


def resolve_project_connector(
    instance_definition: dict,
    *,
    environment_id: str | None = None,
    deployment_tenant_id: str | None = None,
    deployment_project_id: str | None = None,
    allowed_secret_references: set[str] | None = None,
    allowed_hosts: set[str] | None = None,
):
    """Resolve one authenticated, deployment-scoped project instance.

    Callers must load the instance through the tenant/project-scoped admin
    store.  Optional deployment identifiers provide a second guard when the
    caller has them available; they are never accepted from a request body.
    """
    if not isinstance(instance_definition, dict):
        raise ValueError("Project connector instance must be an object")
    if deployment_tenant_id is not None and instance_definition.get("tenant_id") != deployment_tenant_id:
        raise ValueError("Connector instance tenant is outside deployment scope")
    if deployment_project_id is not None and instance_definition.get("project_id") != deployment_project_id:
        raise ValueError("Connector instance project is outside deployment scope")
    system_name = instance_definition.get("provider_adapter_id") or instance_definition.get("template_id")
    if not isinstance(system_name, str) or not system_name:
        raise ValueError("Connector instance has no provider adapter")
    return resolve_connector_provider(
        system_name,
        instance_definition=instance_definition,
        environment_id=environment_id,
        allowed_secret_references=allowed_secret_references,
        allowed_hosts=allowed_hosts,
    )


def _normalise_saved_instance(instance_definition: dict) -> dict:
    """Flatten a store record while keeping database identity authoritative."""
    stored_definition = instance_definition.get("definition_json")
    if not isinstance(stored_definition, dict):
        return dict(instance_definition)
    identity = {
        key: instance_definition[key]
        for key in (
            "tenant_id",
            "project_id",
            "instance_id",
            "template_id",
            "template_version",
            "system_name",
            "status",
            "enabled",
            "revision",
        )
        if key in instance_definition
    }
    flattened = {**stored_definition, **identity}
    flattened["bindings"] = instance_definition.get("bindings", [])
    return flattened


def _resolve_instance_binding(instance_definition: dict, environment_id: str | None) -> dict:
    """Select one persisted environment binding before constructing a provider."""
    definition = dict(instance_definition)
    dependency = definition.get("environment_dependency")
    bindings = definition.get("bindings") or definition.get("environment_mappings") or []
    if dependency == "dependent":
        if not environment_id:
            raise ValueError("Environment-dependent connector resolution requires an environment id")
        matches = [b for b in bindings if b.get("project_env_id") == environment_id and b.get("status", "active") == "active"]
        if len(matches) != 1:
            raise ValueError("No unique active environment binding exists for the requested environment")
        binding = matches[0]
        definition.update(binding)
        definition.update(binding.get("narrowing_filters_json") or {})
    elif bindings:
        active = [b for b in bindings if b.get("status", "active") == "active"]
        if environment_id:
            matches = [b for b in active if b.get("project_env_id") == environment_id]
            if len(matches) != 1:
                raise ValueError("No unique active environment binding exists for the requested environment")
            definition.update(matches[0])
            definition.update(matches[0].get("narrowing_filters_json") or {})
        elif len(active) == 1:
            definition.update(active[0])
            definition.update(active[0].get("narrowing_filters_json") or {})
        elif len(active) > 1:
            raise ValueError("Multiple active environment bindings require an explicit environment id")
    return definition


def _apply_scope_binding(template_id: str, definition: dict) -> dict:
    """Make a selected binding the only provider resource scope."""
    field = _RUNTIME_SCOPE_FIELDS.get(template_id)
    bound = definition.get("external_resource")
    if not field or not bound:
        return definition
    explicit = definition.get(field)
    if explicit not in (None, "", bound):
        raise ValueError(f"{field} does not match the selected environment binding")
    definition[field] = bound
    return definition


def _resolve_instance_secrets(credentials: dict, allowed_secret_references: set[str] | None) -> dict[str, str]:
    if not isinstance(credentials, dict):
        raise ValueError("Connector credentials must be an object")
    resolved: dict[str, str] = {}
    for key, reference in credentials.items():
        if not key.endswith("_ref"):
            if _SENSITIVE_FIELD.search(key) and reference not in (None, ""):
                raise ValueError("Connector credentials must use secret references")
            continue
        if not isinstance(reference, str) or not _SECRET_REF_PATTERN.fullmatch(reference):
            raise ValueError("Connector credentials must use valid secret references")
        if allowed_secret_references is not None and reference not in allowed_secret_references:
            raise ValueError("Connector secret reference is not authorized for this deployment")
        resolved[key] = environment_secret(reference)
    return resolved


def _validate_runtime_auth(template_id: str, definition: dict, credentials: dict) -> None:
    if not isinstance(credentials, dict):
        raise ValueError("Connector credentials must be an object")
    auth_type = definition.get("auth_type")
    supported = _RUNTIME_AUTH_TYPES.get(template_id)
    if supported is None:
        return
    if auth_type is not None and auth_type not in supported:
        raise ValueError(f"Auth type '{auth_type}' is not implemented by the native {template_id} provider")


def _require_runtime_values(
    template_id: str,
    definition: dict,
    credentials: dict,
    resolved_secrets: dict[str, str],
) -> None:
    required = set()
    auth_type = definition.get("auth_type")
    profiles = _RUNTIME_AUTH_TYPES.get(template_id, {})
    if auth_type in profiles:
        required.update(profiles[auth_type])
    elif profiles:
        required.update(next(iter(profiles.values())))
    for field in required:
        value = resolved_secrets.get(field) if field.endswith("_ref") else credentials.get(field)
        if value in (None, ""):
            raise ValueError(f"Connector credential '{field}' is required")


def _unix_host(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if parsed.scheme in {"sftp", "ssh"} and parsed.hostname:
        return parsed.hostname
    if endpoint and "/" not in endpoint and " " not in endpoint:
        return endpoint
    raise ValueError("Unix connector endpoint must identify an SSH host")


def _validate_endpoint_host(endpoint: str, allowed_hosts: set[str] | None, connector_type: str | None = None) -> None:
    if allowed_hosts is None:
        return
    expected = {value.lower() for value in allowed_hosts}
    hosts: list[str] = []
    if connector_type == "kafka":
        for broker in endpoint.split(","):
            parsed = urlsplit("//" + broker.strip())
            if not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                raise ValueError("Connector endpoint must not contain credentials, paths, query parameters, or fragments")
            hosts.append(parsed.hostname.lower())
    else:
        parsed = urlsplit(endpoint)
        host = parsed.hostname or endpoint
        if not host or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Connector endpoint must not contain credentials, query parameters, or fragments")
        hosts.append(host.lower())
    if any(host not in expected for host in hosts):
        raise ValueError("Connector endpoint host is not authorized for this deployment")
