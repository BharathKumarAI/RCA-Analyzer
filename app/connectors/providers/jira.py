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
from app.connectors.jql import scope_jql_expression


def adf_to_text(node: Any, max_chars: int = 50000, max_nodes: int = 1000) -> str:
    """Recursively extract plain text and markdown from Atlassian Document Format (ADF) nodes.

    Applies in-traversal budgeting (max_chars, max_nodes) to dynamically halt recursion
    and avoid unbounded resource consumption on deep or malicious payloads. Prohibits media
    binary downloads (extracts alt-text/attrs only).
    """
    chars_count = 0
    nodes_count = 0

    def _walk(curr: Any) -> str:
        nonlocal chars_count, nodes_count
        if nodes_count >= max_nodes or chars_count >= max_chars:
            return ""
        nodes_count += 1

        if curr is None:
            return ""
        if isinstance(curr, str):
            avail = max(0, max_chars - chars_count)
            chunk = curr[:avail]
            chars_count += len(chunk)
            return chunk
        if isinstance(curr, list):
            res = []
            for item in curr:
                if nodes_count >= max_nodes or chars_count >= max_chars:
                    break
                res.append(_walk(item))
            return "".join(res)
        if not isinstance(curr, dict):
            text = str(curr)
            avail = max(0, max_chars - chars_count)
            chunk = text[:avail]
            chars_count += len(chunk)
            return chunk

        node_type = curr.get("type", "")
        content = curr.get("content", [])
        attrs = curr.get("attrs") or {}

        if node_type == "text":
            text = curr.get("text", "")
            for mark in curr.get("marks", []):
                mtype = mark.get("type") if isinstance(mark, dict) else ""
                if mtype == "strong":
                    text = f"**{text}**"
                elif mtype == "em":
                    text = f"*{text}*"
                elif mtype == "code":
                    text = f"`{text}`"
                elif mtype == "strike":
                    text = f"~~{text}~~"
                elif mtype == "link":
                    href = (mark.get("attrs") or {}).get("href", "")
                    text = f"[{text}]({href})"
            avail = max(0, max_chars - chars_count)
            chunk = text[:avail]
            chars_count += len(chunk)
            return chunk

        if node_type == "hardBreak":
            chars_count += 1
            return "\n"
        if node_type == "rule":
            res = "\n---\n"
            chars_count += len(res)
            return res
        if node_type == "mention":
            user_text = attrs.get("text", "user")
            res = f"@{user_text}"
            chars_count += len(res)
            return res
        if node_type == "emoji":
            res = attrs.get("shortName", "")
            chars_count += len(res)
            return res
        if node_type == "paragraph":
            inner = "".join(_walk(child) for child in content)
            return f"{inner}\n" if inner else "\n"
        if node_type == "heading":
            level = attrs.get("level", 1)
            inner = "".join(_walk(child) for child in content).strip()
            return f"{'#' * level} {inner}\n\n"
        if node_type == "codeBlock":
            lang = attrs.get("language", "")
            inner = "".join(_walk(child) for child in content)
            return f"```{lang}\n{inner}\n```\n\n"
        if node_type == "blockquote":
            inner = "".join(_walk(child) for child in content).strip()
            quoted = "\n".join(f"> {line}" for line in inner.splitlines())
            return f"{quoted}\n\n"
        if node_type in ("bulletList", "orderedList"):
            items = []
            for idx, child in enumerate(content, start=1):
                if nodes_count >= max_nodes or chars_count >= max_chars:
                    break
                prefix = f"{idx}. " if node_type == "orderedList" else "- "
                item_text = _walk(child).strip()
                items.append(f"{prefix}{item_text}")
            return "\n".join(items) + "\n\n"
        if node_type == "listItem":
            return "".join(_walk(child) for child in content)
        if node_type == "doc":
            return "".join(_walk(child) for child in content).strip()

        if node_type == "table":
            rows = []
            for row in content:
                if nodes_count >= max_nodes or chars_count >= max_chars:
                    break
                if isinstance(row, dict) and row.get("type") == "tableRow":
                    nodes_count += 1
                    cells = []
                    for cell in row.get("content", []):
                        if isinstance(cell, dict) and cell.get("type") in ("tableHeader", "tableCell"):
                            nodes_count += 1
                            cell_text = "".join(_walk(c) for c in cell.get("content", [])).strip()
                            cell_text = cell_text.replace("\n", " ").replace("|", "\\|")
                            cells.append(cell_text)
                    if cells:
                        rows.append(cells)
            if not rows:
                return ""
            max_cols = max(len(r) for r in rows)
            norm_rows = [r + [""] * (max_cols - len(r)) for r in rows]
            table_lines = ["| " + " | ".join(norm_rows[0]) + " |"]
            table_lines.append("| " + " | ".join(["---"] * max_cols) + " |")
            for r in norm_rows[1:]:
                table_lines.append("| " + " | ".join(r) + " |")
            res = "\n".join(table_lines) + "\n\n"
            avail = max(0, max_chars - chars_count)
            chunk = res[:avail]
            chars_count += len(chunk)
            return chunk

        if node_type in ("media", "mediaSingle", "mediaGroup"):
            alt = attrs.get("alt") or attrs.get("id") or "media"
            res = f"[Attachment: {alt}]"
            avail = max(0, max_chars - chars_count)
            chunk = res[:avail]
            chars_count += len(chunk)
            return chunk

        # Fallback for expand, panel, etc.
        if content:
            return "".join(_walk(child) for child in content)
        res = curr.get("text", "")
        avail = max(0, max_chars - chars_count)
        chunk = res[:avail]
        chars_count += len(chunk)
        return chunk

    return _walk(node)


