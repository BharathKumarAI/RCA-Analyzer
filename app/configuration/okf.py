"""Bounded data-only Open Knowledge Format v0.2 interchange.

The format is pinned to upstream SPEC.md at OKF_SPEC_COMMIT. No path is
extracted, fetched or executed; imported trust claims never grant local approval.
"""

import hashlib
import io
import json
import math
import posixpath
import re
import stat
import unicodedata
import zipfile
from datetime import date, datetime
from pathlib import PurePosixPath
from typing import Any, Literal
from urllib.parse import unquote, urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field
from yaml.events import AliasEvent, CollectionEndEvent, CollectionStartEvent

from app.configuration.yaml_data import load_yaml_data
from app.policy.redaction import redact

OKF_SPEC_COMMIT = "0b87c52c6ef999286c745e19998fdfcd03d5dbee"
OKF_SPEC_URL = f"https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/{OKF_SPEC_COMMIT}/SPEC.md"


class OKFPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    max_files: int = Field(default=64, ge=1, le=256)
    max_file_bytes: int = Field(default=1048576, ge=1024, le=8388608)
    max_expanded_bytes: int = Field(default=8388608, ge=1024, le=33554432)
    max_path_depth: int = Field(default=8, ge=1, le=16)
    max_metadata_bytes: int = Field(default=32768, ge=1024, le=65536)
    export_enabled: bool = True
    exclude_stale: bool = True
    exclude_draft: bool = True
    exclude_deprecated: bool = True


class OKFDiagnostic(BaseModel):
    path: str
    code: str
    message: str


class OKFConcept(BaseModel):
    path: str
    title: str
    type: str
    content: str
    metadata: dict[str, Any]
    redacted: bool
    source_hash: str
    links: list[dict[str, Any]] = Field(default_factory=list)
    doc_id: str | None = None
    current_hash: str | None = None
    operation: Literal["create", "update"] = "create"


class OKFNavigation(BaseModel):
    path: str
    metadata: dict[str, Any]
    content: str


class OKFPreview(BaseModel):
    bundle_id: str | None
    name: str
    source_hash: str
    preview_hash: str
    concepts: list[OKFConcept]
    diagnostics: list[OKFDiagnostic]
    navigation: list[OKFNavigation]
    spec_url: str = OKF_SPEC_URL


