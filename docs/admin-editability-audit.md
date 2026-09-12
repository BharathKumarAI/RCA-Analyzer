# Admin editability and persistence audit

Reviewed all 20 React admin pages with three Luna agents, traced their API writes, and opened every page in the local demo browser. Browser navigation checks do not prove production persistence; automated API restart tests cover the saved data paths separately.

| Page | Supported changes and persistence |
| --- | --- |
| Overview | Read-only run, agent, and health summary. |
| Investigations | Create and cancel runs; persisted run records and evidence. |
| Capabilities | Read-only declarative catalog; project overrides belong in Project Setup. |
| Runtime & ADK | Read-only deployment runtime configuration. |
| Harness Library | Shared specialist templates and data-only plugin catalog editing; inherited project resource selection and reset with revision checks. See [library contract](platform-library.md). |
| Skills Catalog | Edit or reset delegated project instructions; project configuration persistence. Immutable skills remain read-only. |
| Parameter Studio | Edit platform definitions and permitted project overrides; revision-checked SQL persistence. |
| Optimization & MLflow | Create evaluations and review results; persisted optimization records and reports. Requires registered datasets. |
| Agents Fleet | Submit a new YAML revision, approve/reject, or revoke. Submitted definitions are immutable; approval requires a different authorized reviewer. |
| Tools & Connectors | Edit registered MCP/A2A definitions and permitted project overrides; revision-checked SQL persistence. Native deployment connector definitions remain read-only here. |
| Health Checks | Read-only observations and reprobes. |
| Alerts | Read-only derived health, run, and governance events. |
| Project Setup | Edit delegated workflow, limits, prompts, preferences, environments, skills, and capability overrides. Deployment identity and unsupported display metadata are read-only. |
| Persistence & Storage | Read-only deployment storage, limits, and retention information. |
| Policy & Guardrails | Read-only policy plus a local, non-persisted redaction sandbox. |
| Roles & RBAC | Read-only server-owned role definitions. |
| Governance & Audit | Read-only audit records with navigation to agent review. |
| Knowledge & RAG | Read-only retained attachment metadata. |
| Users & IAM | Read-only deployment memberships. |
| Token Usage & Cost | Unavailable telemetry is explicitly indicated; no billing editing API. |
| System Settings | Read-only deployment diagnostics and connection tests. |

Sources: [page components](../frontend/src/pages), [frontend API adapter](../frontend/src/services/api.ts), [catalog and project routes](../app/api/routes/catalog.py), [parameter routes](../app/api/routes/parameters.py), [integration routes](../app/api/routes/integrations.py), [agent routes](../app/api/routes/agents.py), [run routes](../app/api/routes/runs.py), and [optimization routes](../app/api/routes/optimization.py).

Persistence checks include [parameter zero-save and reset across restarts](../tests/integration/test_admin_parameter_persistence.py), [project and skill edits across database-configured application restarts](../tests/integration/test_catalog_db_persistence.py), [integration CRUD and restart contracts](../tests/integration/test_integrations_api.py), [numeric frontend parsing](../tests/frontend_parameter_values.mjs), and [project configuration round trips](../tests/frontend_project_setup_roundtrip.mjs). Local demo connector health was degraded/planned; browser checks did not exercise live provider calls.

Fixed misleading agent editing controls, numeric zero handling, missing context-limit editing, unsupported editable project metadata, configuration fields lost during form saves, and temporary-only project/skill writes under database configuration. Project Setup now preserves existing fields and hydrates the returned saved configuration; skill instruction edits preserve enabled state and action restrictions.

Final verification: `make lint`, `make test` (157 passed, 1 skipped, 2 subtests passed), `make smoke` (8 passed), frontend build, frontend lint, and all three frontend contract scripts passed. Existing frontend lint and bundle-size warnings remain. Restart tests use isolated SQLite fixtures; they are not a production database certification. Database bundle updates commit before local materialization is refreshed; a filesystem failure at that point can leave the running cache stale until restart, although the database change remains durable.
