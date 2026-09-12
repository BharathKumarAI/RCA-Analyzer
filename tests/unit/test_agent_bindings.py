"""Capability declarations constrain the native source-agent topology."""

import pytest
from pydantic import ValidationError

from app.capabilities.models import CapabilityDefinition


def capability(**values):
    return CapabilityDefinition(
        id="example",
        version="1.0.0",
        name="Example",
        description="Example capability",
        category="investigation",
        **values,
    )


def test_existing_manifests_keep_all_source_agents_by_default():
    assert capability().agent_stages == ("triage", "logs", "file")


@pytest.mark.parametrize("stage", ["ticket", "files", "database", ""])
def test_agent_stages_are_a_closed_source_agent_set(stage):
    with pytest.raises(ValidationError):
        capability(agent_stages=(stage,))


def test_capability_can_select_one_source_agent():
    assert capability(agent_stages=("file",)).agent_stages == ("file",)
