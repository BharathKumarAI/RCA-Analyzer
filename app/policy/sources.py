"""Source fingerprint for the enforcement code pinned by runs and evaluations."""

from pathlib import Path


def enforcement_sources():
    root = Path(__file__).resolve().parents[1]
    paths = set((root / "policy").glob("*.py"))
    for directory in ("identity", "capabilities", "tools", "connectors"):
        paths.update((root / directory).rglob("*.py"))
    paths.update(
        root / name
        for name in (
            "configuration/layers.py",
            "configuration/models.py",
            "configuration/yaml_data.py",
            "runtime/governance.py",
            "agents/root.py",
            "models/bounded.py",
            "settings.py",
        )
    )
    return {str(path.relative_to(root)): path.read_text() for path in sorted(paths)}
