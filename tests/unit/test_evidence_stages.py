"""Capability source stages use saved prompts and frozen configured models."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.agents import root
from app.capabilities.models import CapabilityDefinition
from app.configuration.harness_bundles import BundleInput, compile_bundle
from app.configuration.layers import ConfigurationLayers
from app.configuration.models import ProjectLayer, WorkflowOptions
from app.configuration.platform import PlatformConfiguration
from app.configuration.workflow import available_builtins
from app.models.profiles import ModelProfiles, StageModel
from app.runtime.run_contract import RunRequest
from app.settings import Settings
from tests.support import model_factory


def source_profiles():
    profiles = ModelProfiles.load()
    data = profiles.model_dump()
    data["stages"]["logs"]["enabled"] = False
    data["stages"]["evidence"]["model"] = "source-configured-model"
    data["stages"]["oracle_diagnostics"] = {"model": "approved-oracle-model"}
    return ModelProfiles.model_validate(data)


def source_capability():
    return CapabilityDefinition(id="source_review", version="1.0.0", name="Oracle diagnostics",
        description="Assess the selected database evidence", category="database", agent_stages=("evidence",),
        requires={"connectors": ("oracle",)}, permissions={"allowed_actions": ("oracle.read_evidence",)})


def build(monkeypatch, profiles, snapshot):
    captured = {}
    def capture(_definition, agents, _concurrency):
        captured.update(agents)
        return agents
    monkeypatch.setattr(root, "compile_native", capture)
    governance = SimpleNamespace(settings=Settings(), failures=[], run_events=None,
        prepare_model_request=None, before_tool=None, after_tool=None, on_tool_error=None,
        after_model=None, evidence_marker="SAVED_CURRENT_EVIDENCE", attachment_marker="SAVED_ATTACHMENTS")
    contract = SimpleNamespace(model_config_json=json.dumps(snapshot), model_profile="balanced-investigation",
        request=RunRequest(text="Review the database"))
    root.build_root_agent(contract, source_capability(), governance, profiles,
        {key: "CURRENT_MUTABLE_PROMPT" for key in ("triage", "logs", "evidence", "extraction", "orchestrator", "router", "synthesis")},
        {"oracle": SimpleNamespace(connector_id="oracle"), "kafka": SimpleNamespace(connector_id="kafka")},
        asyncio.Semaphore(1), [], model_factory=model_factory)
    return captured


def test_sources_remain_independent_of_logs_and_use_frozen_models_and_prompts(monkeypatch):
    profiles = source_profiles()
    stages = profiles.resolve("balanced-investigation")
    capability = source_capability()
    names = available_builtins(capability, stages, WorkflowOptions(), capability.allowed_actions)
    assert "connector_evidence_investigator" in names
    assert "logs_investigator" not in names
    snapshot = {"stages": {name: stage.model_dump() for name, stage in stages.items()},
        "prompts": {key: "SAVED_" + key for key in ("triage", "logs", "evidence", "extraction", "orchestrator", "router", "synthesis")}}
    profiles.stages["evidence"] = StageModel(model="later-config-change", enabled=False)
    agents = build(monkeypatch, profiles, snapshot)
    evidence = agents["connector_evidence_investigator"]
    assert evidence.model.model == "source-configured-model"
    assert [tool.name for tool in evidence.tools] == ["read_oracle_evidence"]
    assert "SAVED_evidence" in evidence.instruction
    assert capability.name in evidence.instruction
    assert "CURRENT_MUTABLE_PROMPT" not in evidence.instruction
    synthesis = agents["rca_synthesizer"].instruction(SimpleNamespace(state={"connector_evidence_result": "SOURCE_STAGE_NOTES"}))
    assert "SOURCE_STAGE_NOTES" in synthesis
    assert "SAVED_CURRENT_EVIDENCE" in synthesis
    assert "Unverified stage notes" in synthesis


def test_legacy_profiles_and_project_prompt_overrides_are_preserved(tmp_path):
    profiles = source_profiles().model_dump()
    for profile in profiles["profiles"].values():
        profile.pop("evidence")
    legacy = ModelProfiles.model_validate(profiles)
    resolved = legacy.resolve("balanced-investigation")
    assert resolved["evidence"] == resolved["logs"]
    layers = ConfigurationLayers(tmp_path / "layers", (), {}, tmp_path / "projects")
    principal = SimpleNamespace(tenant_id="t", project_id="p", subject="s")
    layers.projects[("t", "p")] = ProjectLayer(tenant_id="t", project_id="p", prompts={"logs": "Saved project source instruction"})
    runtime = layers.runtime(principal, Settings(), {"logs": "Platform instruction"})
    assert runtime["prompts"]["evidence"] == "Saved project source instruction"
    runtime = layers.runtime(principal, Settings(), {"logs": "Platform instruction", "evidence": "Explicit evidence instruction"})
    assert runtime["prompts"]["evidence"] == "Explicit evidence instruction"


def test_saved_six_stage_prompts_remain_valid_and_optional_evidence_is_nonempty():
    settings = Settings()
    prompts = dict(PlatformConfiguration.load(settings).prompts)
    assert "evidence" in prompts
    prompts.pop("evidence")
    loaded = PlatformConfiguration.load(settings, db_configs={"prompts": prompts})
    assert loaded.prompts == prompts
    with pytest.raises(ValueError, match="optional evidence instruction"):
        PlatformConfiguration.load(settings, db_configs={"prompts": {**prompts, "evidence": " "}})


@pytest.mark.parametrize("stage,valid", [("evidence", True), ("oracle_diagnostics", True), ("logs", False), ("unknown_stage", False)])
def test_harness_accepts_only_existing_enabled_profile_alias_or_stage(stage, valid):
    platform = PlatformConfiguration.load(Settings())
    source = f"name: root_agent\ninstruction: Inspect permitted source evidence\nx-rca:\n  stage_model: {stage}\n"
    compilation = compile_bundle(BundleInput(files={"root_agent.yaml": source}, capability="incident_triage"), platform.registry, source_profiles())
    assert (compilation.definition is not None) is valid


def test_harness_model_snapshot_survives_profile_change(monkeypatch):
    profiles = source_profiles()
    platform = PlatformConfiguration.load(Settings())
    source = "name: root_agent\ninstruction: Inspect permitted evidence\nx-rca:\n  stage_model: oracle_diagnostics\n"
    compilation = compile_bundle(BundleInput(files={"root_agent.yaml": source}, capability="incident_triage"), platform.registry, profiles)
    assert compilation.definition is not None
    snapshot = {"harness_bundle": {"compilation": compilation.model_dump()},
        "harness_models": {"root_agent.yaml": profiles.stages["oracle_diagnostics"].model_dump()}}
    profiles.stages["oracle_diagnostics"] = StageModel(model="changed-later")
    agents = build(monkeypatch, profiles, snapshot)
    assert agents["root_agent.yaml"].model.model == "approved-oracle-model"


def test_source_notes_output_key_cannot_be_overwritten_by_custom_agent():
    platform = PlatformConfiguration.load(Settings())
    source = "name: root_agent\ninstruction: Inspect evidence\noutput_key: connector_evidence_result\n"
    compilation = compile_bundle(BundleInput(files={"root_agent.yaml": source}, capability="incident_triage"), platform.registry, platform.profiles)
    assert compilation.definition is None
    assert any("reserved output_key" in diagnostic.message for diagnostic in compilation.diagnostics)