def validate_custom_field_mapping(value: Any) -> dict[str, str]:
    """Validate mappings before persistence as well as provider construction."""
    mapping = {} if value is None else value
    if not isinstance(mapping, dict) or len(mapping) > 100 or any(
        not isinstance(key, str) or not re.fullmatch(r"customfield_[0-9]{1,12}", key)
        or not isinstance(label, str) or not label.strip() or len(label) > 128
        for key, label in mapping.items()
    ):
        raise ValueError("Custom field mappings require canonical Jira field IDs and display names (maximum 100)")
    normalized = {key: label.strip() for key, label in mapping.items()}
    if len({label.casefold() for label in normalized.values()}) != len(mapping):
        raise ValueError("Custom field display names must be unique")
    return normalized


class JiraConnector(BaseConnector):
    """Jira Cloud / Server REST connector using Jira Cloud REST API Version 3 with ADF support."""

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
        api_version: int = 3,
    ):
        super().__init__(connector_id="itsm", max_response_bytes=max_response_bytes)
        self.base_url = base_url or os.getenv("JIRA_BASE_URL")
        self.project_key = project_key or os.getenv("JIRA_PROJECT_KEY")
        self.user_email = user_email or os.getenv("JIRA_USER_EMAIL")
        self.api_token = api_token or os.getenv("JIRA_API_TOKEN")
        self.api_version = api_version
        self.custom_field_mapping = validate_custom_field_mapping(custom_field_mapping)
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

    def _api_path(self, endpoint: str, version: Optional[int] = None) -> str:
        ver = version if version is not None else self.api_version
        clean_endpoint = endpoint.lstrip("/")
        return f"/rest/api/{ver}/{clean_endpoint}"

    async def probe_health(self) -> ConnectorHealth:
        start = time.perf_counter()
        endpoint = self._api_path(f"/project/{quote(self.project_key, safe='')}")
        try:
            async with self._client.stream("GET", endpoint) as response:
                return await self._parse_health_response(response, start)
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

    async def _parse_health_response(self, response: httpx2.Response, start: float) -> ConnectorHealth:
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
        return ConnectorHealth(
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

    async def get_current_user(self) -> Dict[str, Any]:
        """Get currently authenticated Jira user profile via /rest/api/3/myself."""
        endpoint = self._api_path("/myself")
        try:
            async with self._client.stream("GET", endpoint) as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(f"Jira user profile failed with HTTP {response.status_code}")
                return json.loads(await self.read_limited(response))
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(f"Jira myself request failed: {type(exc).__name__}") from None

    async def get_ticket(self, ticket_id: str) -> Dict[str, Any]:
        """Get issue details via Jira Cloud REST API Version 3 with ADF support."""
        if not ticket_id or "/" in ticket_id:
            raise ValueError("ticket_id must be a non-empty Jira issue key")
        if not re.fullmatch(rf"{re.escape(self.project_key)}-\d+", ticket_id):
            raise ConnectorError("ticket is outside the configured Jira project")
        endpoint = self._api_path(f"/issue/{quote(ticket_id, safe='')}")
        try:
            async with self._client.stream("GET", endpoint) as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(f"Jira issue request failed with HTTP {response.status_code}", status_code=response.status_code)
                payload = json.loads(await self.read_limited(response))
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(f"Jira issue request failed: {type(exc).__name__}") from None
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

        # Parse ADF description in v3
        raw_desc = fields.get("description")
        description_text = adf_to_text(raw_desc) if isinstance(raw_desc, (dict, list)) else (raw_desc or "")

        # Parse ADF comments in v3
        comment_container = fields.get("comment") or {}
        raw_comments = comment_container.get("comments", []) if isinstance(comment_container, dict) else []
        comments_total = comment_container.get("total") if isinstance(comment_container, dict) else None
        comments_count = comments_total if isinstance(comments_total, int) and not isinstance(comments_total, bool) and comments_total >= len(raw_comments) else len(raw_comments)
        parsed_comments = []
        for c in raw_comments[:50]:
            if isinstance(c, dict):
                parsed_comments.append({
                    "id": c.get("id"),
                    "author": (c.get("author") or {}).get("displayName") or (c.get("author") or {}).get("name"),
                    "created": c.get("created"),
                    "body": adf_to_text(c.get("body")),
                })

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
            "status_category": ((fields.get("status") or {}).get("statusCategory") or {}).get("key"),
            "created": fields.get("created"),
            "updated": fields.get("updated"),
            "resolved": fields.get("resolutiondate"),
            "description": description_text,
            "description_adf": raw_desc if isinstance(raw_desc, dict) else None,
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
            "comments": parsed_comments,
            "comments_count": comments_count,
            "comments_returned": len(parsed_comments),
            "comments_truncated": comments_count > len(parsed_comments) or bool(comment_container.get("startAt", 0)),
            "attachments_count": attachments_count,
        }

    async def search_issues(
        self,
        jql: str,
        *,
        max_results: int = 50,
        fields: Optional[list[str]] = None,
        timeout_s: Optional[float] = None,
        next_page_token: str | None = None,
    ) -> Dict[str, Any]:
        """Search issues via Jira Cloud REST API Version 3 with cursor-based pagination and scoped JQL."""
        scoped_jql = scope_jql_expression(jql, self.project_key)
        endpoint = self._api_path("/search/jql")
        target_max = min(max(1, max_results), 250)
        max_pages = 5

        deadline = time.perf_counter() + (timeout_s or 15.0)
        if next_page_token is not None and (not isinstance(next_page_token, str) or not next_page_token or len(next_page_token) > 4096):
            raise ValueError("Invalid Jira search pagination token")
        seen_tokens: set[str] = {next_page_token} if next_page_token else set()
        next_token: Optional[str] = next_page_token
        all_issues: list[dict[str, Any]] = []
        response_bytes = 0
        possibly_truncated = False

        for page_idx in range(max_pages):
            if time.perf_counter() > deadline:
                raise ConnectorError("Jira search request timed out across paginated retries")
            if len(all_issues) >= target_max:
                break

            page_size = min(50, target_max - len(all_issues))
            body_payload: dict[str, Any] = {
                "jql": scoped_jql,
                "maxResults": page_size,
                "fields": fields or [
                    "summary",
                    "status",
                    "description",
                    "priority",
                    "issuetype",
                    "created",
                    "updated",
                    "customfield_*",
                ],
            }
            if next_token:
                body_payload["nextPageToken"] = next_token

            try:
                async with self._client.stream("POST", endpoint, json=body_payload) as response:
                    if not 200 <= response.status_code < 300:
                        raise ConnectorError(f"Jira search request failed with HTTP {response.status_code}")
                    raw = await self.read_limited(response)
                    response_bytes += len(raw)
                    if response_bytes > self.max_response_bytes:
                        raise ConnectorError("Jira search exceeded the total response-byte limit")
                    payload = json.loads(raw)
            except (httpx2.TimeoutException, httpx2.RequestError) as exc:
                raise ConnectorError(f"Jira search request failed: {type(exc).__name__}") from None
            except json.JSONDecodeError:
                raise ConnectorError("Jira search returned invalid JSON") from None

            if not isinstance(payload, dict):
                raise ConnectorError("Invalid Jira search response schema")

            raw_issues = payload.get("issues", [])
            if not isinstance(raw_issues, list) or len(raw_issues) > page_size:
                raise ConnectorError("Invalid Jira search issues list")

            for issue in raw_issues:
                if not isinstance(issue, dict) or not re.fullmatch(re.escape(self.project_key) + r"-[0-9]+", str(issue.get("key", "")), re.I):
                    raise ConnectorError("Jira search returned an issue outside the authorized project")
                issue_fields = issue.get("fields", {})
                if not isinstance(issue_fields, dict):
                    raise ConnectorError("Invalid Jira search issue fields")
                desc = issue_fields.get("description")
                if isinstance(desc, (dict, list)):
                    issue_fields["description"] = adf_to_text(desc)
                all_issues.append(issue)

            next_token = payload.get("nextPageToken")
            if next_token is not None and (not isinstance(next_token, str) or len(next_token) > 4096):
                raise ConnectorError("Invalid Jira search pagination token")
            possibly_truncated = bool(next_token) or payload.get("isLast") is False
            if not next_token:
                break
            if next_token in seen_tokens:
                raise ConnectorError("Pagination cycle detected: repeated nextPageToken")
            seen_tokens.add(next_token)

        return {
            "issues": all_issues,
            "total": len(all_issues),
            "nextPageToken": next_token,
            "possibly_truncated": possibly_truncated,
        }

    async def discover_fields(self, *, include_schema: bool = False) -> list[dict[str, str]]:
        """Read accessible field metadata via /rest/api/3/field."""
        health = await self.probe_health()
        if health.overall != CheckStatus.HEALTHY:
            raise ConnectorError("Verify Jira project access before discovering fields")
        endpoint = self._api_path("/field")
        try:
            async with self._client.stream("GET", endpoint) as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(f"Jira field discovery failed with HTTP {response.status_code}")
                payload = json.loads(await self.read_limited(response))
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(f"Jira field discovery failed: {type(exc).__name__}") from None
        except json.JSONDecodeError:
            raise ConnectorError("Jira field discovery returned invalid JSON") from None
        if not isinstance(payload, list) or len(payload) > 10000:
            raise ConnectorError("Jira field discovery exceeded the supported schema or field limit")
        result = []
        for field in payload:
            if not isinstance(field, dict):
                raise ConnectorError("Jira field discovery returned an invalid field")
            field_id, name = field.get("id"), field.get("name")
            if isinstance(field_id, str) and (include_schema or re.fullmatch(r"customfield_[0-9]{1,12}", field_id)):
                if not isinstance(name, str) or not name.strip() or len(name) > 256:
                    raise ConnectorError("Jira field discovery returned an invalid field name")
                item = {"id": field_id, "name": name}
                if include_schema:
                    schema = field.get("schema")
                    if not isinstance(schema, dict):
                        continue
                    item.update(schema={key: schema[key] for key in ("type", "items", "custom") if isinstance(schema.get(key), str)},
                                searchable=field.get("searchable") is True, orderable=field.get("orderable") is True)
                result.append(item)
        if include_schema:
            try:
                auto_endpoint = self._api_path("/jql/autocompletedata")
                async with self._client.stream("GET", auto_endpoint) as response:
                    if response.status_code != 200:
                        raise ConnectorError("Jira query metadata is unavailable")
                    reference = json.loads(await self.read_limited(response))
            except (httpx2.RequestError, ValueError):
                raise ConnectorError("Unable to read Jira query metadata") from None
            entries = reference.get("visibleFieldNames") if isinstance(reference, dict) else None
            if not isinstance(entries, list) or len(entries) > 10000:
                raise ConnectorError("Invalid Jira query metadata")
            by_id = {}
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ConnectorError("Invalid Jira query field")
                key = entry.get("cfid") or entry.get("value")
                if isinstance(key, str):
                    by_id[key] = entry
            for field in result:
                key = field["id"]
                if re.fullmatch(r"customfield_[0-9]+", key):
                    key = "cf[" + key.removeprefix("customfield_") + "]"
                entry = by_id.get(key, {})
                operators = entry.get("operators", [])
                if not isinstance(operators, list):
                    raise ConnectorError("Invalid Jira field operators")
                field["operators"] = [
                    {"IS": "IS EMPTY", "IS NOT": "IS NOT EMPTY"}.get(op.upper(), op.upper())
                    for op in operators if isinstance(op, str)
                ]
                field["orderable"] = entry.get("orderable") in (True, "true")
        return result

    async def validate_jql(self, jql: str) -> None:
        """Ask Jira to validate the generated query without executing a search via /rest/api/3/jql/parse."""
        endpoint = self._api_path("/jql/parse")
        try:
            async with self._client.stream(
                "POST", endpoint, params={"validation": "strict"}, json={"queries": [jql]},
            ) as response:
                if response.status_code != 200:
                    raise ConnectorError("Jira query validation is unavailable")
                payload = json.loads(await self.read_limited(response))
        except (httpx2.RequestError, ValueError):
            raise ConnectorError("Unable to read Jira query validation") from None
        queries = payload.get("queries") if isinstance(payload, dict) else None
        if not isinstance(queries, list) or len(queries) != 1 or not isinstance(queries[0], dict):
            raise ConnectorError("Invalid Jira query validation response")
        if queries[0].get("errors"):
            raise ValueError("Jira rejected the generated query; check the selected field values and permissions")
        if not isinstance(queries[0].get("structure"), dict):
            raise ConnectorError("Jira did not confirm query validity")

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
