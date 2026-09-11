"""Scoped log search tools exposed to Google ADK agents."""

from typing import List, Dict, Any
from google.adk.tools import FunctionTool
from app.connectors.providers.splunk import SplunkConnector


def create_tools(splunk: SplunkConnector) -> Dict[str, FunctionTool]:
    async def query_range(query: str, time_range: str) -> List[Dict[str, Any]]:
        """Query structured logs within the server-scoped incident time range."""
        return await splunk.query_logs(query, time_range)

    return {"query_range": FunctionTool(query_range)}
