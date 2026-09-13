"""Data-only Harness Studio bundle contracts."""

from __future__ import annotations

import io
import zipfile

import pytest

from app.configuration.harness_bundles import (
    BundleInput,
    compile_bundle,
    export_archive,
    import_archive,
)
from app.configuration.harness_workspace import HarnessWorkspaceService
from app.configuration.platform import PlatformConfiguration
from app.identity.principals import Role, UserPrincipal
from app.settings import Settings


class EmptyConfigurations:
    async def approved(self, *_args):
        return []


@pytest.fixture
def harness_context():
    settings = Settings(tenant_id="acme", project_id="payments")
    platform = PlatformConfiguration.load(settings)
    principal = UserPrincipal(
        subject="analyst",
        username="analyst",
        tenant_id="acme",
        project_id="payments",
        roles=(Role.PROJECT_ANALYST,),
    )
    service = HarnessWorkspaceService(
        None, None, platform, settings, EmptyConfigurations()
    )
    return settings, platform, principal, service


def test_archive_roundtrip_preserves_source_and_adds_portability_manifest():
    files = {
        "agents/root_agent.yaml": "name: root_agent\ninstruction: Inspect evidence\n",
        "config/metadata.json": '{"owner":"platform"}\n',
    }
    archive = export_archive(files)
    restored = import_archive(archive, "harness.zip")

    assert restored["agents/root_agent.yaml"] == files["agents/root_agent.yaml"]
    assert restored["config/metadata.json"] == files["config/metadata.json"]
    assert "RCA-PORTABILITY.txt" in restored
    with zipfile.ZipFile(io.BytesIO(archive)) as opened:
        assert opened.namelist() == [
            "agents/root_agent.yaml",
            "config/metadata.json",
            "RCA-PORTABILITY.txt",
        ]


@pytest.mark.asyncio
async def test_service_defaults_compile_against_real_platform_contract(harness_context):
    _settings, platform, principal, service = harness_context
    bundle = await service.default(principal, "incident_triage")
    compilation = service.validate(principal, bundle)

    assert compilation.definition is not None
    assert compilation.definition.root == "root_rca_agent"
    assert not [diagnostic for diagnostic in compilation.diagnostics if diagnostic.severity == "error"]
    assert "rca/workflow.yaml" in bundle.files
    assert platform.registry.get("incident_triage") is not None


@pytest.mark.parametrize(
    ("name", "source", "message"),
    [
        (
            "alias",
            """name: root_agent
instruction: &text Inspect evidence
description: *text
""",
            "aliases",
        ),
        (
            "cycle",
            """name: root_agent
agent_class: SequentialAgent
sub_agents:
  - config_path: child.yaml
""",
            "Cyclic agent configuration references",
        ),
        (
            "unsupported class",
            """name: root_agent
agent_class: CustomAgent
instruction: Inspect evidence
""",
            "Unsupported ADK class",
        ),
    ],
)
def test_unsafe_or_unsupported_sources_become_diagnostics(
    harness_context, name, source, message
):
    _settings, platform, _principal, _service = harness_context
    files = {"root_agent.yaml": source}
    if name == "cycle":
        files["child.yaml"] = """name: child
agent_class: SequentialAgent
sub_agents:
  - config_path: root_agent.yaml
"""
    compilation = compile_bundle(
        BundleInput(files=files, capability="incident_triage"),
        platform.registry,
        platform.profiles,
    )

    assert compilation.definition is None
    if name == "alias":
        assert compilation.diagnostics
    else:
        assert any(message in diagnostic.message for diagnostic in compilation.diagnostics)


def test_traversal_and_credential_paths_are_rejected_before_compilation():
    with pytest.raises(ValueError, match="normalized relative"):
        BundleInput(files={"../root_agent.yaml": "name: root_agent"}, capability="incident_triage")
    with pytest.raises(ValueError, match="Credential files"):
        BundleInput(files={"secrets.yaml": "token: hidden"}, capability="incident_triage")


def test_python_source_is_retained_as_inert_source_with_warning(harness_context):
    _settings, platform, _principal, _service = harness_context
    bundle = BundleInput(
        files={
            "root_agent.yaml": "name: root_agent\ninstruction: Inspect evidence\n",
            "helpers.py": "import os\nos.environ['RCA']\n",
        },
        capability="incident_triage",
    )
    compilation = compile_bundle(bundle, platform.registry, platform.profiles)

    assert compilation.definition is not None
    assert any(d.severity == "warning" and "cannot execute" in d.message for d in compilation.diagnostics)


def test_unknown_model_profile_is_rejected(harness_context):
    _settings, platform, _principal, _service = harness_context
    bundle = BundleInput(
        files={
            "root_agent.yaml": """name: root_agent
instruction: Inspect evidence
x-rca:
  model_profile: unknown-profile
"""
        },
        capability="incident_triage",
    )
    compilation = compile_bundle(bundle, platform.registry, platform.profiles)

    assert compilation.definition is None
    assert any("Unknown model profile" in d.message for d in compilation.diagnostics)


@pytest.mark.asyncio
async def test_default_graph_contains_valid_parallel_join(harness_context):
    _settings, platform, principal, service = harness_context
    bundle = await service.default(principal, "incident_triage")
    compilation = service.validate(principal, bundle)
    from app.configuration.harness_bundles import enriched_graph

    view = enriched_graph(compilation, platform.registry.get("incident_triage"), platform.profiles)
    node_ids = {node.id for node in view.nodes}
    joins = {node.id for node in view.nodes if node.kind == "join"}
    assert "evidence_acquisition_join" in joins
    assert "evidence_acquisition_join" in node_ids
    assert any(edge.target == "evidence_acquisition_join" for edge in view.edges)
