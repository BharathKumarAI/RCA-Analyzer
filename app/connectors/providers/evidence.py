"""Read-only REST evidence with deployment-owned destinations and resource scope."""

import asyncio
import json
import os
import re
import ssl
import time
from urllib.parse import quote, urlsplit

import httpx2

from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import CheckStatus, ConnectorHealth


def identifier(value: str) -> str:
    if not isinstance(value, str) or (value in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", value)):
        raise ValueError("Invalid resource identifier")
    return quote(value, safe="")


class EvidenceConnector(BaseConnector):
    """Shared bounded HTTPS lifecycle for scoped evidence providers."""

    def __init__(self, connector_id, *, endpoint=None, scope=None, token=None,
                 timeout_s=5, max_response_bytes=1048576, max_results=100,
                 max_connections=8, max_keepalive_connections=4,
                 max_window_seconds=86400, client=None, auth_header=None):
        super().__init__(connector_id, max_response_bytes=max_response_bytes)
        prefix = connector_id.upper()
        self.endpoint = endpoint or os.getenv(f"{prefix}_ENDPOINT", "")
        self.scope = scope or os.getenv(f"{prefix}_SCOPE", "")
        token = token or os.getenv(f"{prefix}_TOKEN", "")
        url = urlsplit(self.endpoint)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("A deployment-owned HTTPS endpoint is required")
        if not self.scope or not token:
            raise ValueError("Deployment scope and credential are required")
        identifier(self.scope)
        self.timeout_s, self.max_results = timeout_s, max_results
        self._client = client or httpx2.AsyncClient(
            timeout=timeout_s, follow_redirects=False, trust_env=False,
            verify=ssl.create_default_context(cafile=os.getenv(f"{prefix}_CA_FILE") or None),
            limits=httpx2.Limits(max_connections=max_connections,
                                max_keepalive_connections=max_keepalive_connections),
        )
        header = auth_header or {"gitlab": "PRIVATE-TOKEN", "signalfx": "X-SF-Token"}.get(connector_id, "Authorization")
        self._client.headers.update({header: token if header != "Authorization" else f"Bearer {token}", "Accept": "application/json"})

    async def get(self, path, params=None):
        try:
            async with asyncio.timeout(self.timeout_s):
                async with self._client.stream("GET", self.endpoint.rstrip("/") + path, params=params) as response:
                    if not 200 <= response.status_code < 300:
                        raise ConnectorError(f"Connector returned HTTP {response.status_code}")
                    return json.loads(await self.read_limited(response))
        except (httpx2.HTTPError, TimeoutError, ValueError):
            raise ConnectorError("Connector request failed or returned invalid JSON") from None

    async def probe_health(self):
        started = time.monotonic()
        try:
            await self.read_evidence()
            status, message = CheckStatus.HEALTHY, "Scoped read operation succeeded"
        except (ConnectorError, ValueError, KeyError, TypeError):
            status, message = CheckStatus.UNHEALTHY, "Scoped read operation failed"
        return ConnectorHealth(connector_id=self.connector_id, overall=status,
                               latency_ms=(time.monotonic() - started) * 1000,
                               connectivity=status, capability_health={"read_evidence": status}, message=message)

    async def aclose(self):
        await self._client.aclose()

    def rows(self, value):
        if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
            raise ConnectorError("Unexpected evidence response schema")
        return {"items": value[:self.max_results], "possibly_truncated": len(value) >= self.max_results}


class ConfluenceConnector(EvidenceConnector):
    def __init__(self, **kwargs):
        super().__init__("confluence", **kwargs)

    async def read_evidence(self):
        data = await self.get(f"/api/v2/spaces/{identifier(self.scope)}/pages", {"limit": min(self.max_results, 100), "body-format": "storage"})
        if not isinstance(data, dict):
            raise ConnectorError("Unexpected Confluence response")
        result = self.rows(data.get("results"))
        if any(str(row.get("spaceId")) != self.scope for row in result["items"]):
            raise ConnectorError("Confluence space mismatch")
        result["items"] = [{key: row.get(key) for key in ("id", "title", "spaceId", "status", "version", "body")} for row in result["items"]]
        result["possibly_truncated"] |= bool(data.get("_links", {}).get("next"))
        return result


class GitLabConnector(EvidenceConnector):
    def __init__(self, **kwargs):
        super().__init__("gitlab", **kwargs)

    async def read_evidence(self):
        data = await self.get(f"/projects/{identifier(self.scope)}/deployments", {"per_page": min(self.max_results, 100), "order_by": "updated_at", "sort": "desc"})
        result = self.rows(data)
        result["items"] = [{key: row.get(key) for key in ("id", "iid", "sha", "ref", "status", "created_at", "updated_at", "environment")} for row in result["items"]]
        return result


class QTestConnector(EvidenceConnector):
    def __init__(self, **kwargs):
        super().__init__("qtest", **kwargs)

    async def read_evidence(self):
        data = await self.get(f"/projects/{identifier(self.scope)}/test-runs", {"parentId": 0, "parentType": "root"})
        result = self.rows(data)
        result["items"] = [{key: row.get(key) for key in ("id", "name", "pid", "test_case", "test_case_version_id", "properties", "last_test_log")} for row in result["items"]]
        return result


class SignalFxConnector(EvidenceConnector):
    def __init__(self, **kwargs):
        super().__init__("signalfx", **kwargs)

    async def read_evidence(self):
        data = await self.get(f"/v2/detector/{identifier(self.scope)}")
        if not isinstance(data, dict) or str(data.get("id")) != self.scope:
            raise ConnectorError("SignalFx detector scope or schema mismatch")
        return {key: data.get(key) for key in ("id", "name", "description", "rules", "tags", "lastUpdated")}


class KubernetesConnector(EvidenceConnector):
    def __init__(self, **kwargs):
        super().__init__("kubernetes", **kwargs)

    async def read_evidence(self):
        data = await self.get(f"/api/v1/namespaces/{identifier(self.scope)}/pods", {"limit": self.max_results})
        if not isinstance(data, dict) or data.get("kind") != "PodList":
            raise ConnectorError("Unexpected Kubernetes response")
        result = self.rows(data.get("items"))
        if any(row.get("metadata", {}).get("namespace") != self.scope for row in result["items"]):
            raise ConnectorError("Kubernetes namespace mismatch")
        # Never return pod specs, environment variables or mounted secret references.
        result["items"] = [{"name": row.get("metadata", {}).get("name"), "namespace": self.scope, "status": row.get("status")} for row in result["items"]]
        result["possibly_truncated"] |= bool(data.get("metadata", {}).get("continue"))
        return result
