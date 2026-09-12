"""Deployment-owned connector inventory; credentials stay in providers."""

from app.connectors.providers.secrets import environment_secret
import re
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector


class ConnectorOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = True
    timeout_s: float = Field(default=5, gt=0, le=60)
    max_connections: int = Field(default=8, ge=1, le=100)
    max_keepalive_connections: int = Field(default=4, ge=0, le=100)
    max_response_bytes: int = Field(default=1048576, ge=1024, le=8388608)
    max_results: int = Field(default=100, ge=1, le=1000)
    max_window_seconds: int = Field(default=86400, ge=60, le=604800)
    secrets: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_secrets(self):
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
    factories = {"itsm": JiraConnector, "log_search": SplunkConnector}
    if not isinstance(raw_options, dict) or set(raw_options) != set(factories):
        raise ValueError("connectors.yaml must define itsm and log_search")
    options = {
        name: ConnectorOptions.model_validate(raw_options[name]) for name in factories
    }
    providers = {}
    if injected is not None:
        if set(injected) - set(factories):
            raise ValueError("Unknown injected connector")
        providers.update(injected)
    elif mode == "live":
        for name, factory in factories.items():
            if not options[name].enabled:
                continue
            values = options[name].model_dump(exclude={"enabled", "secrets"})
            values.update((runtime_values or {}).get(name, {}))
            connector_secrets = _resolve_secret_values(name, options[name], secret_references)
            for arg_name, reference in connector_secrets.items():
                values[arg_name] = environment_secret(reference)
            if name == "itsm":
                values.pop("max_results")
                values.pop("max_window_seconds")
            try:
                provider = factory(**values)
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
