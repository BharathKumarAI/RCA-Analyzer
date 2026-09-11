"""Explicit benchmark replay provider: recorded evidence only, no network calls."""

from copy import deepcopy
from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


class ReplayConnector(BaseConnector):
    def __init__(self, connector_id, case):
        super().__init__(connector_id)
        self.case = case

    async def probe_health(self):
        return ConnectorHealth(
            connector_id=self.connector_id,
            overall=CheckStatus.HEALTHY,
            latency_ms=0,
            message="Recorded benchmark replay; not live connector health",
        )

    async def get_ticket(self, ticket_id):
        if self.case.ticket is None or ticket_id != self.case.incident_id:
            raise ConnectorError("Ticket absent from this benchmark case")
        return deepcopy(self.case.ticket)

    async def query_logs(self, query, start_time, end_time=None):
        from app.connectors.providers.splunk import _bounded_window

        if not isinstance(query, str) or not query.strip() or len(query) > 256:
            raise ValueError("Invalid replay query")
        _bounded_window(start_time, end_time)
        return deepcopy(self.case.logs)

    async def aclose(self):
        pass
