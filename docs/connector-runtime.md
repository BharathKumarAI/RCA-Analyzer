# Configuring connectors and attaching them to agents

All ten connectors have native read-only providers and can alternatively use an explicitly configured MCP binding. They are registered in the [provider inventory](../app/connectors/providers/registry.py); [typed tools](../app/tools/catalog.py), [governance](../app/runtime/governance.py), and [ADK assembly](../app/agents/root.py) share the same action names. New connectors are disabled in the shipped configuration until deployment settings are supplied. Implementation does not imply a successful connection to your environment.

## Native connections

Set `enabled: true` and `transport: native` for the connector in the active [connectors.yaml](../blob_local/platform/config/connectors.yaml). Endpoints, credentials, and external resource scopes below are environment variables owned by the deployment. Request bodies and agent instructions cannot change them. In a database-backed deployment, update the active [configuration bundle](../app/configuration/database_bundle.py) and restart the API.

| Connector | Required environment variables | Implemented evidence |
| --- | --- | --- |
| Jira (`itsm`) | `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | Project-scoped ticket lookup |
| Splunk (`log_search`) | `SPLUNK_HOST`, `SPLUNK_TOKEN`, `SPLUNK_INDEX` | Bounded literal log searches |
| Confluence | `CONFLUENCE_ENDPOINT` (ending `/wiki`), `CONFLUENCE_TOKEN` (Bearer), `CONFLUENCE_SCOPE` (numeric space ID) | First page of current pages, including storage text |
| SignalFx | `SIGNALFX_ENDPOINT` (API realm origin), `SIGNALFX_TOKEN`, `SIGNALFX_SCOPE` (detector ID) | Detector definition and rules; not metric samples or alert history |
| qTest | `QTEST_ENDPOINT` (ending `/api/v3`), `QTEST_TOKEN`, `QTEST_SCOPE` (project ID) | Root-level test runs; not recursive suite traversal |
| GitLab | `GITLAB_ENDPOINT` (ending `/api/v4`), `GITLAB_TOKEN`, `GITLAB_SCOPE` (numeric project ID) | Recent deployment records |
| Kubernetes | `KUBERNETES_ENDPOINT` (API origin), `KUBERNETES_TOKEN`, `KUBERNETES_SCOPE` (namespace) | Pod status, without pod specs or secrets |
| Oracle | `ORACLE_DSN`, `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_SCOPE` (database username to inspect) | Current `v$session` wait/blocking snapshot |
| Kafka | `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_SCOPE` (topic) | Partition metadata, not messages or consumer lag |
| Unix/Tuxedo | `UNIX_HOST`, `UNIX_USER`, `UNIX_CLIENT_KEY` (key file), `UNIX_KNOWN_HOSTS` (host-key file), `UNIX_LOG_PATH` (absolute remote log path) | Bounded tail of one file over SFTP; no shell execution |

The [REST providers](../app/connectors/providers/evidence.py) verify TLS, disable redirects/proxy inheritance, bound response bytes and elapsed time, and report possible truncation. An optional `<CONNECTOR>_CA_FILE` supplies a private CA certificate. Oracle uses [fixed, bound SQL](../app/connectors/providers/oracle.py) in a read-only transaction; grant the account only the required session-view access. Arbitrary database queries remain disabled. [Kafka](../app/connectors/providers/infrastructure.py) uses SASL_SSL with SCRAM-SHA-512 and optional `KAFKA_CA_FILE`; it does not create a consumer group or commit offsets. Unix uses AsyncSSH with mandatory host-key verification; optional `UNIX_PORT` defaults to 22. Neither provider accepts model-authored commands or paths.

## MCP as an alternative for any connector

Set `transport: mcp` for the existing connector ID. MCP uses HTTPS Streamable HTTP, including JSON and SSE responses, with a bounded request/session lifetime. It does not launch local processes. Supply `<ID>_ENDPOINT`, `<ID>_TOKEN`, `<ID>_SCOPE`, and optionally `<ID>_CA_FILE`; Jira uses the prefix `ITSM`, and Splunk uses `LOG_SEARCH`. These MCP settings are separate from the native API settings.

Add `mcp_tools` to that connector's configuration. The mapping key is `get_ticket` for Jira, `query_range` for Splunk, and `read_evidence` for every other connector. Each binding contains:

- `name`: the actual tool name advertised by your MCP server.
- `scope_argument`: the remote argument that receives the deployment scope, always imposed by the provider.
- `arguments`: fixed, deployment-approved arguments, including any remote result or time limits.
- `argument_map`: optional renaming of agent inputs to the remote schema. Jira supplies `ticket_id`; Splunk supplies `query`, `start_time`, and `end_time`.

These are real server contract values, not universal MCP tool names. The remote operation must be narrowly read-only and accept the imposed scope. A broad shell, arbitrary SQL, arbitrary URL, or unrestricted search tool is unsuitable. If the server does not expose a scoped operation, implement that server-side operation before binding it. Tools must advertise `readOnlyHint: true` and no destructive hint, but deployment approval of the actual operation is still required. Annotations alone do not authorize execution.

The [MCP provider](../app/connectors/providers/mcp_evidence.py) initializes a session, discovers the configured tool, checks its input schema, applies fixed scope, calls only that operation, accepts text/structured evidence, and closes the session. Remote schema references and media/resource content are rejected. Currently the bound tool must appear on the first discovery page. Connection health checks validate discovery; each actual call validates arguments and execution separately. Saved generic MCP/A2A registrations remain connection-test records and do not automatically grant agent access.

## Agent binding

Each new connector has a corresponding enabled `<connector>_review` [capability](../blob_local/platform/capabilities) and `<connector>-review` [skill](../blob_local/platform/skills). Required-connector preflight blocks execution when the connector is disabled, unconfigured, or unhealthy. The evidence source stage attaches the permitted tool automatically. Changing native/MCP transport preserves the capability action name.

To add a project specialist, submit a data-only definition through `/api/v1/agent-configurations`, using the capability ID and its exact tool action. For example, a GitLab specialist uses `capability: gitlab_review`, `tools: [gitlab.read_evidence]`, and an existing model profile/stage. The [approval service](../app/configuration/service.py) requires a different same-scope administrator to approve the expected content hash before discovery. Do not put credentials, endpoints, or external scope into its instruction.

Native Jira/Splunk actions remain `itsm.get_ticket` and `log_search.query_range`. Other connectors use `<connector>.read_evidence`. A combined platform capability can declare several required/optional connectors, the matching skills and allowed actions, and `agent_stages: [evidence]` (plus `triage`/`logs` when using Jira/Splunk). Platform loading rejects actions whose connector is undeclared. Project overrides may reduce platform permissions, never expand them.

## Validation and API references

[Transport integration checks](../tests/integration/test_connector_transports.py) exercise real local TLS MCP servers (JSON and SSE) and an authenticated AsyncSSH/SFTP server reading repository files. [Inventory checks](../tests/unit/test_connector_inventory.py) cover the capability/skill/action contract and missing credentials. Live Jira, Confluence, Splunk, SignalFx, qTest, GitLab, Oracle, Kafka and Kubernetes service access still requires deployment-specific acceptance testing.

Implementations follow [Confluence v2](https://developer.atlassian.com/cloud/confluence/rest/v2/), [GitLab deployments](https://docs.gitlab.com/api/deployments/), [qTest test runs](https://docs.tricentis.com/qtest-latest/content/apis/apis/test_run_apis.htm), [SignalFx retrieval](https://dev.splunk.com/observability/docs/apibasics/retrieve_data_basics), [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts), [python-oracledb](https://python-oracledb.readthedocs.io/en/latest/api_manual/async_connection.html), [aiokafka](https://aiokafka.readthedocs.io/en/latest/api.html), and [AsyncSSH](https://asyncssh.readthedocs.io/en/latest/api.html).

## Add a connection from a command or JSON

**Tools & Connectors → Add integration** keeps the existing connection form and adds **Paste command** and **Import JSON**. Both import paths validate on the server, then let you choose a connection and review its editable fields before using the existing save operation. Multiple `mcpServers` entries can be reviewed; save each connection separately. Import alone neither persists nor executes anything.

Accepted JSON is either a Claude/Cursor-style `mcpServers` object or one server object. Remote servers use `url`, optional `type` (`http`, `streamable-http`, `streamable_http`, or `sse`), and an optional Authorization bearer reference. Command servers use `command`, an `args` array, and an optional `env` object; `type: stdio` is inferred from `command`. A URL ending in `/sse` defaults to SSE when its type is omitted. Other URLs default to Streamable HTTP. Optional `name`, `description`, and `timeout` (seconds) are supported. Unsupported fields are rejected rather than silently ignored.

Environment values and bearer headers accept `${TOKEN_NAME}`, `${env:TOKEN_NAME}`, or `env://TOKEN_NAME`, converted to server-side environment references. Raw secret values are rejected. Other custom headers, OAuth client configuration, and variable substitution in URLs are not supported by this importer. Paste command supports quoted arguments, using shell-like tokenization without shell execution; pipes, redirects, assignments and shell expansion are not interpreted. Put credentials in environment references rather than command arguments.

