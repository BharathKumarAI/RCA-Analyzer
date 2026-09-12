"""Bounded ADK source bundles. Imported code is retained as text, never loaded."""
from __future__ import annotations

import io
import json
import posixpath
import stat
import zipfile
from pathlib import PurePosixPath
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.configuration.models import AgentDefinition
from app.configuration.workflow import Node, WorkflowDefinition, compatibility, graph_view
from app.configuration.yaml_data import load_yaml_data
from app.tools.catalog import ALLOWED_ACTIONS

MAX_FILES = 100
MAX_BUNDLE_BYTES = 512 * 1024
MAX_FILE_BYTES = 65536
BUILTINS = {"request_orchestrator": "orchestrator", "triage_agent": "triage", "logs_investigator": "logs",
            "file_investigator": "extraction", "connector_evidence_investigator": "logs",
            "specialist_router": "router", "rca_synthesizer": "synthesis"}


def safe_path(path):
    if not path or len(path) > 240 or "\\" in path or ":" in path or "\x00" in path:
        raise ValueError("Invalid bundle path")
    p = PurePosixPath(path)
    if p.is_absolute() or ".." in p.parts or str(p) != path or path.startswith("."):
        raise ValueError("Bundle paths must be normalized relative paths")
    if any(part.startswith(".") for part in p.parts):
        raise ValueError("Hidden files and credentials cannot be imported")
    if p.name.lower() in {"credentials.json", "secrets.yaml", "secrets.yml"} or p.suffix.lower() in {".pem", ".key", ".p12"}:
        raise ValueError("Credential files cannot be imported")
    return path


class BundleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: dict[str, str] = Field(min_length=1, max_length=MAX_FILES)
    capability: str = Field(min_length=1, max_length=128)

    @field_validator("files")
    @classmethod
    def bounded_files(cls, files):
        total = 0
        for path, source in files.items():
            safe_path(path)
            size = len(source.encode())
            if size > MAX_FILE_BYTES:
                raise ValueError("Each bundle file is limited to 64 KiB")
            total += size
        if total > MAX_BUNDLE_BYTES:
            raise ValueError("Bundle exceeds 512 KiB")
        return files


class Diagnostic(BaseModel):
    path: str
    message: str
    severity: Literal["error", "warning"] = "error"


class GraphNode(BaseModel):
    id: str
    kind: str
    label: str
    parent: str | None = None
    ref: str | None = None
    source: str | None = None
    enabled: bool = True
    reason: str | None = None
    editable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: str


