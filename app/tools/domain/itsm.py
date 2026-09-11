"""Scoped ITSM tools exposed to Google ADK agents."""

from typing import Any, Dict
from google.adk.tools import FunctionTool
from app.connectors.providers.jira import JiraConnector


def create_tools(jira: JiraConnector) -> Dict[str, FunctionTool]:
    async def get_ticket(ticket_id: str) -> Dict[str, Any]:
        """Retrieve details for a specific incident ticket."""
        return await jira.get_ticket(ticket_id)

    return {"get_ticket": FunctionTool(get_ticket)}
