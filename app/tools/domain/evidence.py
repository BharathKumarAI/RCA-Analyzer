"""Typed, argument-free reads: the provider owns all destination and scope settings."""

from typing import Any
from google.adk.tools import FunctionTool
from app.connectors.base import BaseConnector


def create_tool(connector: BaseConnector) -> FunctionTool:
    async def read_evidence() -> dict[str, Any]:
        """Read a bounded evidence snapshot from the deployment-configured resource."""
        return await connector.read_evidence()

    read_evidence.__name__ = f"read_{connector.connector_id}_evidence"
    return FunctionTool(read_evidence)