class Graph(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class Permissions(BaseModel):
    edit: bool = False
    review: bool = False


class Workspace(BaseModel):
    files: dict[str, str]
    graph: Graph
    diagnostics: list[Diagnostic]
    compatibility: dict[str, Any]
    revision: str
    active_revision: str | None = None
    draft_id: str | None = None
    status: str
    permissions: Permissions
    capability: str
    capabilities: list[str]
    author: str | None = None


class Compilation(BaseModel):
    definition: WorkflowDefinition | None = None
    agents: dict[str, AgentDefinition] = Field(default_factory=dict)
    overrides: dict[str, AgentDefinition] = Field(default_factory=dict)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    sources: dict[str, str] = Field(default_factory=dict)


def import_archive(data: bytes, filename: str):
    if len(data) > MAX_BUNDLE_BYTES:
        raise ValueError("Import exceeds 512 KiB")
    if not filename.lower().endswith(".zip"):
        return {safe_path(PurePosixPath(filename).name): data.decode("utf-8")}
    files, total = {}, 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if len(archive.infolist()) > MAX_FILES:
                raise ValueError("Archive has more than 100 entries")
            for info in archive.infolist():
                if info.is_dir():
                    safe_path(info.filename.rstrip("/"))
                    continue
                path = safe_path(info.filename)
                if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise ValueError("Symlinks and encrypted archives are not supported")
                total += info.file_size
                if info.file_size > MAX_FILE_BYTES or total > MAX_BUNDLE_BYTES or path in files:
                    raise ValueError("Archive has duplicate paths or exceeds expanded size limits")
                with archive.open(info) as stream:
                    raw = stream.read(MAX_FILE_BYTES + 1)
                if len(raw) > MAX_FILE_BYTES:
                    raise ValueError("Archive entry exceeds limit")
                files[path] = raw.decode("utf-8")
    except (zipfile.BadZipFile, UnicodeError) as exc:
        raise ValueError("Expected UTF-8 source files or a valid ZIP archive") from exc
    return files


def export_archive(files, diagnostics=()):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, source in sorted(files.items()):
            archive.writestr(safe_path(path), source)
        archive.writestr("RCA-PORTABILITY.txt", "Exported source bundle. Python files are inert in RCA.\n"
                         "RCA workflow, governance, and model-profile references require the RCA runtime.\n"
                         + "\n".join(d.message for d in diagnostics))
    return output.getvalue()


def compile_bundle(bundle, registry, profiles):
    result = Compilation()
    cap = registry.get(bundle.capability)
    if not cap or not cap.enabled:
        result.diagnostics.append(Diagnostic(path="rca/workflow.yaml", message="Capability is missing or disabled"))
        return result
    parsed = {}
    for path, source in bundle.files.items():
        if path.endswith((".yaml", ".yml")):
            try:
                parsed[path] = load_yaml_data(source)
            except (ValueError, yaml.YAMLError, RecursionError):
                result.diagnostics.append(Diagnostic(path=path, message="Invalid or unsafe YAML; use unique string keys without anchors"))
        elif path.endswith(".py"):
            result.diagnostics.append(Diagnostic(path=path, message="Python source is preserved for export and cannot execute in RCA", severity="warning"))
    visiting = set()
    built = {}
    nodes = []

    def resolve_path(parent, ref):
        path = posixpath.normpath(posixpath.join(posixpath.dirname(parent), ref))
        safe_path(path)
        if path not in parsed:
            raise ValueError("Missing YAML reference: " + path)
        return path

    def agent(path, builtin=None):
        if path in visiting:
            raise ValueError("Cyclic agent configuration references")
        if path in built:
            return built[path]
        visiting.add(path)
        data = parsed.get(path)
        if not isinstance(data, dict):
            raise ValueError("Agent configuration must be a mapping: " + path)
        allowed = {"name", "agent_class", "description", "instruction", "model", "tools", "sub_agents", "output_key", "x-rca"}
        unsupported = set(data) - allowed
        if unsupported:
            raise ValueError("Unsupported agent fields in " + path + ": " + ", ".join(sorted(unsupported)))
        name = data.get("name")
        klass = data.get("agent_class", "LlmAgent")
        if klass in {"SequentialAgent", "ParallelAgent"}:
            children = []
            for sub in data.get("sub_agents", []):
                if not isinstance(sub, dict) or set(sub) != {"config_path"}:
                    raise ValueError("Sub-agents require local config_path references")
                children.append(agent(resolve_path(path, sub["config_path"])))
            nodes.append(Node(id=name, kind="sequence" if klass == "SequentialAgent" else "parallel", children=children))
        elif klass == "LlmAgent":
            if data.get("sub_agents"):
                raise ValueError("LlmAgent sub-agent routing is not interchangeable with AgentTool delegation; register a governed specialist")
            meta = data.get("x-rca", {})
            if not isinstance(meta, dict) or set(meta) - {"model_profile", "stage_model", "builtin"}:
                raise ValueError("Unsupported x-rca mapping")
            stage = meta.get("stage_model", BUILTINS.get(builtin, "logs"))
            profile = meta.get("model_profile", cap.model_profile)
            if profile not in profiles.profiles:
                raise ValueError("Unknown model profile in " + path)
            config = profiles.resolve(profile).get(stage)
            if config is None or not config.enabled:
                raise ValueError("Model stage is missing or disabled in " + path)
            if data.get("model") and data["model"] != config.model:
                raise ValueError("Imported model must match an authorized model profile in " + path)
            actions = []
            for tool in data.get("tools", []):
                action = tool if isinstance(tool, str) else tool.get("name") if isinstance(tool, dict) and set(tool) == {"name"} else None
                if action not in ALLOWED_ACTIONS or action not in cap.allowed_actions:
                    raise ValueError("Unresolved or unauthorized tool in " + path)
                actions.append(action)
            definition = AgentDefinition(id=name, version="1.0.0", name=name,
                description=data.get("description", ""), instruction=data.get("instruction", ""),
                capability=cap.id, model_profile=profile, stage_model=stage, tools=actions)
            if builtin:
                if builtin not in BUILTINS or name != builtin:
                    raise ValueError("Invalid builtin override")
                result.overrides[builtin] = definition
            else:
                result.agents[path] = definition
                nodes.append(Node(id=name, kind="agent", ref=path))
        else:
            raise ValueError("Unsupported ADK class: " + str(klass))
        visiting.remove(path)
        built[path] = name
        result.sources[name] = path
        return name

    try:
        if "rca/workflow.yaml" in parsed:
            result.definition = WorkflowDefinition.model_validate(parsed["rca/workflow.yaml"])
            for node in result.definition.nodes:
                if node.kind == "agent":
                    agent(node.ref)
                elif node.kind == "builtin":
                    if node.ref not in BUILTINS or node.id != node.ref:
                        raise ValueError("Unknown builtin stage or renamed builtin")
                    source = "agents/" + node.ref + ".yaml"
                    if source in parsed:
                        agent(source, node.ref)
        else:
            roots = [p for p in parsed if PurePosixPath(p).name == "root_agent.yaml"]
            if len(roots) != 1:
                raise ValueError("Bundle needs one root_agent.yaml or rca/workflow.yaml")
            root = agent(roots[0])
            # The RCA evidence-grounded output boundary is always retained.
            nodes.append(Node(id="rca_synthesizer", kind="builtin", ref="rca_synthesizer"))
            nodes.append(Node(id="root_rca_agent", kind="sequence", children=[root, "rca_synthesizer"]))
            result.definition = WorkflowDefinition(root="root_rca_agent", nodes=nodes)
        if result.definition:
            synth = [n for n in result.definition.nodes if n.kind == "builtin" and n.ref == "rca_synthesizer"]
            root = next(n for n in result.definition.nodes if n.id == result.definition.root)
            if len(synth) != 1 or root.kind != "sequence" or root.children[-1] != synth[0].id:
                raise ValueError("The root sequence must end with exactly one governed rca_synthesizer")
    except (ValueError, TypeError, KeyError, RecursionError) as exc:
        result.diagnostics.append(Diagnostic(path="rca/workflow.yaml" if "rca/workflow.yaml" in parsed else "root_agent.yaml", message=str(exc)[:1000]))
        result.definition = None
    return result


def enriched_graph(compilation, cap, profiles, editable=False):
    if not compilation.definition:
        return Graph()
    graph = Graph.model_validate(graph_view(compilation.definition))
    ids = {n.id for n in graph.nodes}
    for node in list(graph.nodes):
        node.source = compilation.sources.get(node.id, "rca/workflow.yaml")
        node.editable = editable
        definition = compilation.agents.get(node.ref) or compilation.overrides.get(node.ref)
        if definition:
            node.details = definition.model_dump(mode="json")
            relations = [("model", definition.model_profile), *(("tool", t) for t in definition.tools)]
            relations.extend(("skill", s) for s in cap.skills)
            for kind, ref in relations:
                key = kind + ":" + ref
                if key not in ids:
                    graph.nodes.append(GraphNode(id=key, kind=kind, label=ref, source="config/model_profiles.yaml" if kind == "model" else "capabilities/" + cap.id + ".yaml", details={"effective_value": ref}))
                    ids.add(key)
                graph.edges.append(GraphEdge(source=node.id, target=key, kind="dependency"))
                if kind == "tool":
                    connector = ref.split(".")[0]
                    cid = "connector:" + connector
                    if cid not in ids:
                        graph.nodes.append(GraphNode(id=cid, kind="connector", label=connector, details={"scope": "server-owned", "access": "read-only"}))
                        ids.add(cid)
                    graph.edges.append(GraphEdge(source=key, target=cid, kind="binding"))
    graph.nodes.append(GraphNode(id="governance", kind="policy", label="Run governance", details={"enforced": ["authenticated scope", "tool budgets", "redaction", "evidence citations", "UTC deadline"]}))
    graph.edges.append(GraphEdge(source=compilation.definition.root, target="governance", kind="dependency"))
    return graph


def canonical(bundle):
    return json.dumps(bundle.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


__all__ = ["Workspace", "BundleInput", "compile_bundle", "compatibility"]