Saved command registrations use **Command (stdio)** and can be tested through **Test saved connection**. Commands run on the API host, not in the browser. Deployment-owned `RCA_MCP_STDIO_ALLOWLIST` must contain an exact profile before any process is launched: a JSON array of objects, each with `command` (executable), `args` (ordered string array), and `env` (map of variable names to `env://` references, or `{}`). The saved executable, complete arguments and environment references must match a profile. Nothing is allowlisted by default. Install the server and its dependencies on the API host before testing; prefer pinned versions and absolute executable paths in approved profiles.

The [process probe](../app/connectors/providers/stdio_probe.py) launches without a shell, inherits only basic process-path/temp settings, resolves approved references, bounds initialization time and response bytes, suppresses child stderr, and terminates the process group after testing on POSIX. It initializes MCP only; it does not call the server's tools. Connection registration and testing still do not grant automatic agent access. These stdio registrations are separate from the native/remote-MCP runtime bindings described above.

Implementation: [JSON/command parser](../app/configuration/mcp_import.py), [preview API](../app/api/routes/integrations.py), [registration schema and store](../app/configuration/integrations.py), and [connection form](../frontend/src/components/IntegrationForm.tsx). [Integration checks](../tests/integration/test_mcp_import.py) cover parsing, secret-reference handling, persistence, role enforcement and a real MCP subprocess handshake. Format references: [Claude Code MCP](https://code.claude.com/docs/en/mcp) and [Cursor MCP](https://prod.cursor.com/help/customization/mcp).


### Project availability controls

Project owners and platform administrators can enable or disable native connector
use in Tools and capabilities in Capabilities. These switches persist the existing
project YAML policy through the [catalog API](../app/api/routes/catalog.py).
The project setting is separate from deployment configuration and connection health;
enabling it does not provision credentials or activate an arbitrary MCP registration.
The [capability resolver](../app/configuration/layers.py) removes disabled connector
actions and blocks capabilities with disabled required connectors. Changes apply to
subsequent resolution/preflight; they do not cancel already-running investigations.
