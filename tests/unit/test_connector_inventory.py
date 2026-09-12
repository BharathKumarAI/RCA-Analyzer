"""The deployed inventory and agent allowlist form one executable contract."""

from contextlib import AsyncExitStack

import pytest

from app.configuration.platform import PlatformConfiguration
from app.connectors.providers.registry import CONNECTOR_IDS, ConnectorOptions, build_connectors
from app.settings import Settings
from app.tools.catalog import ALLOWED_ACTIONS, EVIDENCE_CONNECTORS


def test_every_connector_has_a_capability_skill_and_transport():
    platform = PlatformConfiguration.load(Settings())
    assert set(platform.connector_options) == CONNECTOR_IDS
    for name in EVIDENCE_CONNECTORS:
        cap = platform.registry.get(f"{name}_review")
        assert cap.enabled
        assert cap.requires.connectors == (name,)
        assert cap.allowed_actions == (f"{name}.read_evidence",)
        assert cap.allowed_actions[0] in ALLOWED_ACTIONS
        assert cap.agent_stages == ("evidence",)
        assert platform.registry.skill_contents[cap.skills[0]].strip()


@pytest.mark.parametrize("options", [
    {"transport": "mcp"},
    {"transport": "stdio"},
    {"transport": "mcp", "mcp_tools": {"execute": {"name": "shell", "scope_argument": "host"}}},
    {"secrets": {"token": "literal-secret"}},
])
def test_invalid_connector_configuration_fails_closed(options):
    with pytest.raises(ValueError):
        ConnectorOptions.model_validate(options)


@pytest.mark.asyncio
async def test_missing_secret_disables_only_affected_provider(monkeypatch):
    monkeypatch.delenv("RCA_MISSING_CONNECTOR_SECRET", raising=False)
    async with AsyncExitStack() as cleanup:
        providers = build_connectors({"itsm": {"secrets": {"api_token": "env://RCA_MISSING_CONNECTOR_SECRET"}},
                                      "log_search": {"enabled": False}}, "live", cleanup)
        assert providers == {}
