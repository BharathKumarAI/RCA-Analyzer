"""Bounded MCP calls using deployment-approved tool names and fixed scope arguments."""

import asyncio
import json
import re

import httpx2

from jsonschema import validate
from jsonschema.exceptions import ValidationError, SchemaError
from mcp.types import CallToolResult

from app.connectors.base import ConnectorError
from app.connectors.providers.evidence import EvidenceConnector
from app.connectors.providers.integration_probe import _events, _initialized, PROTOCOL_VERSION
from app.connectors.providers.splunk import _bounded_window


class McpEvidenceConnector(EvidenceConnector):
    def __init__(self, connector_id, *, mcp_tools, **kwargs):
        if not mcp_tools:
            raise ValueError("MCP requires deployment-approved operation bindings")
        expected = {"itsm": "get_ticket", "log_search": "query_range"}.get(connector_id, "read_evidence")
        if set(mcp_tools) != {expected}:
            raise ValueError("MCP bindings must match the connector's governed operation")
        super().__init__(connector_id, auth_header="Authorization", **kwargs)
        self.bindings = mcp_tools
        self.max_window_seconds = kwargs.get("max_window_seconds", 86400)

    async def _rpc(self, headers, method, params=None, request_id=None):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if request_id is not None:
            body["id"] = request_id
        async with self._client.stream("POST", self.endpoint, headers=headers, json=body) as response:
            if not 200 <= response.status_code < 300:
                raise ConnectorError("MCP request rejected")
            session_id = response.headers.get("mcp-session-id")
            if request_id is None:
                await self.read_limited(response)
                return None, session_id
            if "text/event-stream" in response.headers.get("content-type", ""):
                message = None
                async for _, data in _events(response, max_bytes=self.max_response_bytes):
                    candidate = json.loads(data)
                    if isinstance(candidate, dict) and candidate.get("id") == request_id:
                        message = candidate
                        break
            else:
                message = json.loads(await self.read_limited(response))
            if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or message.get("id") != request_id or "error" in message:
                raise ConnectorError("Invalid MCP response")
            return message, session_id

    async def _execute(self, operation, arguments=None, *, probe=False):
        binding = self.bindings.get(operation)
        if not binding:
            raise ConnectorError("MCP operation has no approved binding")
        headers = {"Accept": "application/json, text/event-stream"}
        try:
            async with asyncio.timeout(self.timeout_s):
                message, session = await self._rpc(headers, "initialize", {
                    "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                    "clientInfo": {"name": "rca-evidence", "version": "1.0"},
                }, 1)
                headers["MCP-Protocol-Version"] = _initialized(message)
                if session:
                    headers["Mcp-Session-Id"] = session
                try:
                    await self._rpc(headers, "notifications/initialized")
                    listing, _ = await self._rpc(headers, "tools/list", {}, 2)
                    offered = listing.get("result", {}).get("tools", [])
                    tool = next((item for item in offered if item.get("name") == binding.name), None)
                    if tool is None:
                        raise ConnectorError("Approved MCP tool is not advertised on the first catalog page")
                    # Deployment approval is the authority; annotations alone never grant access.
                    annotations = tool.get("annotations", {})
                    if annotations.get("readOnlyHint") is not True or annotations.get("destructiveHint", False):
                        raise ConnectorError("MCP tool must advertise non-destructive read-only semantics")
                    mapped = {binding.argument_map.get(key, key): value for key, value in (arguments or {}).items()}
                    if set(mapped) & (set(binding.arguments) | {binding.scope_argument}):
                        raise ConnectorError("MCP fixed arguments cannot overwrite tool inputs")
                    supplied = {**mapped, **binding.arguments, binding.scope_argument: self.scope}
                    schema = tool.get("inputSchema")
                    # Remote schema references must never trigger URL/file resolution.
                    if not isinstance(schema, dict) or any(f'"{key}"' in json.dumps(schema) for key in ("$ref", "$dynamicRef", "$recursiveRef")):
                        raise ConnectorError("MCP input schema must be self-contained")
                    if not probe:
                        validate(supplied, schema)
                        result, _ = await self._rpc(headers, "tools/call", {"name": binding.name, "arguments": supplied}, 3)
                        payload = CallToolResult.model_validate(result.get("result"))
                        if payload.isError:
                            raise ConnectorError("MCP tool reported failure")
                        if any(item.type != "text" for item in payload.content):
                            raise ConnectorError("Only text and structured MCP evidence are supported")
                        return {"content": [item.text for item in payload.content], "structured": payload.structuredContent}
                    return {"operation": operation, "schema_checked": True}
                finally:
                    if session:
                        async with self._client.stream("DELETE", self.endpoint, headers=headers):
                            pass
        except (ValueError, TypeError, KeyError, ValidationError, SchemaError, httpx2.HTTPError, TimeoutError):
            raise ConnectorError("MCP protocol, schema or deadline check failed") from None

    async def read_evidence(self):
        return await self._execute("read_evidence")

    async def probe_health(self):
        # Discovery proves the configured operations exist; it does not execute them.
        import time
        from app.connectors.health import ConnectorHealth, CheckStatus
        started = time.monotonic()
        statuses = {}
        for operation in self.bindings:
            try:
                await self._execute(operation, probe=True)
                statuses[operation] = CheckStatus.HEALTHY
            except Exception:
                statuses[operation] = CheckStatus.UNHEALTHY
        healthy = all(status == CheckStatus.HEALTHY for status in statuses.values())
        return ConnectorHealth(connector_id=self.connector_id, overall=CheckStatus.HEALTHY if healthy else CheckStatus.UNHEALTHY,
                               latency_ms=(time.monotonic() - started) * 1000, capability_health=statuses,
                               message="MCP binding discovery completed; execution is checked per call")

    async def get_ticket(self, ticket_id: str):
        if not re.fullmatch(rf"{re.escape(self.scope)}-\d+", ticket_id):
            raise ConnectorError("Ticket is outside deployment scope")
        return await self._execute("get_ticket", {"ticket_id": ticket_id})

    async def query_logs(self, query: str, start_time: str):
        if not query.strip() or len(query) > 256 or not re.fullmatch(r"[A-Za-z0-9_.:/= -]+", query) or re.search(r"\b(?:OR|AND|index)\b", query, re.I):
            raise ValueError("Only bounded literal search terms are supported")
        start, end = _bounded_window(start_time, None, self.max_window_seconds)
        return await self._execute("query_range", {"query": query, "start_time": start, "end_time": end})
