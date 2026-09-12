"""Convert Claude/Cursor MCP JSON and commands into the existing registration model."""

import json
import re
import shlex
from urllib.parse import urlsplit

from pydantic import ValidationError

from app.configuration.integrations import IntegrationDefinition

MAX_IMPORT_BYTES = 65_536


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON contains duplicate keys; keep one value for each key")
        result[key] = value
    return result


def parse_mcp_json(source: str) -> list[dict]:
    if len(source.encode()) > MAX_IMPORT_BYTES:
        raise ValueError("MCP JSON must be smaller than 64 KiB")
    try:
        data = json.loads(source, object_pairs_hook=_unique_object)
    except (json.JSONDecodeError, RecursionError):
        raise ValueError("Invalid JSON; check commas, quotes and braces") from None
    if not isinstance(data, dict):
        raise ValueError("Paste an mcpServers object or a single remote server object")
    if "mcpServers" in data:
        if set(data) != {"mcpServers"}:
            raise ValueError("Import only the mcpServers section, without other client settings")
        servers = data["mcpServers"]
    else:
        servers = {data.get("name", "mcp-server"): data} if isinstance(data.get("name", "mcp-server"), str) else {}
    if not isinstance(servers, dict) or not 1 <= len(servers) <= 20:
        raise ValueError("Include between 1 and 20 named MCP servers")
    result, ids = [], set()
    for name, server in servers.items():
        if not isinstance(name, str) or not name.strip() or len(name) > 120 or not isinstance(server, dict):
            raise ValueError("Each server needs a name and a configuration object")
        if set(server) - {"name", "url", "type", "headers", "description", "timeout", "command", "args", "env"}:
            raise ValueError("Unsupported MCP fields. Supported fields are url, type, headers, command, args, env, name, description and timeout")
        transport = server.get("type")
        if "command" in server and transport is None:
            transport = "stdio"
        if transport is None:
            url = server.get("url")
            transport = "sse" if isinstance(url, str) and urlsplit(url).path.rstrip("/").endswith("/sse") else "http"
        if not isinstance(transport, str) or transport not in {"http", "streamable-http", "streamable_http", "sse", "stdio"}:
            raise ValueError("Use HTTP, Streamable HTTP, SSE or stdio transport")
        headers = server.get("headers", {})
        if not isinstance(headers, dict) or any(key.lower() != "authorization" for key in headers) or len(headers) > 1:
            raise ValueError("Only Authorization bearer references are supported; remove other headers")
        reference = ""
        if headers:
            authorization = next(iter(headers.values()))
            match = re.fullmatch(r"Bearer (?:\$\{(?:env:)?([A-Z][A-Z0-9_]{0,127})\}|env://([A-Z][A-Z0-9_]{0,127}))", authorization, re.I) if isinstance(authorization, str) else None
            if not match:
                raise ValueError("Replace the bearer token with ${TOKEN_NAME}, ${env:TOKEN_NAME} or env://TOKEN_NAME; raw secrets are not stored")
            reference = "env://" + (match[1] or match[2])
        environment = server.get("env", {})
        if not isinstance(environment, dict):
            raise ValueError("env must map variable names to environment references")
        environment = {key: _environment_reference(value) for key, value in environment.items()}
        try:
            definition = IntegrationDefinition(
                name=name, kind="mcp", endpoint=server.get("url", ""),
                command=server.get("command", ""), args=server.get("args", ()), env=environment,
                description=server.get("description", ""),
                transport=transport if transport in {"sse", "stdio"} else "streamable_http",
                auth_method="bearer" if reference else "none", secret_reference=reference,
                timeout_seconds=server.get("timeout", 30),
            )
        except (ValidationError, ValueError):
            # Never echo a pasted URL/header or Pydantic's input-bearing error.
            raise ValueError("Check the connection fields and timeout (1–120 seconds). Use either an HTTPS URL without credentials or query parameters, or a command with an args array and env references") from None
        integration_id = re.sub(r"[^a-z0-9_-]+", "-", name.lower()).strip("-_")[:64]
        if not integration_id or not integration_id[0].isalpha():
            integration_id = ("mcp-" + integration_id)[:64]
        if integration_id in ids:
            raise ValueError("Server names produce duplicate IDs; rename them before importing")
        ids.add(integration_id)
        result.append({"id": integration_id, "definition": definition.model_dump(mode="json")})
    return result


def _environment_reference(value):
    if not isinstance(value, str):
        raise ValueError("Environment values must be references, never raw secrets")
    match = re.fullmatch(r"(?:\$\{(?:env:)?([A-Z][A-Z0-9_]{0,127})\}|env://([A-Z][A-Z0-9_]{0,127}))", value)
    if not match:
        raise ValueError("Use ${TOKEN_NAME}, ${env:TOKEN_NAME} or env://TOKEN_NAME for environment values")
    return "env://" + (match[1] or match[2])


def parse_mcp_command(source: str) -> list[dict]:
    if len(source.encode()) > MAX_IMPORT_BYTES:
        raise ValueError("Command exceeds the import size limit")
    try:
        parts = shlex.split(source)
    except ValueError:
        raise ValueError("Check quoting in the command") from None
    if not parts:
        raise ValueError("Enter an MCP server command")
    return parse_mcp_json(json.dumps({"command": parts[0], "args": parts[1:]}))
