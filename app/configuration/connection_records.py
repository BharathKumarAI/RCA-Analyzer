"""Shared persisted environment-connection contract for tests and execution."""

from typing import Any


def connection_values(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize API fields once; lifecycle state is always server-owned."""
    return {
        "connection_name": record["connection_name"],
        "environment_name": record["environment_name"],
        "routing_mode": record.get("routing_mode", "direct"),
        "auth_profile_id": record.get("auth_profile_id"),
        **{
            stored: record.get(public, record.get(stored, default))
            for public, stored, default in (
                ("target", "target_json", {}),
                ("credentials", "credentials_json", {}),
                ("mcp_configuration", "mcp_config_json", {}),
                ("resource_scope", "resource_scope_json", []),
            )
        },
    }


def apply_environment_connection(
    definition: dict[str, Any], connection: dict[str, Any], *, require_enabled: bool = False
) -> dict[str, Any]:
    """Replace identity, never inherit missing fields from another connection."""
    if require_enabled and (
        connection.get("enabled") is not True or connection.get("status") != "active"
        or connection.get("test_status") != "passed"
    ):
        raise ValueError("Selected environment connection is not enabled and validated")
    values = connection_values(connection)
    target = values["target_json"]
    if not isinstance(target, dict) or set(target) - {"endpoint", "port"}:
        raise ValueError("Connection target accepts only endpoint and port")
    if "port" in target and (type(target["port"]) is not int or not 1 <= target["port"] <= 65535):
        raise ValueError("Connection port must be an integer between 1 and 65535")
    scope = values["resource_scope_json"]
    if not isinstance(scope, list) or not scope or any(not isinstance(s, str) or not s.strip() for s in scope):
        raise ValueError("Environment connection requires an explicit resource allowlist")
    resource = definition.get("external_resource")
    if resource not in scope:
        raise ValueError("Selected resource is outside the environment connection scope")
    result = {key: value for key, value in definition.items() if key not in {
        "endpoint", "port", "credentials", "auth_type", "access_mode", "transport",
        "routing_mode", "mcp_configuration", "project_key", "index", "scope", "topic", "path",
    }}
    return {
        **result, **target,
        "connection_id": connection["connection_id"],
        "auth_type": values["auth_profile_id"],
        "credentials": values["credentials_json"],
        "access_mode": values["routing_mode"],
        "mcp_configuration": values["mcp_config_json"],
        "resource_scope": scope,
    }
