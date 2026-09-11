"""Jira REST connector with scoped, read-only access."""

import os
import json
import re
import time
from typing import Any, Dict, Optional
from urllib.parse import quote
import httpx2
from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


class JiraConnector(BaseConnector):
    """ITSM connector implementation for Jira Cloud / Server."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        project_key: Optional[str] = None,
        user_email: Optional[str] = None,
        api_token: Optional[str] = None,
        *,
        client: Optional[httpx2.AsyncClient] = None,
        allow_insecure: bool = False,
        timeout_s: float = 5.0,
        max_connections: int = 10,
        max_keepalive_connections: int = 5,
        max_response_bytes: int = 1_048_576,
    ):
        super().__init__(connector_id="itsm", max_response_bytes=max_response_bytes)
        self.base_url = base_url or os.getenv("JIRA_BASE_URL")
        self.project_key = project_key or os.getenv("JIRA_PROJECT_KEY")
        self.user_email = user_email or os.getenv("JIRA_USER_EMAIL")
        self.api_token = api_token or os.getenv("JIRA_API_TOKEN")
        if (
            not self.base_url
            or not self.project_key
            or not self.user_email
            or not self.api_token
        ):
            raise ValueError(
                "JIRA_BASE_URL, JIRA_PROJECT_KEY, JIRA_USER_EMAIL, and JIRA_API_TOKEN are required"
            )
        if not allow_insecure and not self.base_url.startswith("https://"):
            raise ValueError("Jira base_url must use https")
        self._client = client or httpx2.AsyncClient(
            base_url=self.base_url,
            timeout=httpx2.Timeout(timeout_s),
            limits=httpx2.Limits(
                max_connections=max_connections,
                max_keepalive_connections=max_keepalive_connections,
            ),
            follow_redirects=False,
        )
        self._client.auth = httpx2.BasicAuth(self.user_email, self.api_token)
        self._client.headers.update({"Accept": "application/json"})

    async def probe_health(self) -> ConnectorHealth:
        start = time.perf_counter()
        try:
            async with self._client.stream(
                "GET", f"/rest/api/2/project/{quote(self.project_key, safe='')}"
            ) as response:
                latency = (time.perf_counter() - start) * 1000
                status = _status_for_response(response)
                schema_ok = False
                if 200 <= response.status_code < 300:
                    try:
                        body = await self.read_limited(response)
                        health_payload = json.loads(body)
                        schema_ok = (
                            isinstance(health_payload, dict)
                            and health_payload.get("key") == self.project_key
                        )
                        if not schema_ok:
                            status = CheckStatus.SCHEMA_MISMATCH
                    except (ValueError, ConnectorError):
                        status = CheckStatus.SCHEMA_MISMATCH
                health = ConnectorHealth(
                    connector_id=self.connector_id,
                    overall=status,
                    latency_ms=latency,
                    connectivity=CheckStatus.HEALTHY
                    if response.status_code < 500
                    else CheckStatus.UNHEALTHY,
                    authentication=CheckStatus.AUTHENTICATION_ERROR
                    if response.status_code == 401
                    else CheckStatus.HEALTHY,
                    authorization=CheckStatus.AUTHORIZATION_ERROR
                    if response.status_code == 403
                    else CheckStatus.HEALTHY,
                    rate_limit_status=CheckStatus.RATE_LIMITED
                    if response.status_code == 429
                    else CheckStatus.HEALTHY,
                    schema_compatibility=CheckStatus.HEALTHY
                    if schema_ok
                    else CheckStatus.SCHEMA_MISMATCH,
                    capability_health={
                        "get_ticket": status,
                        "add_comment": CheckStatus.UNHEALTHY,
                    },
                    message=f"Jira health request returned HTTP {response.status_code}",
                )
                return health
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            return ConnectorHealth(
                connector_id=self.connector_id,
                overall=CheckStatus.UNHEALTHY,
                latency_ms=(time.perf_counter() - start) * 1000,
                connectivity=CheckStatus.UNHEALTHY,
                capability_health={
                    "get_ticket": CheckStatus.UNHEALTHY,
                    "add_comment": CheckStatus.UNHEALTHY,
                },
                message=f"Jira health request failed: {type(exc).__name__}",
            )

    async def get_ticket(self, ticket_id: str) -> Dict[str, Any]:
        if not ticket_id or "/" in ticket_id:
            raise ValueError("ticket_id must be a non-empty Jira issue key")
        if not re.fullmatch(rf"{re.escape(self.project_key)}-\d+", ticket_id):
            raise ConnectorError("ticket is outside the configured Jira project")
        try:
            async with self._client.stream(
                "GET", f"/rest/api/2/issue/{quote(ticket_id, safe='')}"
            ) as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(
                        f"Jira issue request failed with HTTP {response.status_code}"
                    )
                payload = json.loads(await self.read_limited(response))
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(
                f"Jira issue request failed: {type(exc).__name__}"
            ) from None
        except (ValueError, ConnectorError):
            raise
        if not isinstance(payload, dict) or payload.get("key") != ticket_id:
            raise ConnectorError("Jira issue response schema or project scope mismatch")
        fields = payload.get("fields", {})
        if not isinstance(fields, dict):
            raise ConnectorError("Jira issue response schema or project scope mismatch")
        return {
            "key": payload.get("key", ticket_id),
            "summary": fields.get("summary", ""),
            "status": (fields.get("status") or {}).get("name", ""),
            "created": fields.get("created"),
            "description": fields.get("description", ""),
            "components": [c.get("name", "") for c in fields.get("components", [])],
        }

    async def post_comment(
        self, ticket_id: str, comment: str, dry_run: bool = False
    ) -> Dict[str, Any]:
        raise PermissionError(
            "Jira write operations are unavailable in the read-only connector"
        )

    async def aclose(self) -> None:
        await self._client.aclose()


def _status_for_response(response: httpx2.Response) -> CheckStatus:
    if response.status_code == 401:
        return CheckStatus.AUTHENTICATION_ERROR
    if response.status_code == 403:
        return CheckStatus.AUTHORIZATION_ERROR
    if response.status_code == 429:
        return CheckStatus.RATE_LIMITED
    return (
        CheckStatus.HEALTHY
        if 200 <= response.status_code < 300
        else CheckStatus.UNHEALTHY
    )
