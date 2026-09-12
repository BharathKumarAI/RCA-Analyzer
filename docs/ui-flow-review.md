# UI flow review

Three parallel reviewers traced investigation/session flows, project configuration, and governance/catalog management. Changes preserve the deployment security and release boundaries in [AGENTS.md](../AGENTS.md).

## Completed fixes

| Flow | Result | Implementation / verification |
| --- | --- | --- |
| Session | Removed embedded demo credential, kept tokens in memory, discarded legacy browser storage, cleared stale form state. | [SessionModal](../frontend/src/components/SessionModal.tsx), [API client](../frontend/src/services/api.ts), [API regression](../tests/frontend_api.mjs) |
| Workspace | A forbidden section no longer prevents permitted run and health data from loading; expired authentication clears the session. | [App](../frontend/src/App.tsx), [partial loading regression](../tests/frontend_workspace_loading.mjs) |
| Navigation | Search shortcut works, all pages are searchable, results are keyboard buttons, breadcrumbs identify every page. Pages load on demand. | [App](../frontend/src/App.tsx), [CommandPalette](../frontend/src/components/CommandPalette.tsx), [Topbar](../frontend/src/components/Topbar.tsx) |
| Investigations | Selected capability carries into the form; local file checks/removal and readable errors improve submission; polling recovers from temporary errors. | [form](../frontend/src/components/NewInvestigationModal.tsx), [Runs](../frontend/src/pages/Runs.tsx), [polling regression](../tests/frontend_run_polling.mjs) |
| Project Setup | Saves preserve governed fields and multiline content; empty environment lists and inherited skill instructions round-trip correctly. Unsupported display metadata is explicit. | [ProjectSetup](../frontend/src/pages/ProjectSetup.tsx), [round-trip regression](../tests/frontend_project_setup_roundtrip.mjs) |
| Parameters / diagnostics | Blank numeric inputs remain editable, fractional integers are rejected, probe refreshes do not overlap, failures are visible. | [ParameterStudio](../frontend/src/pages/ParameterStudio.tsx), [numeric regression](../tests/frontend_parameter_values.mjs), [HealthChecks](../frontend/src/pages/HealthChecks.tsx), [Settings](../frontend/src/pages/Settings.tsx) |
| Harness / agents | Selection keys and exclusions round-trip, server permissions control editing, governance links open the exact candidate, action errors remain visible. | [HarnessLibrary](../frontend/src/pages/HarnessLibrary.tsx), [selection regression](../tests/frontend_harness_selection.mjs), [Agents](../frontend/src/pages/Agents.tsx), [Governance](../frontend/src/pages/Governance.tsx) |
| Evaluation | Dataset registration is available from the UI and selects the registered version; offline checks are described accurately. | [Optimization](../frontend/src/pages/Optimization.tsx), [registration regression](../tests/frontend_optimization_dataset.mjs), [Skills](../frontend/src/pages/Skills.tsx) |

## Verification and limits

Final backend checks: make lint, make test (165 passed, 2 skipped, 2 subtests passed), and make smoke (8 passed). Frontend build, lint, and npm test (9 regression scripts) passed. Frontend lint still reports warnings. Initial JavaScript entry bundle fell from approximately 653 KB to 278 KB by loading pages on demand; this measures built asset size, not browser latency.

After explicit approval on September 12, 2026, the local demo administrator session was verified in the browser. All 21 navigation pages were opened. Checked keyboard search; selected-capability handoff; a simulated investigation and its saved result; exact governance candidate navigation and disabled self-approval; dataset validation, registration, and persistence across reload; and project validation, save, refresh, and revalidation. Refresh cleared the in-memory session as designed. This is targeted browser verification, not exhaustive coverage of every control, role, or responsive size. No live model or external provider certification is claimed.

The application is not 100% UI-managed: identity/membership, role policy, deployment secrets and runtime settings remain deployment-managed. Retention cleanup remains manual. Database evidence querying is disabled; live evidence providers remain read-only Jira and Splunk. Knowledge is retained attachment metadata rather than a full RAG administration surface, and unavailable billing/quality telemetry is not fabricated. See [editability inventory](admin-editability-audit.md), [identity policy](../app/identity/principals.py), [cleanup](../scripts/cleanup.py), and [provider registry](../app/connectors/providers/registry.py).

## Browser-discovered fixes on September 12

- [Project Setup serialization](../frontend/src/utils/projectSetupConfig.ts) respects the database-loaded deployment section allowlist. Older policies no longer receive an invented empty environments section; unavailable environment controls explain the restriction.
- [Agent review controls](../frontend/src/pages/Agents.tsx) require a different authorized administrator, loaded hash, and nonblank rationale; [eligibility regression](../tests/frontend_agent_review.mjs) covers these gates.
- [Page recovery](../frontend/src/App.tsx) presents a reload action when an outdated or unavailable page bundle fails, with a [regression](../tests/frontend_page_recovery.mjs).
- [Migration 005](../migrations/005_configuration_save_privileges.sql) was applied to the local demo PostgreSQL database. It grants insertion of configuration snapshots and updates only to the active content_hash pointer. Existing snapshots remain immutable; scope changes and pointer deletion remain denied. [Deployment grants](../scripts/deploy_database.py) now preserve the same restrictions. The [restricted-role PostgreSQL regression](../tests/integration/test_configuration_save_privileges.py) passed in a separate disposable database.

Browser verification added a simulated log-correlation investigation (`run_3fa000559b1b44b4877e9330e19b7d9b`) and a synthetic example dataset (`ui_verification_20260912`, version `1.0.0`) to the local demo. The existing project form was saved without changing form inputs. No agents were approved, rejected, or revoked, and no live diagnosis was run.
