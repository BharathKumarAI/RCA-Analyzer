"""Stable project namespaces shared by local storage and GCS object prefixes."""

import hashlib
from pathlib import Path
import re
from typing import Literal

ArtifactKind = Literal[
    "agent-configurations", "optimizations", "chats", "framework-uploads", "knowledge"
]


def scope_key(value: str) -> str:
    if not isinstance(value, str) or not value or len(value.encode()) > 1024:
        raise ValueError(
            "Storage scope must be a nonempty identifier of at most 1024 bytes"
        )
    label = re.sub(r"[^a-z0-9_-]", "-", value.lower())[:40].strip("-") or "scope"
    return label + "--" + hashlib.sha256(value.encode()).hexdigest()


def project_prefix(tenant_id: str, project_id: str) -> str:
    return f"{scope_key(tenant_id)}/{scope_key(project_id)}"


def project_artifact_uri(
    root: str, tenant_id: str, project_id: str, kind: ArtifactKind
) -> str:
    if kind not in {
        "agent-configurations",
        "optimizations",
        "chats",
        "framework-uploads",
        "knowledge",
    }:
        raise ValueError("Unknown project artifact kind")
    directory = {
        "agent-configurations": "framework/objects/agents",
        "optimizations": "framework/optimizations/objects",
        "framework-uploads": "framework/uploads",
        "chats": "chats",
        "knowledge": "knowledge/objects",
    }[kind]
    prefix = project_prefix(tenant_id, project_id)
    if root.startswith("gs://"):
        return f"{root.rstrip('/')}/{prefix}/artifacts/{directory}"
    if "://" in root:
        raise ValueError("Project artifacts require local storage or a gs:// URI")
    path = Path(root).expanduser().resolve() / prefix / "artifacts" / directory
    if path.resolve() != path:
        raise ValueError("Project artifact directories cannot follow symlinks")
    return str(path)
