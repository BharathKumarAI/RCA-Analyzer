"""Oracle session evidence through fixed SQL, never model-supplied SQL."""

import asyncio
import ipaddress
import json
import os
import re
import time
from urllib.parse import urlsplit

import oracledb

from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


def validate_oracle_endpoint(endpoint: str) -> None:
    """Accept one explicit Easy Connect destination, without hidden TNS routing."""
    parsed = urlsplit(endpoint)
    host = parsed.hostname or ""
    try:
        ipaddress.ip_address(host)
        valid_host = True
    except ValueError:
        valid_host = len(host) <= 253 and all(
            re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            for label in host.split(".")
        )
    if (
        parsed.scheme not in {"tcp", "tcps"} or not valid_host
        or parsed.username or parsed.password or parsed.query or parsed.fragment
        or not re.fullmatch(r"/[A-Za-z0-9_.-]{1,128}", parsed.path)
        or not parsed.port or not 1 <= parsed.port <= 65535
        or any(char.isspace() for char in endpoint)
    ):
        raise ValueError("Oracle endpoint must use tcp[s]://host:port/service without credentials or connection options")


class OracleConnector(BaseConnector):
    def __init__(self, *, dsn=None, user=None, password=None, scope=None,
                 driver_mode="thin", connection_format="dsn", timeout_s=5,
                 max_response_bytes=1048576, max_results=100, **kwargs):
        super().__init__("oracle", max_response_bytes=max_response_bytes)
        self.dsn = dsn if dsn is not None else os.getenv("ORACLE_DSN")
        self.user = user if user is not None else os.getenv("ORACLE_USER")
        self.password = password if password is not None else os.getenv("ORACLE_PASSWORD")
        self.scope = scope if scope is not None else os.getenv("ORACLE_SCOPE")
        if not all((self.dsn, self.user, self.password, self.scope)):
            raise ValueError("Oracle DSN, read-only account and schema scope are required")
        validate_oracle_endpoint(self.dsn)
        if driver_mode != "thin" or connection_format not in {"dsn", "ezconnect"}:
            raise ValueError("Oracle supports Thin mode with an explicit Easy Connect DSN only")
        if not isinstance(self.scope, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_$#]{0,127}", self.scope):
            raise ValueError("Oracle resource scope must identify one database username")
        if type(max_results) is not int or not 1 <= max_results <= 1000:
            raise ValueError("Oracle max_results must be between 1 and 1000")
        self.timeout_s, self.max_results = timeout_s, max_results

    async def read_evidence(self):
        try:
            async with asyncio.timeout(self.timeout_s):
                async with oracledb.connect_async(user=self.user, password=self.password, dsn=self.dsn,
                                                 tcp_connect_timeout=self.timeout_s) as connection:
                    connection.call_timeout = int(self.timeout_s * 1000)
                    with connection.cursor() as cursor:
                        await cursor.execute("SET TRANSACTION READ ONLY")
                        await cursor.execute(
                            "SELECT sid, serial#, status, event, wait_class, seconds_in_wait, blocking_session "
                            "FROM v$session WHERE username = :scope AND ROWNUM <= :limit",
                            scope=self.scope, limit=self.max_results + 1,
                        )
                        rows = await cursor.fetchmany(self.max_results + 1)
                        result = {"items": [dict(zip([col[0].lower() for col in cursor.description], row)) for row in rows[:self.max_results]],
                                  "possibly_truncated": len(rows) > self.max_results}
                        if len(json.dumps(result).encode()) > self.max_response_bytes:
                            raise ConnectorError("Oracle evidence exceeded size limit")
                        return result
        except (oracledb.Error, TimeoutError):
            raise ConnectorError("Oracle scoped session query failed") from None

    async def probe_health(self):
        start = time.monotonic()
        try:
            await self.read_evidence()
            status = CheckStatus.HEALTHY
        except ConnectorError:
            status = CheckStatus.UNHEALTHY
        return ConnectorHealth(connector_id="oracle", overall=status, latency_ms=(time.monotonic() - start) * 1000,
                               capability_health={"read_evidence": status}, message="Oracle scoped session probe completed")

    async def aclose(self):
        pass  # Each bounded read owns and closes its connection.
