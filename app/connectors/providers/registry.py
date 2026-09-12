"""Deployment-owned connector inventory; credentials stay in providers."""

from app.connectors.providers.secrets import environment_secret
import re
from typing import Literal
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
