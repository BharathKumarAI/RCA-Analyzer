"""Capabilities Registry loading YAML manifests and dynamic definitions."""

import hashlib
import json
from pathlib import Path
from types import MappingProxyType
from typing import Dict, List, Optional
import yaml
from app.capabilities.models import CapabilityDefinition
from app.settings import CONTENT_ROOT
from app.configuration.layers import ConfigurationLayers
from app.configuration.harness import HarnessCatalog
from app.configuration.yaml_data import load_yaml_data
from app.configuration.models import CatalogSkill, SkillRule


class CapabilityRegistry:
    """Registry maintaining active platform and project capabilities."""

    def __init__(
        self, manifests_dir: str | None = None, projects_root: Path | None = None,
        managed_skills=(), active_skill_ids=None,
    ):
        self.manifests_dir = (
            Path(manifests_dir).expanduser()
            if manifests_dir
            else CONTENT_ROOT / "capabilities"
        ).resolve()
        self.projects_root = (
            projects_root or self.manifests_dir.parent.parent / "projects"
        ).resolve()
        self._capabilities: Dict[str, CapabilityDefinition] = {}
        self.content_hash = ""
        self.managed_skills = tuple(CatalogSkill.model_validate(item) for item in managed_skills)
        self.active_skill_ids = frozenset(
            skill.id for skill in self.managed_skills
        ) if active_skill_ids is None else frozenset(active_skill_ids)
        self.load_manifests()

    def load_manifests(self):
        if not self.manifests_dir.is_dir():
            raise FileNotFoundError(
                f"Capability manifest directory does not exist: {self.manifests_dir}"
            )
        loaded: Dict[str, CapabilityDefinition] = {}
        skill_root = (self.manifests_dir.parent / "skills").resolve()
        skill_bytes: Dict[str, bytes] = {}
        # Keep unattached library definitions available for scoped overrides and
        # offline replay; only capability bindings make their instructions run.
        for skill_path in sorted(skill_root.glob("*/SKILL.md")):
            if skill_path.resolve() != skill_path or not skill_path.is_file() or skill_path.stat().st_size > 65536:
                raise ValueError("Skills must be bounded regular local files")
            skill_bytes[skill_path.parent.name] = skill_path.read_bytes()
        for path in sorted(self.manifests_dir.iterdir()):
            if path.suffix not in (".yaml", ".yml") or not path.is_file():
                continue
            with path.open("r", encoding="utf-8") as f:
                data = load_yaml_data(f.read())
            if not isinstance(data, dict):
                raise ValueError(f"Capability manifest must be a mapping: {path}")
            cap = CapabilityDefinition.model_validate(data)
            for skill in cap.skills:
                skill_path = (skill_root / skill / "SKILL.md").resolve()
                if (
                    skill_path != skill_root / skill / "SKILL.md"
                    or skill_root not in skill_path.parents
                    or not skill_path.is_file()
                ):
                    raise ValueError(
                        f"Capability {cap.id} references missing skill: {skill}"
                    )
                skill_bytes[skill] = skill_path.read_bytes()
            if cap.id in loaded:
                raise ValueError(f"Duplicate capability id: {cap.id}")
            loaded[cap.id] = cap
        additional_rules = {}
        for skill in self.managed_skills:
            if skill.id in skill_bytes or skill.id in additional_rules or (skill_root / skill.id).exists():
                raise ValueError(f"Skill already exists: {skill.id}")
            for capability_id in skill.capabilities:
                cap = loaded.get(capability_id)
                if cap is None or not cap.enabled:
                    raise ValueError(f"Skill references an unavailable capability: {capability_id}")
                if set(skill.actions) - set(cap.allowed_actions):
                    raise ValueError("Skill actions exceed capability permissions")
                if skill.id in self.active_skill_ids:
                    loaded[capability_id] = cap.model_copy(update={"skills": (*cap.skills, skill.id)})
            metadata = {"name": skill.name, "description": skill.description,
                        "summary": skill.description, "version": "1.0.0"}
            skill_bytes[skill.id] = ("---\n" + yaml.safe_dump(metadata, sort_keys=False)
                                      + "---\n\n" + skill.instruction + "\n").encode()
            additional_rules[skill.id] = SkillRule(immutable=not skill.project_override,
                project_override=skill.project_override, actions=skill.actions)
        for cap in loaded.values():
            if any(skill.id in cap.skills for skill in self.managed_skills) and sum(
                len(skill_bytes[name].decode("utf-8")) for name in cap.skills
            ) > 64000:
                raise ValueError("Combined skill instructions exceed the 64,000-character capability limit")
        self._capabilities = loaded
        self.skill_contents = MappingProxyType(
            {name: data.decode("utf-8") for name, data in skill_bytes.items()}
        )
        self.inheritance = ConfigurationLayers(
            self.manifests_dir.parent / "layers",
            self.skill_contents,
            loaded,
            self.projects_root,
            additional_skill_rules=additional_rules,
        )
        self.harness = HarnessCatalog(self.manifests_dir.parent / "config/harness.yaml").bind(self)
        self.inheritance.harness = self.harness
        for project in self.inheritance.projects.values():
            self.harness.validate_selection(project.harness)
        canonical = [cap.model_dump(mode="json") for cap in self.list_all()]
        payload = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        for path, data in sorted(skill_bytes.items()):
            payload += path.encode() + b"\0" + data
        payload += self.harness.revision.encode()
        payload += json.dumps(self.inheritance.files, sort_keys=True).encode()
        payload += json.dumps(self.inheritance.project_files, sort_keys=True).encode()
        payload += json.dumps([s.model_dump(mode="json") for s in self.managed_skills], sort_keys=True).encode()
        payload += json.dumps(sorted(self.active_skill_ids)).encode()
        self.content_hash = "sha256:" + hashlib.sha256(payload).hexdigest()

    def get(self, capability_id: str) -> Optional[CapabilityDefinition]:
        return self._capabilities.get(capability_id)

    def list_all(self) -> List[CapabilityDefinition]:
        return list(self._capabilities.values())
