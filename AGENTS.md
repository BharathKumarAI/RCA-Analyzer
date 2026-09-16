# Project engineering guidelines

Read the [documentation index](docs/README.md) for the five-guide documentation map and [development guidelines](docs/development.md) for contribution and verification standards. This file is the shared instruction source for Codex, Claude and Gemini. Historical references do not override it.

## Architecture

Use Google ADK native `LlmAgent`, `Workflow`, `JoinNode`, `AgentTool`, `FunctionTool`, `Runner`, `Session`, and `Event` classes. Do not add LangChain. The request path is FastAPI -> authenticated settings/scope -> capability resolution -> SQLAlchemy run/session persistence -> ADK root workflow.

Keep network and credentials in [app/connectors/providers](app/connectors/providers); expose typed ADK tools under [app/tools/domain](app/tools/domain). All implemented connectors are supported according to project enablement: Jira, Splunk, Confluence, SignalFx, qTest, GitLab, Oracle, Kafka, Unix/Tuxedo and Kubernetes. Resolve the saved project instance, selected environment, authorized resource, credential binding and capability actions before execution; do not impose a Jira/Splunk-only allowlist or enable unconfigured sources globally. Keep every operation read-only. Oracle is limited to fixed, bounded diagnostics; arbitrary or model-supplied SQL, Jira mutations and other source-system writes are unsupported. Jira uses Cloud REST v3, cursor pagination, budgeted ADF traversal and project-scoped JQL. The current Oracle policy guard and disabled baseline templates are implementation gaps to reconcile, not the desired connector policy; see [configuration](docs/configuration.md#all-connectors-enabled-per-project).

## Security and inputs

Verify RS256 JWT issuer, audience, signature, expiry, and server-side subject membership before file uploads or runs. A deployment has one configured tenant from `RCA_TENANT_ID` and supports multiple database-managed projects; `RCA_PROJECT_ID` identifies the bootstrap project. `X-RCA-Project` is a selector only: verify active membership and derive roles from the database on every request. Never accept roles, tenant, or connector authorization scope from a request body. Project creation accepts a new project key only through the authorized project API.

Attachments are local-only and bounded. Do not add remote URL fetching, macros, code execution, or image visual semantics; image support is OCR only. Use bounded parallel parsing and UTC request deadlines.

## Changes

All durable configurations (model profiles, capabilities, stage prompts, file limits, connector templates, and parameter definitions) are managed and resolved database-first via `platform.system_configurations` and `platform.parameter_definitions`. The 5-level deterministic scope precedence hierarchy (`project + instance + env` -> `project + instance` -> `project + env` -> `project-wide` -> `platform default`) uses explicit nullable foreign-key columns without invented fallback defaults. Persist runs and evidence through the async SQLAlchemy store. Interactive investigation runs do not automatically recover after process failure. The scoped improvement queue has a leased worker with bounded retries; it never automatically approves content.

Custom agent YAML is submitted through `/api/v1/agent-configurations`, validated against the data-only definition model, and stored by content hash in the local blob store or configured GCS bucket. Only a same-scope administrator other than the author can approve it; the orchestrator sees approved definitions only. Keep `instruction` data-only, allow only existing tool names, and preserve expected-hash review checks. Revoke active definitions when needed.

Run `make lint`, `make test`, and `make smoke` before handoff. `make eval` runs four offline fixture contracts through local MLflow checks; it is not a live model quality score. Retention cleanup is manual via `python -m scripts.cleanup`. Keep docs honest about demo versus live behavior and link to the source file implementing each claim.

Keep `__init__.py` files in active Python packages only. Documentation, YAML configuration and infrastructure directories are not Python packages. Do not create empty package trees for future features.

## Engineering standards & implementation rules

- **Zero Mockups**: Never use hardcoded mock data, dummy JSON fixtures, or synthetic delays. All features must be powered by real backend data and APIs.
- **Reuse & Extend First**: Before building new components or endpoints, inspect existing code and extend or compose existing capabilities.
- **Backend-First Streamlining**: If an endpoint or schema is missing, implement the real backend functionality first so that no mockup data exists anywhere.
- **Production-Grade Delivery**: Deliver complete, streamlined vertical slices with strong typing, robust error handling, and production-ready quality.

## Collaboration and documentation

Preserve unrelated working-tree edits. Trace affected callers before changing shared behavior; reuse existing components, APIs and stores. Keep changes focused and complete, without speculative abstractions or new dependencies where existing capabilities suffice.

Maintain the five primary guides in `docs/`: project, architecture, configuration, development and operations. Add source links for implementation claims. Distinguish desired policy, current implementation gaps, reference specifications and verified deployment behavior. Keep `CLAUDE.md` and `GEMINI.md` as entrypoints to these shared rules. Runtime skills and storage-layout READMEs remain alongside their assets.

For frontend changes, also run `npm run lint`, `npm test` and `npm run build` in `frontend/`. Report actual check results, failures and blockers; never claim old validation counts as current results. Existing isolated test fixtures are verification-only and must not become application fallback data.
