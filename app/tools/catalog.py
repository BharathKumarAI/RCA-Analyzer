"""One inventory of implemented, read-only ADK actions."""

from app.tools.domain.itsm import create_tools as itsm_tools
from app.tools.domain.logs import create_tools as log_tools

TOOL_ACTIONS = {
    "get_ticket": "itsm.get_ticket",
    "query_range": "log_search.query_range",
}
ALLOWED_ACTIONS = frozenset(TOOL_ACTIONS.values())


def build_tools(connectors, allowed_actions):
    tools = {}
    for name, factory in (("itsm", itsm_tools), ("log_search", log_tools)):
        if name in connectors and any(
            action.startswith(name + ".") for action in allowed_actions
        ):
            tools.update(factory(connectors[name]))
    return {
        name: tool
        for name, tool in tools.items()
        if TOOL_ACTIONS[name] in allowed_actions
    }
