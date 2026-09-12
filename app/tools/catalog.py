"""One inventory of implemented, read-only ADK actions."""

from app.tools.domain.itsm import create_tools as itsm_tools
from app.tools.domain.logs import create_tools as log_tools
from app.tools.domain.evidence import create_tool

EVIDENCE_CONNECTORS = ("confluence", "signalfx", "qtest", "gitlab", "oracle", "kafka", "unix", "kubernetes")

TOOL_ACTIONS = {
    "get_ticket": "itsm.get_ticket",
    "query_range": "log_search.query_range",
}
TOOL_ACTIONS.update({f"read_{name}_evidence": f"{name}.read_evidence" for name in EVIDENCE_CONNECTORS})
ALLOWED_ACTIONS = frozenset(TOOL_ACTIONS.values())


def build_tools(connectors, allowed_actions):
    tools = {}
    for name, factory in (("itsm", itsm_tools), ("log_search", log_tools)):
        if name in connectors and any(
            action.startswith(name + ".") for action in allowed_actions
        ):
            tools.update(factory(connectors[name]))
    for name in EVIDENCE_CONNECTORS:
        if name in connectors and f"{name}.read_evidence" in allowed_actions:
            tools[f"read_{name}_evidence"] = create_tool(connectors[name])
    return {
        name: tool
        for name, tool in tools.items()
        if TOOL_ACTIONS[name] in allowed_actions
    }
