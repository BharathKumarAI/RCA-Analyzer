"""Data-only workflow compiler shared by execution and Harness Studio."""
from __future__ import annotations

from importlib.metadata import version
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    kind: Literal["builtin", "agent", "sequence", "parallel", "graph", "join"]
    ref: str | None = None
    children: list[str] = Field(default_factory=list, max_length=100)
    edges: list[tuple[str, str]] = Field(default_factory=list, max_length=200)


class WorkflowDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    root: str
    nodes: list[Node] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_graph(self):
        nodes = {n.id: n for n in self.nodes}
        if len(nodes) != len(self.nodes) or self.root not in nodes:
            raise ValueError("Workflow requires unique IDs and an existing root")
        seen, active = set(), set()

        def visit(key):
            if key not in nodes or key in active or key in seen:
                raise ValueError("Missing, cyclic, or multiply owned workflow node: " + key)
            active.add(key)
            node = nodes[key]
            container = node.kind in {"sequence", "parallel", "graph"}
            if container != bool(node.children):
                raise ValueError("Containers require children; leaves cannot own children")
            if node.kind in {"agent", "builtin"} and not node.ref:
                raise ValueError("Agent and builtin nodes require a reference")
            if node.kind != "graph" and node.edges:
                raise ValueError("Explicit edges belong to graph nodes")
            if node.kind == "graph":
                allowed = set(node.children)
                reachable = {"START"}
                pending = list(node.edges)
                if not pending or any(a not in allowed | {"START"} or b not in allowed for a, b in pending):
                    raise ValueError("Graph edges must reference direct children or START")
                # Kahn ordering detects cycles, including reachable cycles.
                done = {"START"}
                while allowed - done:
                    ready = {b for b in allowed - done if any(y == b for _, y in pending)
                             and all(a in done for a, y in pending if y == b)}
                    if not ready:
                        raise ValueError("Graph is cyclic or has unreachable children")
                    done.update(ready)
                while True:
                    expanded = reachable | {b for a, b in pending if a in reachable}
                    if expanded == reachable:
                        break
                    reachable = expanded
                if not allowed <= reachable:
                    raise ValueError("Graph has unreachable children")
            for child in node.children:
                visit(child)
            active.remove(key)
            seen.add(key)
        visit(self.root)
        if seen != set(nodes):
            raise ValueError("Workflow contains unreferenced nodes")
        return self


def default_workflow(available, parallel=True):
    """Compose the existing RCA stages without inventing additional agents."""
    nodes = [Node(id=name, kind="builtin", ref=name) for name in available]
    incident = [n for n in ("triage_agent", "logs_investigator") if n in available]
    branches = [n for n in ("connector_evidence_investigator",) if n in available]
    if incident:
        nodes.append(Node(id="incident_evidence", kind="sequence", children=incident))
        branches.append("incident_evidence")
    if "file_investigator" in available:
        branches.append("file_investigator")
    steps = [n for n in ("request_orchestrator",) if n in available]
    if branches:
        nodes.append(Node(id="evidence_acquisition", kind="parallel" if parallel and len(branches) > 1 else "sequence", children=branches))
        steps.append("evidence_acquisition")
    steps.extend(n for n in ("specialist_router", "rca_synthesizer") if n in available)
    nodes.append(Node(id="root_rca_agent", kind="sequence", children=steps))
    return WorkflowDefinition(root="root_rca_agent", nodes=nodes)


def compile_native(definition, agents, concurrency):
    from google.adk.workflow import Workflow, JoinNode, START
    nodes = {n.id: n for n in definition.nodes}

    def build(key):
        node = nodes[key]
        if node.kind in {"builtin", "agent"}:
            agent = agents[node.ref]
            if agent.name != key:
                agent = agent.model_copy(update={"name": key})
            return agent
        if node.kind == "join":
            return JoinNode(name=key)
        children = {child: build(child) for child in node.children}
        values = list(children.values())
        if node.kind == "parallel":
            join = JoinNode(name=key + "_join")
            edges = [(START, v) for v in values] + [(v, join) for v in values]
        elif node.kind == "graph":
            edges = [(START if a == "START" else children[a], children[b]) for a, b in node.edges]
        else:
            edges = list(zip([START, *values[:-1]], values))
        return Workflow(name=key, edges=edges, max_concurrency=concurrency)
    return build(definition.root)


