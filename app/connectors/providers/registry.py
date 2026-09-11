"""Deployment-owned connector inventory; credentials stay in providers."""

from app.connectors.providers.secrets import environment_secret
from pydantic import BaseModel, ConfigDict, Field
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


def build_connectors(raw_options, mode, cleanup, injected=None, secret_references=None):
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
            values = options[name].model_dump(exclude={"enabled"})
            if name == "itsm":
                values.pop("max_results")
                values.pop("max_window_seconds")
            try:
                reference = (secret_references or {}).get(name)
                if reference:
                    values["api_token" if name == "itsm" else "token"] = (
                        environment_secret(reference)
                    )
                provider = factory(**values)
            except ValueError:
                continue  # Missing deployment credentials remain unavailable.
            cleanup.push_async_callback(provider.aclose)
            providers[name] = provider
    return providers
