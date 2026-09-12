"""Bounded protocol discovery for saved MCP/A2A connections, never tool execution."""

import asyncio
import json
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import httpx2

from app.connectors.providers.secrets import environment_secret

MAX_BYTES = 1_048_576
PROTOCOL_VERSION = "2025-11-25"


async def _read(response):
    data = bytearray()
    async for chunk in response.aiter_bytes():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise ValueError("Response exceeds the connection-test limit")
    return bytes(data)


async def _events(response, max_bytes=MAX_BYTES):
    buffer = b""
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > max_bytes:
            raise ValueError("Response exceeds the connection-test limit")
        buffer += chunk
        # SSE lines may use either CRLF or LF; do not decode partial UTF-8 chunks.
        buffer = buffer.replace(b"\r\n", b"\n")
        while b"\n\n" in buffer:
            event, buffer = buffer.split(b"\n\n", 1)
            kind, data = "message", []
            for line in event.decode("utf-8").splitlines():
                if line.startswith("event:"):
                    kind = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip(" "))
            if data:
                yield kind, "\n".join(data)


def _initialized(message):
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or message.get("id") != 1:
        raise ValueError("Invalid MCP initialization response")
    result = message.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("capabilities"), dict):
        raise ValueError("MCP initialization was rejected or invalid")
    info = result.get("serverInfo")
    if not isinstance(info, dict) or not all(isinstance(info.get(k), str) and info[k] for k in ("name", "version")):
        raise ValueError("MCP server identity is missing")
    version = result.get("protocolVersion")
    if version not in {"2024-11-05", "2025-03-26", "2025-06-18", PROTOCOL_VERSION}:
        raise ValueError("MCP server negotiated an unsupported protocol version")
    return version


async def _mcp(client, definition, headers):
    endpoint = definition.endpoint
    initialize = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
        "clientInfo": {"name": "rca-connection-test", "version": "1.0"},
    }}
    notification = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    headers = {**headers, "Accept": "application/json, text/event-stream"}
    if definition.transport == "sse":
        async with client.stream("GET", endpoint, headers=headers) as response:
            response.raise_for_status()
            events = _events(response)
            post_url = None
            async for kind, data in events:
                if kind == "endpoint":
                    post_url = urljoin(endpoint, data)
                    target, origin = urlsplit(post_url), urlsplit(endpoint)
                    if (target.scheme, target.hostname, target.port) != (origin.scheme, origin.hostname, origin.port) or target.username or target.password or target.fragment:
                        raise ValueError("MCP SSE endpoint changed origin")
                    break
            if not post_url:
                raise ValueError("MCP SSE server did not supply a message endpoint")
            async with client.stream("POST", post_url, headers=headers, json=initialize) as sent:
                sent.raise_for_status()
            async for kind, data in events:
                message = json.loads(data)
                if kind == "message" and isinstance(message, dict) and message.get("id") == 1:
                    version = _initialized(message)
                    async with client.stream("POST", post_url, headers={**headers, "MCP-Protocol-Version": version}, json=notification) as sent:
                        sent.raise_for_status()
                    return
            raise ValueError("MCP SSE initialization response was not received")
    async with client.stream("POST", endpoint, headers=headers, json=initialize) as response:
        response.raise_for_status()
        session = response.headers.get("mcp-session-id")
        if "text/event-stream" in response.headers.get("content-type", ""):
            message = None
            async for _, data in _events(response):
                candidate = json.loads(data)
                if isinstance(candidate, dict) and candidate.get("id") == 1:
                    message = candidate
                    break
        else:
            message = json.loads(await _read(response))
        version = _initialized(message)
    headers["MCP-Protocol-Version"] = version
    if session:
        headers["Mcp-Session-Id"] = session
    try:
        async with client.stream("POST", endpoint, headers=headers, json=notification) as response:
            response.raise_for_status()
    finally:
        if session:
            # End only the test session we just created. Some servers return 405.
            async with client.stream("DELETE", endpoint, headers=headers):
                pass


async def _a2a(client, definition, headers):
    endpoint = definition.endpoint
    card_url = endpoint if urlsplit(endpoint).path.endswith(".json") else urljoin(endpoint, "/.well-known/agent-card.json")
    async with client.stream("GET", card_url, headers=headers) as response:
        response.raise_for_status()
        card = json.loads(await _read(response))
    if not isinstance(card, dict) or not all(isinstance(card.get(k), str) and card[k] for k in ("name", "description", "version")):
        raise ValueError("Response is not an A2A agent card")
    if not isinstance(card.get("capabilities"), dict) or not all(isinstance(card.get(k), list) for k in ("skills", "defaultInputModes", "defaultOutputModes")):
        raise ValueError("A2A agent card is missing capabilities, skills, or input/output modes")
    url = card.get("url")
    interfaces = card.get("supportedInterfaces")
    if not (isinstance(url, str) and urlsplit(url).scheme == "https" and urlsplit(url).hostname) and not (
        isinstance(interfaces, list) and interfaces
        and all(isinstance(interface, dict) and interface.get("url") and interface.get("protocolBinding") for interface in interfaces)
    ):
        raise ValueError("A2A agent card does not advertise a service interface")


async def probe_integration(definition, settings, *, client=None):
    if definition.transport == "stdio":
        from app.connectors.providers.stdio_probe import probe_stdio
        return await probe_stdio(definition, settings)
    checked_at = datetime.now(timezone.utc).isoformat()
    allowed = {host.strip().lower() for host in settings.integration_allowed_hosts.split(",") if host.strip()}
    if urlsplit(definition.endpoint).hostname.lower() not in allowed:
        return {"status": "blocked", "message": "This host must be approved in RCA_INTEGRATION_ALLOWED_HOSTS before a connection test.", "checked_at": checked_at}
    headers = {}
    if definition.auth_method == "bearer":
        try:
            references = json.loads(settings.integration_secret_references or "{}")
        except ValueError:
            references = {}
        host_references = references.get(urlsplit(definition.endpoint).hostname.lower(), []) if isinstance(references, dict) else []
        if not isinstance(host_references, list) or definition.secret_reference not in host_references:
            return {"status": "blocked", "message": "The credential reference is not approved for integration tests.", "checked_at": checked_at}
        try:
            headers["Authorization"] = "Bearer " + environment_secret(definition.secret_reference)
        except ValueError:
            return {"status": "blocked", "message": "The referenced server credential is not configured.", "checked_at": checked_at}
    started = time.monotonic()
    owned = client is None
    client = client or httpx2.AsyncClient(timeout=definition.timeout_seconds, follow_redirects=False, trust_env=False)
    try:
        async with asyncio.timeout(definition.timeout_seconds):
            await (_mcp(client, definition, headers) if definition.kind == "mcp" else _a2a(client, definition, headers))
        result = {"status": "reachable", "message": "MCP initialization completed; tool execution was not tested." if definition.kind == "mcp" else "A2A agent card validated; task execution was not tested."}
    except httpx2.HTTPStatusError as exc:
        result = {"status": "failed", "message": f"Remote endpoint returned HTTP {exc.response.status_code}."}
    except (httpx2.HTTPError, TimeoutError):
        result = {"status": "failed", "message": "Connection failed or timed out. Check the endpoint, TLS certificate, and network access."}
    except (ValueError, KeyError, TypeError, UnicodeError):
        result = {"status": "failed", "message": "The endpoint did not return a valid supported protocol response within the size limit."}
    finally:
        if owned:
            await client.aclose()
    return {**result, "latency_ms": round((time.monotonic() - started) * 1000), "checked_at": checked_at}