def byte_hash(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def path_name(raw: str, max_depth: int = 16) -> str:
    path = unicodedata.normalize("NFC", raw)
    if (not path or len(path.encode()) > 1024 or path.startswith("/") or "\\" in path
            or any(ord(c) < 32 or ord(c) == 127 for c in path)
            or any(c in path for c in (":", "?", "#", "%"))
            or any(part in {"", ".", ".."} for part in path.split("/"))
            or len(path.split("/")) > max_depth):
        raise ValueError("Bundle paths must be bounded relative paths without traversal or URL syntax")
    return path


def _json_data(value, depth=0):
    if depth > 12:
        raise ValueError("Frontmatter nesting exceeds 12 levels")
    if isinstance(value, dict):
        if len(value) > 100:
            raise ValueError("Frontmatter mapping exceeds 100 entries")
        return {key: _json_data(item, depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        if len(value) > 100:
            raise ValueError("Frontmatter list exceeds 100 entries")
        return [_json_data(item, depth + 1) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise ValueError("Frontmatter must contain finite data values only")


def metadata_data(value: dict, *, maximum=65536) -> dict:
    result = _json_data(value)
    if not isinstance(result, dict) or len(json.dumps(result, ensure_ascii=False).encode()) > maximum:
        raise ValueError("Frontmatter exceeds the configured metadata limit")
    if isinstance(result.get("verified"), dict):
        result["verified"] = [result["verified"]]
    return result


def frontmatter(text: str, *, required: bool, maximum: int) -> tuple[dict, str]:
    text = text.removeprefix("\ufeff").replace("\r\n", "\n")
    if not text.startswith("---\n"):
        if required:
            raise ValueError("Concept requires YAML frontmatter with a type")
        return {}, text
    end = re.search(r"(?m)^---\s*$", text[4:])
    if end is None:
        raise ValueError("Frontmatter closing delimiter is missing")
    source = text[4:4 + end.start()]
    if len(source.encode()) > maximum:
        raise ValueError("Frontmatter exceeds the configured metadata limit")
    depth = 0
    try:
        for count, event in enumerate(yaml.parse(source)):
            if count > 4096 or isinstance(event, AliasEvent) or getattr(event, "anchor", None):
                raise ValueError("YAML aliases, anchors or excessive structure are not allowed")
            if isinstance(event, CollectionStartEvent):
                depth += 1
            elif isinstance(event, CollectionEndEvent):
                depth -= 1
            if depth > 12:
                raise ValueError("Frontmatter nesting exceeds 12 levels")
        value = load_yaml_data(source) if source.strip() else {}
        metadata = metadata_data(value, maximum=maximum)
    except (yaml.YAMLError, RecursionError, TypeError) as exc:
        raise ValueError("Frontmatter must be safe bounded YAML data") from exc
    return metadata, text[4 + end.end():].lstrip("\n")


def timestamp(value) -> float | None:
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo and parsed.utcoffset() is not None else None
    except (ValueError, OverflowError):
        return None


def eligibility(envelope: dict | None, policy: OKFPolicy, now: float) -> dict:
    metadata = (envelope or {}).get("metadata") or {}
    lifecycle = metadata.get("status", "stable")
    deadline = timestamp(metadata.get("stale_after"))
    freshness = "unknown" if deadline is None else "stale" if now >= deadline else "current"
    reason = "eligible"
    if lifecycle == "draft" and policy.exclude_draft:
        reason = "source_draft"
    elif lifecycle == "deprecated" and policy.exclude_deprecated:
        reason = "source_deprecated"
    elif freshness == "stale" and policy.exclude_stale:
        reason = "source_stale"
    return {"eligible": reason == "eligible", "reason": reason, "freshness": freshness,
            "source_status": lifecycle, "stale_after": metadata.get("stale_after"),
            "policy": {key: getattr(policy, key) for key in ("exclude_stale", "exclude_draft", "exclude_deprecated")}}


def concept_links(path: str, body: str, metadata: dict, paths: set[str]) -> tuple[list[dict], list[OKFDiagnostic]]:
    targets = re.findall(r"\[[^\]\n]*\]\(\s*<?([^\s>)]+)>?(?:\s+[^)]*)?\)", body)
    targets += re.findall(r"(?m)^\[[^\]\n]+\]:\s*<?([^\s>]+)>?", body)
    targets += [item.get("resource") for item in metadata.get("sources", []) if isinstance(item, dict)] if isinstance(metadata.get("sources"), list) else []
    targets += [metadata.get("resource"), metadata.get("computation")]
    targets += [(metadata.get(key) or {}).get("resource") for key in ("executor", "attester") if isinstance(metadata.get(key), dict)]
    links, diagnostics = [], []
    unique = list(dict.fromkeys(value for value in targets if isinstance(value, str)))
    if len(unique) > 256:
        diagnostics.append(OKFDiagnostic(path=path, code="link_limit", message="Only the first 256 distinct references are indexed; source text and metadata remain preserved."))
    for target in unique[:256]:
        try:
            parsed = urlsplit(target)
        except ValueError:
            diagnostics.append(OKFDiagnostic(path=path, code="unresolved_link", message="A malformed source link was preserved without resolving it."))
            continue
        if parsed.scheme or parsed.netloc or not parsed.path or " " in parsed.path:
            continue
        decoded = unquote(parsed.path)
        resolved = posixpath.normpath(decoded.lstrip("/") if decoded.startswith("/") else posixpath.join(posixpath.dirname(path), decoded))
        valid = not (resolved == ".." or resolved.startswith("../") or "\\" in resolved)
        candidates = [resolved] if resolved.endswith(".md") else [resolved + ".md", resolved.rstrip("/") + "/index.md"]
        found = next((candidate for candidate in candidates if candidate in paths), None) if valid else None
        links.append({"target": target, "path": found or (candidates[0] if valid else None), "resolved": found is not None})
        if found is None:
            diagnostics.append(OKFDiagnostic(path=path, code="unresolved_link", message=f"Bundle reference is unavailable: {target}"))
    return links, diagnostics


def parse_bundle(filename: str, raw: bytes, policy: OKFPolicy) -> tuple[list[OKFConcept], list[OKFNavigation], list[OKFDiagnostic]]:
    if len(raw) > policy.max_expanded_bytes:
        raise ValueError("Upload exceeds the configured OKF byte limit")
    files = {}
    if filename.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries = archive.infolist()
                if len(entries) > policy.max_files:
                    raise ValueError("Archive exceeds the configured entry count")
                total = 0
                seen = set()
                for info in entries:
                    path = path_name(info.filename.rstrip("/") if info.is_dir() else info.filename, policy.max_path_depth)
                    key = path.casefold()
                    if key in seen:
                        raise ValueError("Archive has duplicate normalized paths")
                    seen.add(key)
                    mode = info.external_attr >> 16
                    if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
                        raise ValueError("Archive links and special files are not allowed")
                    if info.is_dir():
                        continue
                    total += info.file_size
                    if (info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                            or info.file_size > policy.max_file_bytes or total > policy.max_expanded_bytes
                            or info.file_size > max(1, info.compress_size) * 200):
                        raise ValueError("Archive exceeds the expansion limit or uses unsupported compression")
                    if not path.endswith(".md"):
                        raise ValueError("RCA imports Markdown bundle entries only; code and binary assets are not admitted")
                    if any(path.casefold().startswith(saved.casefold() + "/") or saved.casefold().startswith(path.casefold() + "/") for saved in files):
                        raise ValueError("Archive file and directory paths collide")
                    with archive.open(info) as entry:
                        data = entry.read(policy.max_file_bytes + 1)
                    if len(data) != info.file_size or len(data) > policy.max_file_bytes:
                        raise ValueError("Archive entry exceeded its declared bound")
                    files[path] = data
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
            raise ValueError("Invalid or unsupported ZIP archive") from exc
    else:
        path = path_name(filename, policy.max_path_depth)
        if not path.endswith(".md") or len(raw) > policy.max_file_bytes:
            raise ValueError("Upload one bounded Markdown file or a ZIP of Markdown files")
        files[path] = raw
    concepts, navigation, diagnostics = [], [], []
    for path, data in sorted(files.items()):
        reserved = PurePosixPath(path).name in {"index.md", "log.md"}
        metadata, body = frontmatter(data.decode("utf-8"), required=not reserved, maximum=policy.max_metadata_bytes)
        clean_metadata, clean_body = redact(metadata, max_text=policy.max_file_bytes), redact(body, max_text=policy.max_file_bytes)
        changed = clean_metadata != metadata or clean_body != body
        if changed:
            diagnostics.append(OKFDiagnostic(path=path, code="redacted", message="Sensitive content was masked; original bytes remain a separately protected download."))
        if reserved:
            navigation.append(OKFNavigation(path=path, metadata=clean_metadata, content=clean_body))
            if path == "index.md" and metadata.get("okf_version", "0.2") != "0.2":
                diagnostics.append(OKFDiagnostic(path=path, code="format_version", message="Bundle declares a version other than the supported OKF 0.2."))
            continue
        kind = clean_metadata.get("type")
        if not isinstance(kind, str) or not kind.strip() or len(kind) > 128:
            raise ValueError("Concept type must be nonblank text of at most 128 characters")
        title = clean_metadata.get("title") or PurePosixPath(path).stem
        tags = clean_metadata.get("tags", [])
        if not isinstance(title, str) or len(title) > 256 or not isinstance(tags, list) or len(tags) > 32 or any(not isinstance(tag, str) or not tag or len(tag) > 64 for tag in tags):
            raise ValueError("Concept title or tags exceed the knowledge catalog limits")
        links, missing = concept_links(path, clean_body, clean_metadata, set(files))
        diagnostics.extend(missing)
        if metadata.get("stale_after") and timestamp(metadata["stale_after"]) is None:
            diagnostics.append(OKFDiagnostic(path=path, code="freshness_unknown", message="Freshness timestamp has no valid explicit offset; freshness remains unknown."))
        if kind == "Attested Computation":
            diagnostics.append(OKFDiagnostic(path=path, code="not_executed", message="Computation and verification claims are documentation only; RCA does not execute or attest imported code."))
        concepts.append(OKFConcept(path=path, title=title, type=kind, content=clean_body, metadata=clean_metadata,
                                   redacted=changed, source_hash=byte_hash(data), links=links))
    if not concepts:
        raise ValueError("Bundle must contain at least one concept apart from index.md and log.md")
    return concepts, navigation, diagnostics


def markdown_bytes(metadata: dict, body: str) -> bytes:
    return ("---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n" + body).encode()
