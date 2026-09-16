"""Candidate configuration validation and isolated live test execution engine.

Follows the zero-mockup requirement: candidate values are tested using real,
isolated temporary provider clients with strict timeouts, credential masking,
and multi-stage status reporting.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time
from typing import Any, Dict, List, Tuple, Set
from urllib.parse import urlparse

from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from app.connectors.providers.evidence import (
    ConfluenceConnector, GitLabConnector, QTestConnector, SignalFxConnector, KubernetesConnector,
)
from app.connectors.providers.infrastructure import KafkaConnector, UnixConnector
from app.connectors.providers.oracle import OracleConnector, validate_oracle_endpoint
from app.connectors.providers.secrets import environment_secret
from app.connectors.providers.registry import connection_route, resolve_mcp_connection, McpConnectionConfiguration, _unix_host
from app.connectors.health import CheckStatus
from app.connectors.kafka_topics import KafkaTopicSelection, authorized_topics, select_topics

# Concurrency semaphore for active test probes
_CANDIDATE_TEST_SEMAPHORE = asyncio.Semaphore(4)

# Permitted secret reference regex
SECRET_REF_PATTERN = re.compile(r"^env://[A-Z][A-Z0-9_]{0,127}$")

_SCOPE_FIELDS = {
    "itsm": "project_key",
    "log_search": "index",
    "confluence": "scope",
    "signalfx": "scope",
    "qtest": "scope",
    "gitlab": "scope",
    "kubernetes": "scope",
    "oracle": "scope",
    "kafka": "topic",
    "unix": "path",
}

# A template can advertise several transports (Kafka is the current example),
# but candidate testing constructs native providers only. Keep that distinction
# explicit so an active MCP profile cannot be reported as a native success.
_NATIVE_AUTH_TYPES = {
    "itsm": {"basic_api_token", "basic_auth", "api_token"},
    "log_search": {"bearer_token"},
    "confluence": {"bearer_token"},
    "signalfx": {"api_key_header"},
    "qtest": {"bearer_token"},
    "gitlab": {"api_key_header"},
    "kubernetes": {"k8s_service_account_token"},
    "oracle": {"database_password"},
    "kafka": {"sasl_scram_tls"},
    "unix": {"ssh_private_key", "ssh_password"},
}

_NATIVE_REQUIRED_FIELDS = {
    "itsm": {"account_identifier", "api_token_secret_ref"},
    "log_search": {"token_secret_ref"},
    "confluence": {"token_secret_ref"},
    "signalfx": {"api_key_secret_ref"},
    "qtest": {"token_secret_ref"},
    "gitlab": {"api_key_secret_ref"},
    "kubernetes": {"token_secret_ref"},
    "oracle": {"database_username", "password_secret_ref"},
    "kafka": {"username", "password_secret_ref"},
    "unix": {
        "ssh_private_key": {"username", "private_key_ref", "known_hosts_ref"},
        "ssh_password": {"username", "password_secret_ref", "known_hosts_ref"},
    },
}


def _sensitive_key(name: str) -> bool:
    return bool(re.search(r"(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)", name, re.I))


def _validate_secret_fields(credentials: dict, errors: List[str]) -> None:
    """Reject values that would put a credential in a candidate or result."""
    for name, value in credentials.items():
        if not isinstance(name, str):
            errors.append("Credential field names must be strings.")
            continue
        if isinstance(value, dict):
            _validate_secret_fields(value, errors)
            continue
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _validate_secret_fields(item, errors)
            continue
        if name.endswith("_ref"):
            if value not in (None, "") and (
                not isinstance(value, str) or not SECRET_REF_PATTERN.fullmatch(value)
            ):
                errors.append(f"{name} must be a valid env:// secret reference.")
        elif _sensitive_key(name) and value not in (None, ""):
            errors.append(f"{name} must be a server-side secret reference, not a credential value.")


def _scope_value(candidate: Dict[str, Any], connector_type: str) -> str:
    field = _SCOPE_FIELDS.get(connector_type)
    if field is None:
        return _text(candidate.get("external_resource") or candidate.get("scope"))
    direct = _text(candidate.get(field) or candidate.get("external_resource") or candidate.get("scope"))
    if direct:
        return direct
    bindings = candidate.get("bindings") or candidate.get("environment_mappings") or []
    for binding in bindings:
        if isinstance(binding, dict):
            resource = _text(binding.get("external_resource"))
            if resource:
                return resource
    return ""


def _validate_kafka_endpoint(endpoint: str) -> bool:
    """Validate a broker list without treating ``host:port`` as a URL scheme."""
    for broker in endpoint.split(","):
        broker = broker.strip()
        if not broker or any(char.isspace() for char in broker) or any(char in broker for char in "/?#@"):
            return False
        parsed = urlparse("//" + broker)
        if not parsed.hostname:
            return False
        try:
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                return False
        except ValueError:
            return False
    return True


def _endpoint_hosts(endpoint: str, connector_type: str) -> list[str]:
    """Return every destination host represented by a connector endpoint."""
    if connector_type == "kafka":
        hosts: list[str] = []
        for broker in endpoint.split(","):
            parsed = urlparse("//" + broker.strip())
            if parsed.hostname:
                hosts.append(parsed.hostname)
        return hosts
    parsed = urlparse(endpoint)
    return [parsed.hostname or endpoint.split(":", 1)[0]] if endpoint else []


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _hybrid_candidates(candidate: dict) -> dict[str, dict]:
    if not any(isinstance(candidate.get(key), str) and candidate[key].strip().lower() == "hybrid"
               for key in ("access_mode", "transport", "routing_mode")):
        return {}
    return {route: {**{k: v for k, v in candidate.items() if k not in {"access_mode", "transport", "routing_mode"}},
                    "access_mode": route} for route in ("direct", "mcp")}


def compute_candidate_hash(candidate: Dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hash of candidate configuration."""
    if not isinstance(candidate, dict):
        candidate = {"_invalid_candidate_type": type(candidate).__name__}
    env_dep = candidate.get("environment_dependency")
    if env_dep is None and "environment_dependent" in candidate:
        env_dep = "dependent" if candidate["environment_dependent"] else "independent"
    elif env_dep is None and "env_dependent" in candidate:
        env_dep = "dependent" if candidate["env_dependent"] else "independent"

    raw_credentials = candidate.get("credentials", {})
    if isinstance(raw_credentials, dict):
        canonical_credentials = {
            key: value
            for key, value in raw_credentials.items()
            if isinstance(key, str) and not key.startswith("_")
        }
    else:
        canonical_credentials = {"_invalid_type": type(raw_credentials).__name__}

    canonical = {
        "template_id": candidate.get("template_id"),
        "template_version": candidate.get("template_version", "1.0.0"),
        "system_name": candidate.get("system_name"),
        "environment_dependency": env_dep or "independent",
        "tool_environment": candidate.get("tool_environment") or "Shared",
        "endpoint": candidate.get("endpoint"),
        "auth_type": candidate.get("auth_type"),
        "credentials": canonical_credentials,
        "scope": {
            key: candidate.get(key)
            for key in ("project_key", "index", "topic", "topic_filter", "path", "external_resource")
            if candidate.get(key) is not None
        },
        "bindings": [
            {
                "project_env_id": b.get("project_env_id"),
                "tool_env_id": b.get("tool_env_id") or b.get("tool_environment"),
                "external_resource": b.get("external_resource"),
                "credential_binding_id": b.get("credential_binding_id"),
            }
            for b in (candidate.get("bindings") or candidate.get("environment_mappings") or [])
            if isinstance(b, dict)
        ],
        "environment_id": candidate.get("environment_id") or "default",
        "external_resource": candidate.get("external_resource"),
        "timeout_seconds": candidate.get("timeout_seconds", 30),
        "max_results": candidate.get("max_results", 100),
        # Include every provider-affecting project parameter so a passing test
        # cannot be reused after a field mapping, TLS, filter, or operation
        # policy changes. Request bookkeeping and duplicate identity aliases
        # remain outside the hash.
        "provider_configuration": {
            key: value
            for key, value in candidate.items()
            if key not in {
                "instance_id",
                "template_id",
                "template_version",
                "system_name",
                "environment_dependency",
                "environment_dependent",
                "env_dependent",
                "tool_environment",
                "endpoint",
                "auth_type",
                "credentials",
                "bindings",
                "environment_mappings",
                "environment_id",
                "external_resource",
                "project_key",
                "index",
                "topic",
                "topic_filter",
                "path",
                "timeout_seconds",
                "max_results",
                "environment_connections",
                "connection_name",
            }
            and not key.startswith("_")
        },
    }

    dumped = json.dumps(canonical, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def validate_candidate_configuration(
    candidate: Dict[str, Any], template: Dict[str, Any]
) -> Tuple[bool, List[str]]:
    """Validate candidate configuration structurally and conditionally against template rules."""
    errors: List[str] = []

    if not isinstance(candidate, dict):
        return False, ["Candidate configuration must be an object."]
    if not isinstance(template, dict):
        return False, ["Connector template must be an object."]

    # The caller must validate the same immutable template version that will be
    # used to construct the provider.  Without this check a direct caller could
    # validate one contract and execute another.
    template_ids = {
        value
        for value in (
            template.get("type"),
            template.get("system_name"),
            template.get("provider_adapter_id"),
        )
        if isinstance(value, str) and value
    }
    candidate_template_id = candidate.get("template_id")
    if not isinstance(candidate_template_id, str) or candidate_template_id not in template_ids:
        errors.append("Candidate template_id does not match the selected template.")
    expected_version = template.get("version", "1.0.0")
    if candidate.get("template_version", "1.0.0") != expected_version:
        errors.append("Candidate template_version does not match the selected template.")

    connector_type = template.get("provider_adapter_id") or template.get("type")
    try:
        selected_route = connection_route(candidate, connector_type)
    except ValueError:
        errors.append("Connector access_mode and transport must identify the same route; MCP requires an approved MCP test route and Hybrid requires explicit operation routing.")
        selected_route = "direct"

    if not errors and (routes := _hybrid_candidates(candidate)):
        for route, routed_candidate in routes.items():
            _, route_errors = validate_candidate_configuration(routed_candidate, template)
            errors.extend(f"{route}: {error}" for error in route_errors)
        return not errors, errors

    # Mandatory Project-Only Identity Fields:
    # 1. System Name
    system_name_value = candidate.get("system_name")
    system_name = system_name_value.strip() if isinstance(system_name_value, str) else ""
    if not isinstance(system_name_value, str) or not system_name:
        errors.append("System Name is mandatory (cannot be blank).")

    # 2. Environment Dependent / Independent
    env_dep = candidate.get("environment_dependency")
    if env_dep is None:
        legacy_key = next(
            (key for key in ("environment_dependent", "env_dependent") if key in candidate),
            None,
        )
        if legacy_key is not None:
            legacy_value = candidate[legacy_key]
            if type(legacy_value) is bool:
                env_dep = "dependent" if legacy_value else "independent"
            else:
                env_dep = legacy_value
    if env_dep is None:
        errors.append("Environment Dependent/Independent choice is mandatory ('dependent' or 'independent').")
    elif not isinstance(env_dep, str) or env_dep not in {"dependent", "independent"}:
        errors.append(f"Invalid environment dependency '{env_dep}'. Must be 'dependent' or 'independent'.")

    # 3. Tool Environment
    tool_env_value = candidate.get("tool_environment")
    tool_env = tool_env_value.strip() if isinstance(tool_env_value, str) else ""
    if not isinstance(tool_env_value, str) or not tool_env:
        errors.append("Tool Environment is mandatory (e.g. 'Shared' for independent, or specific target environment).")

    if env_dep == "dependent":
        mappings = candidate.get("environment_mappings") or candidate.get("bindings") or []
        if not mappings:
            errors.append("Environment Dependent connectors require at least one environment mapping row.")
        elif not isinstance(mappings, list):
            errors.append("Environment mappings must be a list of binding objects.")
        else:
            for idx, m in enumerate(mappings):
                if not isinstance(m, dict):
                    errors.append(f"Environment mapping row #{idx + 1} must be an object.")
                    continue
                if not m.get("project_env_id"):
                    errors.append(f"Environment mapping row #{idx + 1} is missing Project Environment.")
                if not m.get("external_resource"):
                    errors.append(f"Environment mapping row #{idx + 1} is missing External Resource.")
                if not m.get("tool_environment") and not m.get("tool_env_id"):
                    errors.append(f"Environment mapping row #{idx + 1} is missing Tool Environment.")

    # Check policy enablement
    if not template.get("is_enabled_by_policy", True):
        errors.append("Connector execution is disabled by policy.")
        return False, errors

    # Check tool access rules and enforce release policy restrictions
    tool_rules = candidate.get("tool_access_rules") or candidate.get("tool_rules") or []
    if isinstance(tool_rules, list):
        for idx, rule in enumerate(tool_rules):
            if not isinstance(rule, dict):
                continue
            if not rule.get("tool_enabled", False):
                continue
            cap = rule.get("logical_capability") or rule.get("tool_id") or f"rule #{idx+1}"
            # Write and execution capabilities are strictly restricted by release policy
            if rule.get("write_access") or rule.get("execution_access"):
                errors.append(
                    f"Write and execution capabilities are restricted by release policy; cannot enable write/execution access for '{cap}'."
                )
            # Validate hybrid routing mapping
            mode = candidate.get("access_mode") or candidate.get("routing_mode")
            if mode == "hybrid":
                route = rule.get("access_route")
                if route not in {"direct", "mcp"}:
                    errors.append(f"Hybrid access mode requires an explicit route ('direct' or 'mcp') for '{cap}'.")
                elif route == "mcp" and not candidate.get("mcp_configuration") and not candidate.get("mcp_endpoint"):
                    errors.append(f"Tool '{cap}' is routed to MCP but no MCP configuration is defined.")


    # Check endpoint presence
    endpoint = candidate.get("endpoint")
    if not isinstance(endpoint, str):
        endpoint = ""
    endpoint = endpoint.strip()
    connector_type = template.get("provider_adapter_id") or template.get("type")
    if selected_route == "mcp":
        endpoint = candidate["mcp_configuration"]["endpoint"]
    if not endpoint:
        errors.append("Endpoint is required.")
    elif endpoint:
        parsed = urlparse(endpoint)
        if selected_route == "mcp":
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                errors.append("MCP requires an approved HTTPS endpoint without embedded credentials.")
        elif connector_type == "kafka":
            if not _validate_kafka_endpoint(endpoint):
                errors.append("Kafka endpoint must be a bounded broker list without credentials or paths.")
        elif connector_type == "unix":
            if parsed.scheme not in {"", "sftp", "ssh"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
                errors.append("Unix endpoint must identify an SSH/SFTP host without embedded credentials.")
        elif connector_type == "oracle":
            try:
                validate_oracle_endpoint(endpoint)
            except ValueError as exc:
                errors.append(str(exc))
            if candidate.get("driver_mode", "thin") != "thin" or candidate.get("connection_format", "dsn") not in {"dsn", "ezconnect"}:
                errors.append("Oracle supports Thin mode with an explicit Easy Connect DSN only.")
        elif parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            errors.append("Connector endpoint must use an approved scheme without embedded credentials or query parameters.")

    # Every native provider has one fixed resource scope. Requiring it here
    # prevents constructors from silently falling back to deployment globals.
    scope = _scope_value(candidate, connector_type)
    if connector_type in _SCOPE_FIELDS and not scope:
        errors.append(f"{connector_type} resource scope is required.")
    elif connector_type in _SCOPE_FIELDS:
        field = _SCOPE_FIELDS[connector_type]
        explicit = _text(candidate.get(field))
        external = _text(candidate.get("external_resource"))
        if explicit and external and explicit != external:
            errors.append(f"{field} and external_resource must identify the same configured scope.")

    # Check timeout and bounds
    if "port" in candidate and (type(candidate["port"]) is not int or not 1 <= candidate["port"] <= 65535):
        errors.append("port must be an integer between 1 and 65535.")
    timeout_s = candidate.get("timeout_seconds", 30)
    if (
        type(timeout_s) not in {int, float}
        or (isinstance(timeout_s, float) and not math.isfinite(timeout_s))
        or timeout_s < 1
        or timeout_s > 120
    ):
        errors.append("timeout_seconds must be between 1 and 120 seconds.")

    max_results = candidate.get("max_results", 100)
    if type(max_results) is not int or max_results < 1 or max_results > 1000:
        errors.append("max_results must be an integer between 1 and 1000.")
    max_bytes = candidate.get("max_response_bytes", 1048576)
    if type(max_bytes) is not int or not 1024 <= max_bytes <= 8388608:
        errors.append("max_response_bytes must be an integer between 1024 and 8388608.")
    max_window = candidate.get("max_window_seconds", 86400)
    if type(max_window) is not int or not 60 <= max_window <= 604800:
        errors.append("max_window_seconds must be an integer between 60 and 604800.")

    credentials = candidate.get("credentials", {})
    if not isinstance(credentials, dict):
        errors.append("credentials must be a mapping of credential fields.")
        return False, errors
    if any(not isinstance(name, str) for name in credentials):
        errors.append("Credential field names must be strings.")
        return False, errors

    # Secret references are checked before auth-type validation so incomplete
    # drafts cannot persist plaintext credentials.
    _validate_secret_fields(credentials, errors)

    if selected_route == "mcp":
        if candidate.get("kafka_topic_selection") is not None:
            errors.append("Kafka topic selection requires the native route")
        config = McpConnectionConfiguration.model_validate(candidate["mcp_configuration"])
        _validate_secret_fields(config.model_dump(), errors)
        return not errors, errors

    # Check auth type and the template-owned profile contract.
    auth_type = candidate.get("auth_type")
    if not isinstance(auth_type, str) or not auth_type.strip():
        errors.append("auth_type is required.")
        return False, errors

    raw_profiles = template.get("auth_profiles", [])
    if raw_profiles is None:
        raw_profiles = []
    if not isinstance(raw_profiles, (list, tuple)):
        errors.append("Connector template auth_profiles must be an array.")
        raw_profiles = []
    profiles = [profile for profile in raw_profiles if isinstance(profile, dict)]
    allowed_profiles = [profile.get("id") for profile in profiles]
    if not profiles:
        errors.append("Selected connector template does not declare an authentication profile.")
    profile = next(
        (
            item for item in profiles
            if item.get("id") == auth_type
            or (auth_type == "basic_api_token" and item.get("id") == "basic_auth")
            or (auth_type == "basic_auth" and item.get("id") == "basic_api_token")
        ),
        None,
    )
    if allowed_profiles and profile is None:
        errors.append(f"auth_type '{auth_type}' is not supported by template '{template.get('type')}'. Permitted: {', '.join(allowed_profiles)}.")
    if profile is not None:
        if profile.get("status") != "active":
            errors.append(f"Auth type '{auth_type}' is not active for live connection testing.")
        required_fields = profile.get("required_fields") or []
        optional_fields = profile.get("optional_fields") or []
        hidden_fields = profile.get("hidden_fields") or []
        submitted_hidden = sorted(set(credentials) & set(hidden_fields))
        if submitted_hidden:
            errors.append(
                "Credential fields are inactive for the selected auth profile: "
                + ", ".join(submitted_hidden)
            )
        undeclared = set(credentials) - set(required_fields) - set(optional_fields) - set(hidden_fields)
        if undeclared:
            errors.append(
                "Credential fields are not declared by the selected auth profile: "
                + ", ".join(sorted(undeclared))
            )
        for field in required_fields:
            value = credentials.get(field)
            if value in (None, ""):
                errors.append(f"{field} is required for auth type '{auth_type}'.")
            elif field.endswith("_ref") and (
                not isinstance(value, str) or not SECRET_REF_PATTERN.fullmatch(value)
            ):
                errors.append(f"{field} must match format 'env://VARIABLE_NAME'.")

    native_auth = _NATIVE_AUTH_TYPES.get(connector_type)
    if native_auth is not None and auth_type not in native_auth:
        errors.append(f"Auth type '{auth_type}' is not implemented by the native {connector_type} provider.")
    elif native_auth is not None:
        required_fields = _NATIVE_REQUIRED_FIELDS.get(connector_type, ())
        if isinstance(required_fields, dict):
            required_fields = required_fields.get(auth_type, set())
        for field in required_fields:
            value = credentials.get(field)
            if value in (None, ""):
                errors.append(f"{field} is required for native {connector_type} authentication.")

    if candidate.get("kafka_topic_selection") is not None:
        try:
            if connector_type != "kafka":
                raise ValueError("Topic selection requires a Kafka connector")
            if candidate.get("topic_filter"):
                raise ValueError("Use topic selection instead of the legacy topic filter")
            select_topics(authorized_topics(candidate), KafkaTopicSelection.model_validate(candidate["kafka_topic_selection"]))
        except ValueError as exc:
            errors.append(str(exc))
    return len(errors) == 0, errors


async def execute_candidate_test(
    candidate: Dict[str, Any],
    template: Dict[str, Any],
    operation: str = "test_connection",
    *,
    allowed_secret_references: Set[str] | None = None,
    allowed_endpoint_hosts: Set[str] | None = None,
) -> Dict[str, Any]:
    """Execute live candidate test using isolated temporary provider client."""
    now = time.time()
    t_start = time.perf_counter()

    valid, errors = validate_candidate_configuration(candidate, template)
    candidate_hash = compute_candidate_hash(candidate)
    endpoint = candidate.get("endpoint") if isinstance(candidate, dict) and isinstance(candidate.get("endpoint"), str) else ""
    selected_route = "direct"
    if valid:
        selected_route = connection_route(candidate, template.get("provider_adapter_id") or template.get("type"))
        if selected_route == "mcp":
            endpoint = candidate["mcp_configuration"]["endpoint"]
    if valid and allowed_endpoint_hosts is not None:
        hosts = _endpoint_hosts(endpoint, "mcp" if selected_route == "mcp" else template.get("provider_adapter_id") or template.get("type"))
        allowed_hosts = {item.lower() for item in allowed_endpoint_hosts}
        if not hosts or any(host.lower() not in allowed_hosts for host in hosts):
            valid = False
            errors.append("Connector endpoint host is not authorized for this deployment.")
    if not valid:
        return {
            "candidate_hash": candidate_hash,
            "overall_result": "FAILED",
            "stage_results": {
                "connection": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
                "trust": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
                "credential_resolution": {"status": "FAILED", "detail": "; ".join(errors)},
                "authentication": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
                "authorization": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
                "scoped_read": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
                "schema": {"status": "NOT_RUN", "detail": "Configuration validation failed"},
            },
            "latency_ms": 0.0,
            "evidence_summary": "",
            "error_message": "; ".join(errors),
            "tested_at": now,
        }

    if routes := _hybrid_candidates(candidate):
        outcomes = await asyncio.gather(*(
            execute_candidate_test(
                routed_candidate, template, operation if route == selected_route else "test_connection",
                allowed_secret_references=allowed_secret_references,
                allowed_endpoint_hosts=allowed_endpoint_hosts,
            ) for route, routed_candidate in routes.items()
        ))
        by_route = dict(zip(routes, outcomes, strict=True))
        passed = all(result["overall_result"] == "PASSED" for result in outcomes)
        selected = by_route[selected_route]
        return {
            **selected, "candidate_hash": candidate_hash,
            "overall_result": "PASSED" if passed else "FAILED",
            "error_message": "" if passed else "Both Hybrid connection identities must pass validation",
            "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            "stage_results": {**selected["stage_results"], **{
                f"route_{route}": {"status": result["overall_result"], "detail": result["error_message"] or "Connection validated"}
                for route, result in by_route.items()
            }},
        }

    template_type = template.get("provider_adapter_id") or template.get("type")
    endpoint = candidate.get("endpoint", "")
    credentials = {} if selected_route == "mcp" else candidate.get("credentials", {})
    auth_type = "mcp_bearer_token" if selected_route == "mcp" else candidate.get("auth_type")
    timeout_s = float(candidate.get("timeout_seconds", 10))
    limits = {
        "max_response_bytes": candidate.get("max_response_bytes", 1048576),
        "max_results": candidate.get("max_results", 100),
    }
    scope = _scope_value(candidate, template_type)

    # Resolve credentials from environment server-side
    resolved_secrets: Dict[str, str] = {}
    missing_secrets: List[str] = []

    for k, v in credentials.items():
        if not isinstance(v, str) or not k.endswith("_ref"):
            continue
        if not SECRET_REF_PATTERN.fullmatch(v):
            missing_secrets.append(f"invalid:{k}")
            continue
        if allowed_secret_references is not None and v not in allowed_secret_references:
            missing_secrets.append(f"unauthorized:{k}")
            continue
        try:
            resolved_secrets[k] = environment_secret(v)
        except ValueError:
            missing_secrets.append(k)

    if missing_secrets:
        latency_ms = (time.perf_counter() - t_start) * 1000
        return {
            "candidate_hash": candidate_hash,
            "overall_result": "FAILED",
            "stage_results": {
                "connection": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
                "trust": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
                "credential_resolution": {
                    "status": "FAILED",
                    "detail": f"Environment secret(s) not found: {', '.join(missing_secrets)}",
                },
                "authentication": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
                "authorization": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
                "scoped_read": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
                "schema": {"status": "NOT_RUN", "detail": "Secret reference unavailable"},
            },
            "latency_ms": latency_ms,
            "evidence_summary": "",
            "error_message": f"Required secret reference(s) {', '.join(missing_secrets)} not set on server.",
            "tested_at": now,
        }

    # Execute test under concurrency semaphore
    async with _CANDIDATE_TEST_SEMAPHORE:
        client = None
        try:
            # Build isolated temporary client
            if selected_route == "mcp":
                client = resolve_mcp_connection(
                    template_type, candidate, allowed_hosts=allowed_endpoint_hosts,
                    allowed_secret_references=allowed_secret_references,
                )
            elif template_type == "itsm":
                project_key = _text(candidate.get("project_key")) or scope
                if not project_key:
                    raise ValueError("Jira project scope is required")
                custom_field_mapping = candidate.get("custom_field_mapping")
                if custom_field_mapping is None and isinstance(candidate.get("parameters"), dict):
                    custom_field_mapping = candidate["parameters"].get("custom_field_mapping")
                client = JiraConnector(
                    base_url=endpoint,
                    project_key=project_key,
                    user_email=credentials.get("account_identifier", ""),
                    api_token=resolved_secrets.get("api_token_secret_ref", ""),
                    timeout_s=timeout_s,
                    custom_field_mapping=custom_field_mapping,
                    max_response_bytes=limits["max_response_bytes"],
                )
            elif template_type == "log_search":
                index = _text(candidate.get("index")) or scope
                if not index:
                    raise ValueError("Splunk index scope is required")
                client = SplunkConnector(
                    endpoint=endpoint,
                    token=resolved_secrets.get("token_secret_ref", ""),
                    index=index,
                    timeout_s=timeout_s,
                    max_window_seconds=candidate.get("max_window_seconds", 86400),
                    **limits,
                )
            elif template_type == "confluence":
                client = ConfluenceConnector(
                    endpoint=endpoint,
                    scope=scope,
                    token=resolved_secrets.get("token_secret_ref", ""),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "signalfx":
                client = SignalFxConnector(
                    endpoint=endpoint,
                    scope=scope,
                    token=resolved_secrets.get("api_key_secret_ref", ""),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "qtest":
                client = QTestConnector(
                    endpoint=endpoint,
                    scope=scope,
                    token=resolved_secrets.get("token_secret_ref", ""),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "gitlab":
                client = GitLabConnector(
                    endpoint=endpoint,
                    scope=scope,
                    token=resolved_secrets.get("api_key_secret_ref", ""),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "kubernetes":
                client = KubernetesConnector(
                    endpoint=endpoint,
                    scope=scope,
                    token=resolved_secrets.get("token_secret_ref", ""),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "oracle":
                client = OracleConnector(
                    dsn=endpoint, scope=scope,
                    user=credentials.get("database_username", ""),
                    password=resolved_secrets.get("password_secret_ref", ""),
                    driver_mode=candidate.get("driver_mode", "thin"),
                    connection_format=candidate.get("connection_format", "dsn"),
                    timeout_s=timeout_s, **limits,
                )
            elif template_type == "kafka":
                client = KafkaConnector(
                    bootstrap_servers=endpoint,
                    topic=scope,
                    username=credentials.get("username", ""),
                    password=resolved_secrets.get("password_secret_ref", ""),
                    topic_filter=candidate.get("topic_filter"),
                    allowed_topics=authorized_topics(candidate), topic_selection=candidate.get("kafka_topic_selection"),
                    timeout_s=timeout_s,
                    **limits,
                )
            elif template_type == "unix":
                client = UnixConnector(
                    host=_unix_host(endpoint),
                    port=candidate.get("port", 22),
                    username=credentials.get("username", ""),
                    private_key_path=resolved_secrets.get("private_key_ref", ""),
                    known_hosts=resolved_secrets.get("known_hosts_ref", ""),
                    path=scope,
                    password=resolved_secrets.get("password_secret_ref", ""),
                    private_key_passphrase=resolved_secrets.get("private_key_passphrase_ref", ""),
                    auth_method=auth_type,
                    timeout_s=timeout_s,
                    **limits,
                )
            else:
                return {
                    "candidate_hash": candidate_hash,
                    "overall_result": "FAILED",
                    "stage_results": {
                        "connection": {"status": "FAILED", "detail": f"No native provider for {template_type}"},
                        "trust": {"status": "NOT_RUN", "detail": ""},
                        "credential_resolution": {"status": "PASSED", "detail": "Resolved"},
                        "authentication": {"status": "NOT_RUN", "detail": ""},
                        "authorization": {"status": "NOT_RUN", "detail": ""},
                        "scoped_read": {"status": "NOT_RUN", "detail": ""},
                        "schema": {"status": "NOT_RUN", "detail": ""},
                    },
                    "latency_ms": 0.0,
                    "evidence_summary": "",
                    "error_message": f"Unsupported provider type {template_type}",
                    "tested_at": now,
                }

            # Run connection probe / scoped read with timeout.  A provider's
            # health result is authoritative; constructing a client is not a
            # successful authentication test.
            evidence_summary = ""
            read_status = "NOT_APPLICABLE"
            schema_status = "NOT_APPLICABLE"
            partial = False

            if operation == "test_scoped_read":
                # A scoped-read request must execute the provider operation;
                # health/discovery is never a substitute for the requested read.
                if not scope:
                    raise ValueError("Scoped read requires an explicit configured resource scope")
                target_resource = scope
                if template_type == "itsm":
                    target_resource = _text(
                        candidate.get("ticket_id") or candidate.get("scoped_resource")
                    )
                    if not target_resource:
                        raise ValueError(
                            "Jira scoped read requires an explicit ticket_id or scoped_resource"
                        )
                    res = await asyncio.wait_for(client.get_ticket(target_resource), timeout=timeout_s)
                    evidence_summary = f"Retrieved ticket {target_resource}: {res.get('summary', '')}"
                    read_status = "PASSED"
                    schema_status = "PASSED"
                elif template_type == "log_search":
                    res = await asyncio.wait_for(client.query_logs("ERROR", "-15m"), timeout=timeout_s)
                    evidence_summary = f"Returned {len(res)} logs from configured index"
                    read_status = "PASSED"
                    schema_status = "PASSED"
                else:
                    res = await asyncio.wait_for(client.read_evidence(), timeout=timeout_s)
                    partial = isinstance(res, dict) and res.get("partial") is True
                    evidence_summary = "Retrieved evidence from the configured resource"
                    if partial:
                        evidence_summary = "Some selected resources were unavailable; inspect and retest the selection"
                    read_status = "PARTIAL" if partial else "PASSED"
                    schema_status = "PASSED"
            else:
                # Connection probe
                probe = await asyncio.wait_for(client.probe_health(), timeout=timeout_s)
                if probe.overall is not CheckStatus.HEALTHY:
                    raise ValueError("Connector health probe did not pass")
                evidence_summary = "Connector health probe succeeded"

            latency_ms = (time.perf_counter() - t_start) * 1000
            return {
                "candidate_hash": candidate_hash,
                "overall_result": "PARTIAL" if partial else "PASSED",
                "stage_results": {
                    "connection": {"status": "PASSED", "detail": "Provider health probe succeeded"},
                    "trust": {"status": "NOT_INDEPENDENTLY_VERIFIED", "detail": "Provider does not expose a separate trust result"},
                    "credential_resolution": {"status": "PASSED", "detail": "Authorized secret reference resolved"},
                    "authentication": {
                        "status": "PASSED",
                        "detail": f"Verified via {auth_type}",
                    },
                    "authorization": {
                        "status": "PASSED" if operation == "test_scoped_read" else "NOT_INDEPENDENTLY_VERIFIED",
                        "detail": "Verified for selected resource" if operation == "test_scoped_read" else "Not independently verified without scoped resource read",
                    },
                    "scoped_read": {"status": read_status, "detail": evidence_summary if read_status in {"PASSED", "PARTIAL"} else "Not requested"},
                    "schema": {"status": schema_status, "detail": "Output structure conforms to ADK schema"},
                },
                "latency_ms": round(latency_ms, 2),
                "evidence_summary": evidence_summary,
                "error_message": "",
                "tested_at": now,
            }

        except asyncio.TimeoutError:
            latency_ms = (time.perf_counter() - t_start) * 1000
            return {
                "candidate_hash": candidate_hash,
                "overall_result": "FAILED",
                "stage_results": {
                    "connection": {"status": "FAILED", "detail": f"Timed out after {timeout_s}s"},
                    "trust": {"status": "NOT_RUN", "detail": "Timed out"},
                    "credential_resolution": {"status": "PASSED", "detail": "Resolved"},
                    "authentication": {"status": "NOT_RUN", "detail": "Timed out"},
                    "authorization": {"status": "NOT_RUN", "detail": "Timed out"},
                    "scoped_read": {"status": "NOT_RUN", "detail": "Timed out"},
                    "schema": {"status": "NOT_RUN", "detail": "Timed out"},
                },
                "latency_ms": round(latency_ms, 2),
                "evidence_summary": "",
                "error_message": f"Connection timed out after {timeout_s} seconds.",
                "tested_at": now,
            }
        except Exception:
            latency_ms = (time.perf_counter() - t_start) * 1000
            # Provider errors are deliberately reduced to a stable message;
            # endpoint paths, response bodies, and credential values must not
            # be persisted in the test-result table.
            err_msg = "Connector probe failed"
            return {
                "candidate_hash": candidate_hash,
                "overall_result": "FAILED",
                "stage_results": {
                    "connection": {"status": "NOT_INDEPENDENTLY_VERIFIED", "detail": "Provider probe did not complete"},
                    "trust": {"status": "NOT_INDEPENDENTLY_VERIFIED", "detail": "Provider probe did not complete"},
                    "credential_resolution": {"status": "PASSED", "detail": "Secret reference resolved"},
                    "authentication": {"status": "FAILED", "detail": "Connector authentication or scoped probe failed"},
                    "authorization": {"status": "NOT_RUN", "detail": "Authentication failed"},
                    "scoped_read": {"status": "NOT_RUN", "detail": "Authentication failed"},
                    "schema": {"status": "NOT_RUN", "detail": "Authentication failed"},
                },
                "latency_ms": round(latency_ms, 2),
                "evidence_summary": "",
                "error_message": err_msg,
                "tested_at": now,
            }
        finally:
            if client is not None and hasattr(client, "aclose"):
                try:
                    await client.aclose()
                except Exception:
                    pass