def graph_view(definition):
    nodes, edges = [], []
    by_id = {n.id: n for n in definition.nodes}

    def walk(key, parent=None):
        node = by_id[key]
        nodes.append({"id": key, "kind": node.kind, "label": key.replace("_", " "), "parent": parent, "ref": node.ref})
        for child in node.children:
            walk(child, key)
        if node.kind == "sequence":
            edges.extend({"source": a, "target": b, "kind": "execution"} for a, b in zip(node.children, node.children[1:]))
        elif node.kind == "parallel":
            join = key + "_join"
            nodes.append({"id": join, "kind": "join", "label": "Join", "parent": key})
            edges.extend({"source": child, "target": join, "kind": "execution"} for child in node.children)
        elif node.kind == "graph":
            edges.extend({"source": key if a == "START" else a, "target": b, "kind": "execution"} for a, b in node.edges)
    walk(definition.root)
    return {"nodes": nodes, "edges": edges}


def compatibility():
    return {"adk_version": version("google-adk"), "schema_version": 1,
            "supported": ["LlmAgent", "SequentialAgent", "ParallelAgent", "Workflow", "JoinNode", "AgentTool", "FunctionTool"],
            "limitations": ["Uploaded code is never executed", "Models require an authorized profile", "Unresolved features block activation"]}


def available_builtins(capability, stages, options, actions, attachments=False, specialists=False):
    """The same eligibility rules used for assembly and configuration preview."""
    names = ["rca_synthesizer"]
    enabled = set(capability.agent_stages)
    if options.planning and stages["triage"].enabled:
        names.append("request_orchestrator")
    if "triage" in enabled and "itsm.get_ticket" in actions and stages["triage"].enabled:
        names.append("triage_agent")
    if "logs" in enabled and "log_search.query_range" in actions and stages["logs"].enabled:
        names.append("logs_investigator")
    if "evidence" in enabled and any(a.split('.')[0] not in {"itsm", "log_search"} for a in actions) and stages["logs"].enabled:
        names.append("connector_evidence_investigator")
    if "file" in enabled and options.attachments and attachments and stages["extraction"].enabled:
        names.append("file_investigator")
    if options.specialists and specialists and stages["triage"].enabled:
        names.append("specialist_router")
    return names


def prune_optional(definition, unavailable):
    """Drop optional attachment leaves and empty containers without rewiring custom DAGs."""
    if not unavailable:
        return definition
    nodes = {n.id: n.model_copy(deep=True) for n in definition.nodes}
    removed = {n.id for n in nodes.values() if n.kind == "builtin" and n.ref in unavailable}
    while True:
        empty = {n.id for n in nodes.values() if n.children and set(n.children) <= removed}
        if empty <= removed:
            break
        removed |= empty
    for node in nodes.values():
        if node.kind == "graph" and set(node.children) & removed:
            raise PermissionError("Custom graph requires an attachment for this run")
        node.children = [c for c in node.children if c not in removed]
    return WorkflowDefinition(root=definition.root, nodes=[n for n in nodes.values() if n.id not in removed])


def enrich_runtime_graph(graph, agents):
    """Only inspect registered native components; no provider calls or code loading."""
    from google.adk.tools import AgentTool
    ids = {n["id"] for n in graph["nodes"]}
    def add(id, kind, label, parent=None, details=None):
        if id not in ids:
            graph['nodes'].append({"id": id, "kind": kind, "label": label, "parent": parent,
                "details": details or {}, "enabled": True, "editable": False})
            ids.add(id)
    def inspect(agent, owner):
        model = getattr(agent, 'model', None)
        if model is not None:
            key = 'model:' + str(getattr(model, 'model', model))
            add(key, 'model', str(getattr(model, 'model', model)))
            graph['edges'].append({"source": owner, "target": key, "kind": "dependency"})
        for tool in getattr(agent, 'tools', ()):
            if isinstance(tool, AgentTool):
                child = tool.agent
                add(child.name, 'agent', child.name, owner)
                graph['edges'].append({"source": owner, "target": child.name, "kind": "delegation"})
                inspect(child, child.name)
            else:
                name = getattr(tool, 'name', None)
                if name:
                    key = 'tool:' + name
                    add(key, 'tool', name)
                    graph['edges'].append({"source": owner, "target": key, "kind": "dependency"})
    for node in list(graph['nodes']):
        agent = agents.get(node.get('ref') or node['id'])
        if agent is not None:
            inspect(agent, node['id'])
