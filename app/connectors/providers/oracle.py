"""Oracle session evidence through fixed SQL, never model-supplied SQL."""

import asyncio
import json
import os
import time

import oracledb

from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


class OracleConnector(BaseConnector):
    def __init__(self, *, timeout_s=5, max_response_bytes=1048576, max_results=100, **kwargs):
        super().__init__("oracle", max_response_bytes=max_response_bytes)
        self.dsn = os.getenv("ORACLE_DSN")
        self.user = os.getenv("ORACLE_USER")
        self.password = os.getenv("ORACLE_PASSWORD")
        self.scope = os.getenv("ORACLE_SCOPE")
        if not all((self.dsn, self.user, self.password, self.scope)):
            raise ValueError("Oracle DSN, read-only account and schema scope are required")
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
