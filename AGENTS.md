# Agent guidance

## Architecture

Use Google ADK native `LlmAgent`, `Workflow`, `JoinNode`, `AgentTool`, `FunctionTool`, `Runner`, `Session`, and `Event` classes. Do not add LangChain. The request path is FastAPI -> authenticated settings/scope -> capability resolution -> SQLAlchemy run/session persistence -> ADK root workflow.

Keep network and credentials in [app/connectors/providers](app/connectors/providers); expose typed ADK tools under [app/tools/domain](app/tools/domain). Current live connectors are read-only Jira and Splunk. Database querying is disabled until its connector is implemented.

## Security and inputs

Verify RS256 JWT issuer, audience, signature, expiry, and server-side subject membership before file uploads or runs. A deployment has one configured tenant/project scope from `RCA_TENANT_ID` and `RCA_PROJECT_ID`. Never accept roles, tenant, project, or connector scope from a request body.

Attachments are local-only and bounded. Do not add remote URL fetching, macros, code execution, or image visual semantics; image support is OCR only. Use bounded parallel parsing and UTC request deadlines.

## Changes

Capabilities remain declarative YAML in [capabilities](blob_local/platform/capabilities). Stage model names and limits belong in [config/model_profiles.yaml](blob_local/platform/config/model_profiles.yaml). Persist runs and evidence through the async SQLAlchemy store. There is no durable background worker or recovery contract in this release.

Custom agent YAML is submitted through `/api/v1/agent-configurations`, validated against the data-only definition model, and stored by content hash in the local blob store or configured GCS bucket. Only a same-scope administrator other than the author can approve it; the orchestrator sees approved definitions only. Keep `instruction` data-only, allow only existing tool names, and preserve expected-hash review checks. Revoke active definitions when needed.

Run `make lint`, `make test`, and `make smoke` before handoff. `make eval` runs four offline fixture contracts through local MLflow checks; it is not a live model quality score. Retention cleanup is manual via `python -m scripts.cleanup`. Keep docs honest about demo versus live behavior and link to the source file implementing each claim.

Keep `__init__.py` files in active Python packages only. Documentation, YAML configuration and infrastructure directories are not Python packages. Do not create empty package trees for future features.

## Engineering standards & implementation rules

- **Zero Mockups**: Never use hardcoded mock data, dummy JSON fixtures, or synthetic delays. All features must be powered by real backend data and APIs.
- **Reuse & Extend First**: Before building new components or endpoints, inspect existing code and extend or compose existing capabilities.
- **Backend-First Streamlining**: If an endpoint or schema is missing, implement the real backend functionality first so that no mockup data exists anywhere.
- **Production-Grade Delivery**: Deliver complete, streamlined vertical slices with strong typing, robust error handling, and production-ready quality.
