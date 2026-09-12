"""Data-only shared harness catalog and scoped project selection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field

from app.configuration.models import AgentDefinition, HarnessSelection
from app.configuration.yaml_data import load_yaml_data


class HarnessPlugin(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    capabilities: tuple[str, ...] = ()
    skills: tuple[str, ...] = ()
    agents: tuple[str, ...] = ()
    enabled: bool = True


class HarnessAgent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    definition: AgentDefinition
    enabled: bool = True


class HarnessDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: int = Field(default=1, ge=1)
    agents: tuple[HarnessAgent, ...] = ()
    plugins: tuple[HarnessPlugin, ...] = ()


class HarnessCatalog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if self.path.is_symlink() or self.path.absolute() != self.path.resolve():
            raise ValueError("Harness catalog must be a regular local file")
        self._registry = None
        self._skill_names = ()
        self.document = self._load()

    def _load(self) -> HarnessDocument:
        if not self.path.exists():
            return HarnessDocument()
        if self.path.stat().st_size > 262144:
            raise ValueError("Harness catalog exceeds 256 KiB")
        return HarnessDocument.model_validate(load_yaml_data(self.path.read_text()) or {})

    def _validate_refs(self):
        if self._registry is None:
            return
        caps = {c.id for c in self._capabilities}
        skills = set(self._skills)
        agents = {a.definition.id for a in self.document.agents}
        if len(agents) != len(self.document.agents):
            raise ValueError("Duplicate shared harness agent id")
        if len({p.id for p in self.document.plugins}) != len(self.document.plugins):
            raise ValueError("Duplicate harness plugin id")
        for agent in self.document.agents:
            if agent.definition.capability not in caps:
                raise ValueError("Shared agent references an unknown capability")
            if not set(agent.definition.tools) <= set(self._allowed_actions(agent.definition.capability)):
                raise ValueError("Shared agent requests an action outside its capability")
        for plugin in self.document.plugins:
            if not set(plugin.capabilities) <= caps or not set(plugin.skills) <= skills or not set(plugin.agents) <= agents:
                raise ValueError("Harness plugin references an unknown catalog entry")

    @property
    def _capabilities(self):
        return tuple(self._registry.list_all()) if hasattr(self, "_registry") else ()

    @property
    def _skills(self):
        return tuple(self._skill_names) if hasattr(self, "_skill_names") else ()

    def bind(self, registry):
        self._registry = registry
        self._skill_names = registry.skill_contents.keys()
        self._validate_refs()
        return self

    def _allowed_actions(self, capability):
        cap = self._registry.get(capability)
        return cap.allowed_actions if cap else ()

    @property
    def revision(self):
        payload = json.dumps(self.document.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        return "sha256:" + hashlib.sha256(payload).hexdigest()

    def validate_selection(self, selection):
        known = {
            "agents": {a.definition.id for a in self.document.agents},
            "plugins": {p.id for p in self.document.plugins},
            "skills": set(self._skills),
            "capabilities": {c.id for c in self._capabilities},
        }
        for field, values in selection.model_dump().items():
            kind = field.removeprefix("disabled_")
            if set(values) - known[kind]:
                raise ValueError(f"Unknown harness {kind} selection")
            if len(values) != len(set(values)):
                raise ValueError("Harness selection entries must be unique")
        for skill in selection.disabled_skills:
            rule = self._registry.inheritance.rules.get(skill)
            if not rule or rule.immutable or not rule.project_override:
                raise ValueError("Skill selection is not delegated to projects")

    def exclusions(self, selection=None):
        selection = selection or HarnessSelection()
        disabled = {
            "agents": set(selection.disabled_agents),
            "plugins": set(selection.disabled_plugins),
            "skills": set(selection.disabled_skills),
            "capabilities": set(selection.disabled_capabilities),
        }
        for plugin in self.document.plugins:
            if (not plugin.enabled or plugin.id in disabled["plugins"]
                    or selection.plugins and plugin.id not in selection.plugins):
                disabled["plugins"].add(plugin.id)
                for kind in ("agents", "skills", "capabilities"):
                    disabled[kind].update(getattr(plugin, kind))
        for agent in self.document.agents:
            if not agent.enabled:
                disabled["agents"].add(agent.definition.id)
        return disabled

    def resolve(self, selection=None):
        selection = selection or HarnessSelection()
        disabled = self.exclusions(selection)
        allowed = set(selection.agents) if selection.agents else {
            a.definition.id for a in self.document.agents
        }
        agents = [a for a in self.document.agents
                  if a.definition.id in allowed
                  and a.definition.id not in disabled["agents"]
                  and a.definition.capability not in disabled["capabilities"]]
        plugins = [p for p in self.document.plugins if p.id not in disabled["plugins"]]
        return agents, plugins

    def filter_approved(self, approved, selection=None):
        selection = selection or HarnessSelection()
        disabled = self.exclusions(selection)
        return [a for a in approved if a.definition.id not in disabled["agents"]
                and (not selection.agents or a.definition.id in selection.agents)]

    def replace(self, document: HarnessDocument, expected_revision: str):
        if expected_revision != self.revision:
            raise ValueError("Harness catalog changed; reload before saving")
        old = self.document
        self.document = document
        try:
            self._validate_refs()
        except Exception:
            self.document = old
            raise

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(yaml.safe_dump(self.document.model_dump(mode="json"), sort_keys=False), encoding="utf-8")
