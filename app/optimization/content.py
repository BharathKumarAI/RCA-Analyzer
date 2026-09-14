"""Read and replace one text asset without changing skill metadata or code."""

import copy
import hashlib
import json
from pathlib import Path
import yaml
from app.capabilities.registry import CapabilityRegistry
from app.configuration.platform import STAGES
from app.configuration.yaml_data import load_yaml_data
from app.policy.sources import enforcement_sources
from app.runtime.run_contract import content_hash


def read_platform(settings, registry=None):
    registry = registry or CapabilityRegistry(
        str(settings.content_root / "capabilities"), settings.projects_root
    )
    prompts = load_yaml_data((settings.config_dir / "prompts.yaml").read_text())
    if not isinstance(prompts, dict) or set(prompts) != STAGES:
        raise ValueError("Invalid platform prompts")
    bundle = {"prompts": prompts, "skills": dict(registry.skill_contents)}
    files = {}
    for prefix, directory, pattern in [
        ("config", settings.config_dir, "*.yaml"),
        ("capabilities", settings.content_root / "capabilities", "**/*.yaml"),
        ("skills", settings.content_root / "skills", "*/SKILL.md"),
    ]:
        for path in sorted(directory.glob(pattern)):
            files[f"{prefix}/{path.relative_to(directory)}"] = path.read_text()
    for relative, text in registry.inheritance.files.items():
        files[f"layers/{relative}"] = text
    files.update(
        {
            f"projects/{name}": text
            for name, text in registry.inheritance.project_files.items()
        }
    )
    files.update(
        {f"policy/{name}": text for name, text in enforcement_sources().items()}
    )
    return bundle, content_hash(files), files


def split_skill(text):
    if not text.startswith("---\n"):
        raise ValueError("Skill requires YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Invalid skill frontmatter")
    return text[: end + 5], text[end + 5 :]


def target_text(bundle, request):
    if request.target_kind == "prompt":
        return bundle["prompts"][request.target_name]
    return split_skill(bundle["skills"][request.target_name])[1]


def replace_target(bundle, request, text, max_chars):
    if not isinstance(text, str) or not text.strip() or len(text) > max_chars:
        raise ValueError("Candidate text exceeds allowed bounds")
    if "{{" in text or "}}" in text:
        raise ValueError("These instruction assets do not permit template variables")
    candidate = copy.deepcopy(bundle)
    if request.target_kind == "prompt":
        candidate["prompts"][request.target_name] = text
    else:
        header, _ = split_skill(candidate["skills"][request.target_name])
        candidate["skills"][request.target_name] = header + text
    return candidate


def materialize(directory, files, bundle):
    """Build a temporary complete platform bundle for isolated replay evaluation."""
    directory = Path(directory)
    for relative, text in files.items():
        if relative.startswith("policy/"):
            continue
        path = (
            directory.parent if relative.startswith("projects/") else directory
        ) / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    (directory / "config/prompts.yaml").write_text(
        yaml.safe_dump(bundle["prompts"], sort_keys=True)
    )
    for name, text in bundle["skills"].items():
        path = directory / "skills" / name / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()
