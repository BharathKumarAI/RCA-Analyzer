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
        custom_field_mapping: Optional[Dict[str, str]] = None,
    ):
        super().__init__(connector_id="itsm", max_response_bytes=max_response_bytes)
        self.base_url = base_url or os.getenv("JIRA_BASE_URL")
        self.project_key = project_key or os.getenv("JIRA_PROJECT_KEY")
        self.user_email = user_email or os.getenv("JIRA_USER_EMAIL")
        self.api_token = api_token or os.getenv("JIRA_API_TOKEN")
        mapping = custom_field_mapping or {}
        if not isinstance(mapping, dict) or len(mapping) > 100 or any(
            not isinstance(key, str) or not re.fullmatch(r"customfield_[0-9]{1,12}", key)
            or not isinstance(label, str) or not label.strip() or len(label) > 128
            for key, label in mapping.items()
        ):
            raise ValueError("Custom field mappings require canonical Jira field IDs and display names (maximum 100)")
        self.custom_field_mapping = {key: label.strip() for key, label in mapping.items()}
        if len({label.casefold() for label in self.custom_field_mapping.values()}) != len(mapping):
            raise ValueError("Custom field display names must be unique")
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
        priority = (
            (fields.get("priority") or {}).get("name")
            if isinstance(fields.get("priority"), dict)
            else fields.get("priority")
        )
        issuetype = (
            (fields.get("issuetype") or {}).get("name")
            if isinstance(fields.get("issuetype"), dict)
            else fields.get("issuetype")
        )
        assignee_data = fields.get("assignee")
        assignee = (
            assignee_data.get("displayName") or assignee_data.get("name")
            if isinstance(assignee_data, dict)
            else None
        )
        reporter_data = fields.get("reporter")
        reporter = (
            reporter_data.get("displayName") or reporter_data.get("name")
            if isinstance(reporter_data, dict)
            else None
        )
        resolution = (
            (fields.get("resolution") or {}).get("name")
            if isinstance(fields.get("resolution"), dict)
            else fields.get("resolution")
        )
        labels = fields.get("labels", []) if isinstance(fields.get("labels"), list) else []
        environment = fields.get("environment")
        comments_count = (
            len((fields.get("comment") or {}).get("comments", []))
            if isinstance(fields.get("comment"), dict)
            else 0
        )
        attachments_count = (
            len(fields.get("attachment", []))
            if isinstance(fields.get("attachment"), list)
            else 0
        )
        custom_fields = {
            k: v
            for k, v in fields.items()
            if k.startswith("customfield_") and v is not None
        }

        return {
            "key": payload.get("key", ticket_id),
            "summary": fields.get("summary", ""),
            "status": (fields.get("status") or {}).get("name", ""),
            "created": fields.get("created"),
            "updated": fields.get("updated"),
            "description": fields.get("description", ""),
            "priority": priority,
            "issue_type": issuetype,
            "assignee": assignee,
            "reporter": reporter,
            "resolution": resolution,
            "environment": environment,
            "labels": labels,
            "components": [
                c.get("name", "")
                for c in fields.get("components", [])
                if isinstance(c, dict)
            ],
            "custom_fields": custom_fields,
            "mapped_custom_fields": {
                label: custom_fields[field_id]
                for field_id, label in self.custom_field_mapping.items()
                if field_id in custom_fields
            },
            "unavailable_mapped_fields": [
                field_id for field_id in self.custom_field_mapping if field_id not in custom_fields
            ],
            "comments_count": comments_count,
            "attachments_count": attachments_count,
        }

    async def discover_fields(self) -> list[dict[str, str]]:
        """Read accessible field metadata after verifying the configured project.

        Field visibility does not establish that a field is present on every issue.
        """
        health = await self.probe_health()
        if health.overall != CheckStatus.HEALTHY:
            raise ConnectorError("Verify Jira project access before discovering fields")
        try:
            async with self._client.stream("GET", "/rest/api/2/field") as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(f"Jira field discovery failed with HTTP {response.status_code}")
                payload = json.loads(await self.read_limited(response))
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(f"Jira field discovery failed: {type(exc).__name__}") from None
        if not isinstance(payload, list) or len(payload) > 10000:
            raise ConnectorError("Jira field discovery exceeded the supported schema or field limit")
        result = []
        for field in payload:
            if not isinstance(field, dict):
                raise ConnectorError("Jira field discovery returned an invalid field")
            field_id, name = field.get("id"), field.get("name")
            if isinstance(field_id, str) and re.fullmatch(r"customfield_[0-9]{1,12}", field_id):
                if not isinstance(name, str) or not name.strip() or len(name) > 256:
                    raise ConnectorError("Jira field discovery returned an invalid field name")
                result.append({"id": field_id, "name": name})
        return result

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
