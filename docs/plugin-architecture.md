# Extension architecture

There is no independent runtime plugin registry. Native ADK workflows, declarative capabilities, approved specialist definitions and one implemented tool catalog are the extension boundaries.

| Extension | Location and enforcement |
|---|---|
| Platform workflow | [ADK graph factory](../app/agents/root.py), bounded by [run governance](../app/runtime/governance.py) |
| Project specialist | Data-only [definition schema](../app/configuration/models.py) and [approval service](../app/configuration/service.py); only approved definitions become `AgentTool` choices |
| Connector | [Provider registry](../app/connectors/providers/registry.py); network clients and credentials remain provider-owned |
| Tool | [Action catalog](../app/tools/catalog.py) and [domain tools](../app/tools/domain/); no writes or database tool are registered |
| Capability | [YAML manifests](../blob_local/platform/capabilities/) and [scoped resolution](../app/capabilities/resolver.py) |
| Configuration | [Platform/project/user layers](architecture.md#configuration-ownership-and-inheritance); delegated fields only |

Registration never grants permission. New connectors require reviewed provider code, typed domain tools and explicit capability permissions. Adding a YAML name cannot import executable code or add a network client. The [development ADK folder](../agents/rca_analyzer/agent.py) remains inert; live investigation assembly starts at the authenticated API.
