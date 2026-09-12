import tempfile
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.models import AgentDefinition, AgentDraft
from tests.support import connectors, settings_for


def test_capability_catalog_exposes_connector_contract_and_agent_readiness():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        definition = AgentDefinition(
            id="jira_specialist",
            version="1.0.0",
            name="Jira specialist",
            description="Reviews Jira tickets",
            instruction="Review the ticket evidence.",
            capability="ticket_review",
            tools=("itsm.get_ticket",),
        )
        with TestClient(app) as client:
            app.state.configurations.approved = AsyncMock(
                return_value=[
                    AgentDraft(
                        draft_id="draft_1",
                        tenant_id="acme",
                        project_id="payments",
                        author_subject="owner",
                        definition=definition,
                        content_hash="sha256:" + "a" * 64,
                        status="APPROVED",
                        created_at=1.0,
                    )
                ]
            )
            response = client.get("/api/v1/capabilities", headers=token("admin"))
            assert response.status_code == 200
            ticket = next(row for row in response.json() if row["id"] == "ticket_review")
            assert ticket["required_connectors"] == ["itsm"]
            assert ticket["optional_connectors"] == []
            assert ticket["agent_bindings"][0]["enabled"] is True
            assert ticket["agent_bindings"][0]["connectors_configured"] is True
            assert ticket["agent_bindings"][0]["connectors"] == ["itsm"]

