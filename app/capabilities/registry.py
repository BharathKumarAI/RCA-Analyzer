"""Capabilities Registry loading YAML manifests and dynamic definitions."""

import hashlib
import json
from pathlib import Path
from types import MappingProxyType
from typing import Dict, List, Optional
from app.capabilities.models import CapabilityDefinition
from app.settings import CONTENT_ROOT
from app.configuration.layers import ConfigurationLayers
from app.configuration.yaml_data import load_yaml_data


class CapabilityRegistry:
    """Registry maintaining active platform and project capabilities."""

    def __init__(
        self, manifests_dir: str | None = None, projects_root: Path | None = None
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
        self.load_manifests()

    def load_manifests(self):
        if not self.manifests_dir.is_dir():
            raise FileNotFoundError(
                f"Capability manifest directory does not exist: {self.manifests_dir}"
            )
        loaded: Dict[str, CapabilityDefinition] = {}
        skill_root = (self.manifests_dir.parent / "skills").resolve()
        skill_bytes: Dict[str, bytes] = {}
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
        self._capabilities = loaded
        self.skill_contents = MappingProxyType(
            {name: data.decode("utf-8") for name, data in skill_bytes.items()}
        )
        self.inheritance = ConfigurationLayers(
            self.manifests_dir.parent / "layers",
            self.skill_contents,
            loaded,
            self.projects_root,
        )
        canonical = [cap.model_dump(mode="json") for cap in self.list_all()]
        payload = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        for path, data in sorted(skill_bytes.items()):
            payload += path.encode() + b"\0" + data
        payload += json.dumps(self.inheritance.files, sort_keys=True).encode()
        payload += json.dumps(self.inheritance.project_files, sort_keys=True).encode()
        self.content_hash = "sha256:" + hashlib.sha256(payload).hexdigest()

    def get(self, capability_id: str) -> Optional[CapabilityDefinition]:
        return self._capabilities.get(capability_id)

    def list_all(self) -> List[CapabilityDefinition]:
        return list(self._capabilities.values())
