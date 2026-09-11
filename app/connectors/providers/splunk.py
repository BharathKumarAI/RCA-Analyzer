"""Splunk REST connector with server-scoped index access."""

import os
import re
import time
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx2
from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


class SplunkConnector(BaseConnector):
    """Log search connector implementation for Splunk / Cloud Logging."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        token: Optional[str] = None,
        *,
        index: Optional[str] = None,
        client: Optional[httpx2.AsyncClient] = None,
        allow_insecure: bool = False,
        timeout_s: float = 5.0,
        max_connections: int = 10,
        max_keepalive_connections: int = 5,
        max_response_bytes: int = 1_048_576,
        max_results: int = 100,
        max_window_seconds: int = 86400,
    ):
        super().__init__(
            connector_id="log_search", max_response_bytes=max_response_bytes
        )
        if (
            max_results <= 0
            or max_results > 1000
            or max_window_seconds <= 0
            or max_window_seconds > 86400
        ):
            raise ValueError("Splunk result/window limits exceed safety bounds")
        self.max_results = max_results
        self.max_window_seconds = max_window_seconds
        self.endpoint = endpoint or os.getenv("SPLUNK_HOST")
        self.token = token or os.getenv("SPLUNK_TOKEN")
        self.index = index or os.getenv("SPLUNK_INDEX")
        if not self.endpoint or not self.token or not self.index:
            raise ValueError("SPLUNK_HOST, SPLUNK_TOKEN, and SPLUNK_INDEX are required")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", self.index):
            raise ValueError("SPLUNK_INDEX contains unsupported characters")
        if not allow_insecure and not self.endpoint.startswith("https://"):
            raise ValueError("Splunk endpoint must use https")
        self._client = client or httpx2.AsyncClient(
            base_url=self.endpoint,
            timeout=httpx2.Timeout(timeout_s),
            limits=httpx2.Limits(
                max_connections=max_connections,
                max_keepalive_connections=max_keepalive_connections,
            ),
            follow_redirects=False,
        )
        self._client.headers.update(
            {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        )

    async def probe_health(self) -> ConnectorHealth:
        start = time.perf_counter()
        try:
            async with self._client.stream(
                "GET",
                f"/services/data/indexes/{self.index}",
                params={"output_mode": "json"},
            ) as response:
                status = _status_for_response(response)
                schema_ok = False
                if 200 <= response.status_code < 300:
                    try:
                        payload = json.loads(await self.read_limited(response))
                        schema_ok = isinstance(payload, dict) and (
                            payload.get("name") == self.index
                            or payload.get("entry", [{}])[0].get("name") == self.index
                        )
                    except (ValueError, ConnectorError, AttributeError, IndexError):
                        status = CheckStatus.SCHEMA_MISMATCH
                if not schema_ok and status == CheckStatus.HEALTHY:
                    status = CheckStatus.SCHEMA_MISMATCH
                return ConnectorHealth(
                    connector_id=self.connector_id,
                    overall=status,
                    latency_ms=(time.perf_counter() - start) * 1000,
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
                    capability_health={"query_range": status},
                    message=f"Splunk health request returned HTTP {response.status_code}",
                )
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            return ConnectorHealth(
                connector_id=self.connector_id,
                overall=CheckStatus.UNHEALTHY,
                latency_ms=(time.perf_counter() - start) * 1000,
                connectivity=CheckStatus.UNHEALTHY,
                capability_health={"query_range": CheckStatus.UNHEALTHY},
                message=f"Splunk health request failed: {type(exc).__name__}",
            )

    async def query_logs(
        self, query: str, start_time: str, end_time: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        if (
            not query.strip()
            or len(query) > 256
            or not re.fullmatch(r"[A-Za-z0-9_.:/= -]+", query)
        ):
            raise ValueError("query must contain only bounded plain search terms")
        if re.search(r"\b(?:OR|AND|index)\b", query, re.IGNORECASE):
            raise ValueError("query contains unsupported search syntax")
        earliest, latest = _bounded_window(
            start_time, end_time, self.max_window_seconds
        )
        params = {
            "search": f'search index={self.index} "{query}"',
            "earliest_time": earliest,
            "latest_time": latest,
            "output_mode": "json",
        }
        try:
            async with self._client.stream(
                "GET", "/services/search/jobs/export", params=params
            ) as response:
                if not 200 <= response.status_code < 300:
                    raise ConnectorError(
                        f"Splunk query failed with HTTP {response.status_code}"
                    )
                body = await self.read_limited(response)
        except (httpx2.TimeoutException, httpx2.RequestError) as exc:
            raise ConnectorError(f"Splunk query failed: {type(exc).__name__}") from None
        results: List[Dict[str, Any]] = []
        for line in body.decode("utf-8").splitlines():
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                raise ConnectorError("Splunk returned invalid NDJSON") from None
            if not isinstance(item, dict):
                raise ConnectorError("Splunk returned an invalid result")
            result = item.get("result", item)
            if not isinstance(result, dict):
                raise ConnectorError("Splunk returned an invalid result")
            results.append(result)
            if len(results) >= self.max_results:
                break
        return results

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


def _bounded_window(
    start_time: str, end_time: Optional[str], max_window_seconds: int = 86400
) -> tuple[str, str]:
    if re.fullmatch(r"-([0-9]+)([smhd])", start_time):
        amount, unit = int(start_time[1:-1]), start_time[-1]
        seconds = amount * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        if seconds > max_window_seconds:
            raise ValueError("time window cannot exceed 24 hours")
        if end_time not in (None, "now"):
            raise ValueError("relative windows must end at now")
        return start_time, "now"
    try:
        start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        end = datetime.fromisoformat(
            (end_time or datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00")
        )
    except ValueError:
        raise ValueError(
            "time bounds must be ISO-8601 or a relative window such as -15m"
        ) from None
    if (
        start.tzinfo is None
        or end.tzinfo is None
        or end < start
        or (end - start).total_seconds() > max_window_seconds
    ):
        raise ValueError("time window exceeds configured bound")
    return start.isoformat(), end.isoformat()
