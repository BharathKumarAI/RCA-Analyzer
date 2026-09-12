# RCA Analyzer developer context

RCA Analyzer is a Python 3.11 FastAPI service using Google ADK, SQLAlchemy async persistence, local bounded file extraction, Jira/Splunk read connectors, OpenTelemetry, and MLflow.

The API authenticates before uploads and runs. RS256 issuer, audience, public key, and server-side subject membership come from `RCA_AUTH_ISSUER`, `RCA_AUTH_AUDIENCE`, `RCA_AUTH_PUBLIC_KEY`, and `RCA_PRINCIPALS_JSON`. Each deployment is scoped by `RCA_TENANT_ID` and `RCA_PROJECT_ID`; callers cannot self-assign identity fields.

The ADK workflow is a native Workflow graph: an incident branch runs Jira triage then bounded Splunk investigation, while attachment summarization runs independently; a join feeds approved specialist AgentTools and final synthesis. Stage model profiles are configured in [config/model_profiles.yaml](blob_local/platform/config/model_profiles.yaml), including model name, thinking level, and output limit.

Use `RCA_MODE=demo` for offline simulation and `RCA_MODE=live` only with real credentials. Writes, database connector access, remote file fetches, macros, and code execution are unsupported. See the [Gemini model](https://ai.google.dev/gemini-api/docs/models), [thinking](https://ai.google.dev/gemini-api/docs/thinking), and [ADK agents](https://google.github.io/adk-docs/agents/) references.

Approved project-specialist YAML is the supported exception to static topology: submit it at `/api/v1/agent-configurations`, review it with an expected content hash, and use it only after a same-scope administrator approves it. The router wraps approved definitions as ADK `AgentTool` instances; pending, rejected, and revoked definitions are invisible to runs. Storage is local by default and can use GCS via `RCA_CONFIG_BLOB_URI`.

## No mockup data