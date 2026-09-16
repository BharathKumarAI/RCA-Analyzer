# Historical reviews

This consolidated reference preserves earlier contracts, proposals and dated observations. It is not a statement that every feature is implemented or deployed. Use the [five current guides](../../README.md) for current workflows and [AGENTS.md](../../AGENTS.md) for engineering policy. Earlier connector restrictions do not override project enablement policy.

## Contents
- [admin editability audit](#admin-editability-audit)
- [codebase review 2026 09 11](#codebase-review-2026-09-11)
- [production readiness 2026 09 11](#production-readiness-2026-09-11)
- [implementation review](#implementation-review)
- [ui flow review](#ui-flow-review)
- [validation 2026 09 15](#validation-2026-09-15)
- [readme previous](#readme-previous)
- [gemini previous](#gemini-previous)

---

<a id="admin-editability-audit"></a>

<a id="admin-editability-audit--admin-editability-and-persistence-audit"></a>
## Admin editability and persistence audit

Reviewed all 20 React admin pages with three Luna agents, traced their API writes, and opened every page in the local demo browser. Browser navigation checks do not prove production persistence; automated API restart tests cover the saved data paths separately.

| Page | Supported changes and persistence |
| --- | --- |
| Overview | Read-only run, agent, and health summary. |
| Investigations | Create and cancel runs; persisted run records and evidence. |
| Capabilities | Read-only declarative catalog; project overrides belong in Project Setup. |
| Runtime & ADK | Read-only deployment runtime configuration. |
| Harness Library | Shared specialist templates and data-only plugin catalog editing; inherited project resource selection and reset with revision checks. See [library contract](configuration-and-review-contracts.md#platform-library). |
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

Sources: [page components](../../frontend/src/pages), [frontend API adapter](../../frontend/src/services/api.ts), [catalog and project routes](../../app/api/routes/catalog.py), [parameter routes](../../app/api/routes/parameters.py), [integration routes](../../app/api/routes/integrations.py), [agent routes](../../app/api/routes/agents.py), [run routes](../../app/api/routes/runs.py), and [optimization routes](../../app/api/routes/optimization.py).

Persistence checks include [parameter zero-save and reset across restarts](../../tests/integration/test_admin_parameter_persistence.py), [project and skill edits across database-configured application restarts](../../tests/integration/test_catalog_db_persistence.py), [integration CRUD and restart contracts](../../tests/integration/test_integrations_api.py), [numeric frontend parsing](../../tests/frontend_parameter_values.mjs), and [project configuration round trips](../../tests/frontend_project_setup_roundtrip.mjs). Local demo connector health was degraded/planned; browser checks did not exercise live provider calls.

Fixed misleading agent editing controls, numeric zero handling, missing context-limit editing, unsupported editable project metadata, configuration fields lost during form saves, and temporary-only project/skill writes under database configuration. Project Setup now preserves existing fields and hydrates the returned saved configuration; skill instruction edits preserve enabled state and action restrictions.

Final verification: `make lint`, `make test` (157 passed, 1 skipped, 2 subtests passed), `make smoke` (8 passed), frontend build, frontend lint, and all three frontend contract scripts passed. Existing frontend lint and bundle-size warnings remain. Restart tests use isolated SQLite fixtures; they are not a production database certification. Database bundle updates commit before local materialization is refreshed; a filesystem failure at that point can leave the running cache stale until restart, although the database change remains durable.

---

<a id="codebase-review-2026-09-11"></a>

<a id="codebase-review-2026-09-11--rca-assist-historical-codebase-review--11-september-2026"></a>
## RCA assist historical codebase review — 11 September 2026

> Historical pre-implementation review. Its findings and line links describe the original prototype, not the current runtime contract. See the [harness guide](runtime-and-extension-contracts.md#harness), [architecture reference](runtime-and-extension-contracts.md#architecture), and current source/tests for maintained behavior.

The repository is an architectural prototype, not a production investigation service. Its native ADK orchestration and connector/tool separation are useful foundations. However, the public API currently returns invented investigation findings, identity is supplied by the caller, and most documented governance is not enforced. Updating packages alone will not resolve these problems.

Scope: application code, manifests, skills, configuration, tests, container/developer entrypoints, and relevant official upstream examples/documentation. Local checks used the existing environment and mock providers; no live model, external connector, deployment, or database operation was invoked. Application code was not modified. Frontend implementation is deferred.

<a id="codebase-review-2026-09-11--package-baseline"></a>
### Package baseline

| Package | Declared minimum / locked / installed | Latest release verified | Recommendation |
|---|---|---|---|
| Google ADK | 2.9.0 | 2.9.0, September 10, 2026 | Keep the verified release; exercise its real Runner and session/event APIs. |
| MLflow | 3.16.0 | 3.16.0, September 4, 2026 | Connect tracing and evaluation; installing it does not activate either. |
| HTTPX2 | 2.12.0 | 2.12.0, August 18, 2026 | Use it inside real connector providers with pooled async clients. |

Release sources: [Google ADK](https://pypi.org/project/google-adk/2.9.0/), [MLflow](https://pypi.org/project/mlflow/), [HTTPX2](https://pypi.org/project/httpx2/). Search indexing initially lagged the ADK release; the explicit 2.9.0 release page and local installation agree.

The environment also contains `httpx==0.28.1`, required transitively. HTTPX2 is a separate package, not simply the HTTP/2 switch for HTTPX. Both can coexist, but their client/transport/response objects are not interchangeable. Keep SDK-owned HTTPX clients intact. HTTP/2 requires the HTTPX2 extra and explicit enablement, and should be enabled for a measured need. [Migration guidance](https://pydantic.dev/docs/httpx2/get-started/migration/), [HTTP/2 guidance](https://pydantic.dev/docs/httpx2/guides/http2/).

<a id="codebase-review-2026-09-11--prioritized-findings"></a>
### Prioritized findings

P0 means a release blocker. P1 means a high-priority correctness or production gap. Some defects are currently masked by simulated execution; these are identified explicitly.

<a id="codebase-review-2026-09-11--1-p0--the-api-returns-fabricated-success"></a>
#### 1. P0 — The API returns fabricated success

[the earlier runner implementation](../../app/runtime/runner.py) never called `run_async`. This finding describes the original prototype; the current execution path is documented in the [harness guide](runtime-and-extension-contracts.md#harness).

Verified: a request about an unrelated DNS incident returned `SUCCEEDED` with the CheckoutService database diagnosis.

Correction: make demo mode explicit and visibly label synthetic results. The production path must create/load an authorized session, invoke ADK, consume events, capture errors, and return validated output from the actual run. Missing credentials or evidence must produce an unavailable/failed/insufficient-evidence outcome, never an invented successful diagnosis.

<a id="codebase-review-2026-09-11--2-p0--callers-grant-themselves-permissions"></a>
#### 2. P0 — Callers grant themselves permissions

[the original API boundary] accepted identity, roles, tenant, and project from request JSON. The current boundary is [app/api/application.py](../../app/api/application.py) and derives identity from verified authentication and server membership.

Verified using the in-process API client: `PROJECT_VIEWER` returned 403; changing only the self-declared role to `PLATFORM_ADMIN` returned 200. No authentication header was supplied.

Correction: authenticate at the gateway, derive a server-owned principal from verified identity and membership, and authorize the requested project separately. Scope capability and connector-health listings too; keep public liveness minimal.

<a id="codebase-review-2026-09-11--3-p0--policy-redaction-and-write-interception-are-disconnected"></a>
#### 3. P0 — Policy, redaction, and write interception are disconnected

[the original runner and tool boundary] did not enforce policy or redaction. The current read-only implementation is documented in [governance](../../app/runtime/governance.py) and [typed tools](../../app/tools/domain).

Current exposure is limited by mock providers and the comment tool not being attached to the current root graph. These gaps become dangerous when providers or real execution are enabled.

Correction: enforce one shared policy boundary around every tool invocation, with trusted scope, explicit side-effect metadata, output filtering, and fail-closed handling. Shadow mode must intercept writes before entering providers. Keep mutation tools disabled until durable approval, expiry, approver authorization, exact-argument binding, and replay prevention are tested.

<a id="codebase-review-2026-09-11--4-p1--tenant-isolation-and-action-permissions-are-incomplete"></a>
#### 4. P1 — Tenant isolation and action permissions are incomplete

[the original policy engine] did not fully enforce tenant and action boundaries. The maintained scope and policy rules are described in the [security model](data-access-and-operations.md#security-model) and [current policy engine](../../app/policy/engine.py).

Correction: validate tenant membership and project/resource scope first, then action permission, then approval requirements. Use explicit role-to-permission sets instead of treating all roles as a single numeric ladder. Any intentional administrative cross-tenant operation needs a separate explicit audited permission.

<a id="codebase-review-2026-09-11--5-p1--yaml-permissions-are-silently-discarded"></a>
#### 5. P1 — YAML permissions are silently discarded

The original capability parser did not fully honor nested permission data. The current strict schema is [app/capabilities/models.py](../../app/capabilities/models.py), with resolution described in the [capability lifecycle](runtime-and-extension-contracts.md#harness--4-capability-lifecycle).

Verified: `database_rca` loads with `PROJECT_ANALYST` and an empty allow-list despite its manifest. Changing the manifest's nested minimum role would not change the effective default.

Correction: match the schema to the YAML, reject unknown fields, constrain safety values with enums/literals, and test effective authorization from actual manifest fixtures. Fail startup on duplicate IDs, unresolved references, or invalid configuration.

<a id="codebase-review-2026-09-11--6-p1--capabilities-do-not-govern-execution"></a>
#### 6. P1 — Capabilities do not govern execution

[the original capability resolver] did not fully bind readiness to execution. The current resolver and run preflight are described in the [capability lifecycle](runtime-and-extension-contracts.md#harness--4-capability-lifecycle).

Correction: resolve a validated snapshot containing the permitted tools, applicable workflow, effective model configuration, and connector readiness. Required failures block; optional failures yield a visible partial result. Only expose implemented capabilities. Use simple explicit capability-to-workflow mappings before building a general dynamic planner.

<a id="codebase-review-2026-09-11--7-p1--connector-health-and-data-are-simulated"></a>
#### 7. P1 — Connector health and data are simulated

[the original connector providers] returned fixtures. The current provider boundary and health lifecycle are documented in [connector onboarding](connector-specifications.md#connector-onboarding) and implemented under [app/connectors/providers](../../app/connectors/providers).

Correction: clearly separate test providers. In real providers, own credentials and a reusable async HTTPX2 client within application lifespan; close it on shutdown. Set connect/read/write/pool timeouts, pool limits, response-size limits, and bounded result pagination. Retry only appropriate failures and idempotent operations; honor rate limits. Health probes must be bounded, authenticated, and operation-specific. Inject the same scoped provider instances into health checks and tools. [Official async client guidance](https://pydantic.dev/docs/httpx2/guides/async/).

<a id="codebase-review-2026-09-11--8-p1--the-sql-guard-does-not-establish-read-only-safety"></a>
#### 8. P1 — The SQL guard does not establish read-only safety

[the original database tool] used a superficial read-only check. Database querying remains disabled; see the [database capability](../../blob_local/platform/capabilities/database_rca.yaml).

Correction: prefer granular diagnostic tools such as lock/session inspection backed by fixed parameterized queries. Use least-privilege read-only database credentials, server-enforced read-only transactions where supported, resource-scoped views, and statement/result limits. If arbitrary SQL is necessary, validate dialect-specific single-statement semantics as defense in depth. Keep database I/O inside a provider.

<a id="codebase-review-2026-09-11--9-p1--evidence-and-contracts-are-neither-immutable-nor-durable"></a>
#### 9. P1 — Evidence and contracts are neither immutable nor durable

[the original evidence store] was process-local. The maintained evidence and run-contract paths are [app/persistence/store.py](../../app/persistence/store.py) and [app/runtime/run_contract.py](../../app/runtime/run_contract.py).

Correction: persist server-computed evidence hashes and provenance, enforce tenant/run ownership at retrieval, reject conflicting overwrites, and verify report citations against saved evidence. Bind runs to canonical capability/skill/policy content hashes and the actual effective model configuration. Freezing a Pydantic model alone does not freeze nested lists/dicts; persist an immutable serialized snapshot. Add signing only with a defined signer/verifier trust boundary. Use ADK's persistent session service rather than inventing another conversation store. [ADK session services](https://adk.dev/sessions/session/).

<a id="codebase-review-2026-09-11--10-p1--observability-does-not-record-the-advertised-information"></a>
#### 10. P1 — Observability does not record the advertised information

[the original telemetry adapter] was incomplete. Current telemetry behavior and its live-mode boundary are documented in [operations](data-access-and-operations.md#operations).

Correction: configure one tracer provider during startup and export ADK spans using OTLP to MLflow's `/v1/traces`, with the experiment ID header and a SQL-backed tracking server. Prefer batched production export, bounded shutdown flush, and visible export-failure metrics. Correlate run/session/capability IDs and redact payloads before export. Do not infer SDK autologging from package installation: MLflow's documented ADK integration uses OpenTelemetry. [Official integration](https://mlflow.org/docs/latest/genai/tracing/integrations/listing/google-adk/).

<a id="codebase-review-2026-09-11--11-p1--tests-cannot-establish-correctness"></a>
#### 11. P1 — Tests cannot establish correctness

The original test harness could not establish correctness. Current verification commands and fixture boundaries are documented in [operations](data-access-and-operations.md#operations) and the repository `tests/` tree.

Correction: declare development dependencies, repair imports and entrypoints, then use fake ADK model responses and mock transports to test the actual pipeline without credentials. Add focused tests for forged identity, tenant boundaries, manifest parsing, tool policy interception, partial connector failure, evidence ownership, invalid citations, cancellation, and run limits. Add replay/expiry tests when writes are introduced. CI should run these plus import/lint checks and a container startup check.

For quality, build a small incident dataset covering temporal anchors, conflicting evidence, unknown causes, and prompt injection in logs/tickets. Measure evidence grounding, citation validity, tool correctness, abstention, latency, and cost. Use native ADK evaluation and/or `mlflow.genai.evaluate` with deterministic custom checks and selected model judges; security authorization must remain deterministic. [MLflow evaluation quickstart](https://mlflow.org/docs/latest/genai/eval-monitor/quickstart/).

<a id="codebase-review-2026-09-11--12-p1--container-and-developer-entrypoints-are-broken-or-unsafe"></a>
#### 12. P1 — Container and developer entrypoints are broken or unsafe

[the original Dockerfile](../../Dockerfile) copied too much of the workspace. The current container and environment boundary should be checked against the repository `.dockerignore` and deployment configuration.

Compose references nonexistent API and worker Dockerfiles. The Makefile points to absent `apps.*` modules and an absent evaluation script. The deployment manifest references `app.agent:app`, but that module only exports `root_agent` and `agent`. Compose's fixed database healthcheck identity also disagrees with the example environment overrides.

Correction: establish one working API entrypoint and one container first. Exclude secrets, `.git`, and host environments from build context; ignore local environment files in Git while retaining the template. Use a non-root runtime, reproducible dependency installation, and immutable production startup. Keep local database services private and repair healthcheck configuration. Remove the worker definition until there is an actual durable worker implementation.

<a id="codebase-review-2026-09-11--simplification-recommendations"></a>
### Simplification recommendations

1. Keep FastAPI, native ADK agents/tools, the capability resolver, provider boundaries, and explicit policy checks. Avoid a replacement orchestration framework.
2. Start with one complete read-only capability and one deployed service. Add a worker only when durable long-running execution or operational limits require it; do not rely on in-process background tasks for durable jobs.
3. Keep the current SequentialAgent/ParallelAgent design until measured needs justify ADK's newer graph workflow features. Consider merging synthesis and remediation drafting into one structured final response. Use deterministic connector calls where no model reasoning is needed.
4. Use Postgres for durable run/evidence/application records and an ADK-supported session backend. Defer Redis, vector search, optimization subsystems, and multiple deployment targets until they have a concrete workload.
5. Consolidate empty duplicate trees: top-level `observability/` versus `app/observability/`, `persistence/` versus `app/state/`, multiple migration locations, and unused optimization/knowledge scaffolding. An empty directory is not an implemented capability. The unused `observability/langsmith/` is misleading for the chosen MLflow architecture.
6. Remove unused direct dependencies such as LiteLLM unless provider routing is actually required. Declare imports the application relies on directly—FastAPI, Pydantic, PyYAML, Uvicorn, and the OTel SDK—instead of relying on transitive installation. Preserve the lockfile and validate upgrades deliberately.
7. Load settings once. Make capability versions, model profiles, provider instances, and budgets have one effective source of truth. Do not leave configuration that appears enforced but is ignored.
8. Update documentation to separate working behavior from planned behavior, especially signed contracts, hot-loaded skills, mutation halt, durable evidence, WebSockets, and production deployment support.

<a id="codebase-review-2026-09-11--upstream-examples-reviewed-and-how-to-apply-them"></a>
### Upstream examples reviewed and how to apply them

| Official example or guide | Relevant lesson | Application here |
|---|---|---|
| [ADK parallel-functions source](https://raw.githubusercontent.com/google/adk-python/main/contributing/samples/parallel_functions/agent.py) | Async tool functions yield during I/O; the example itself uses mock data. | Use async provider methods and await them in tools; do not copy its synthetic-data behavior into production. |
| [ADK workflow-triage sample](https://github.com/google/adk-python/blob/main/contributing/samples/patterns/workflow_triage/README.md) | Relevant workers are selected/skipped; outputs have explicit state keys. | Gate optional investigations with validated capability/readiness state; avoid running every investigator for every capability. The README was reviewed, not the complete sample implementation. |
| [ADK parallel research and synthesis example](https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/) | Branch outputs are written to separate keys and explicitly consumed by synthesis. | Define `triage_result`, `log_evidence`, and `database_evidence`, then feed them into a structured final result. Current agents have no `output_key`; test actual event/state flow rather than assuming all branch evidence reaches synthesis correctly. |
| [ADK action-confirmation examples](https://adk.dev/tools-custom/confirmation/) | Native confirmation exists but is experimental; the current guide lists DatabaseSessionService and VertexAiSessionService as unsupported. | Do not assume confirmation plus persistent sessions works merely because each feature exists. Validate the exact 2.9.0 combination; keep writes disabled or use a durable application approval boundary until proven. |
| [ADK callback patterns](https://adk.dev/callbacks/design-patterns-and-best-practices/) | Callbacks support interception and transformation. | Centralize policy and redaction through native interception hooks, covering every registered tool and output path. |

Upstream `main` examples evolve independently of releases. Adapt against the locked package and add compatibility checks; examples demonstrate patterns, not this platform's tenant security or durability. The old standalone human-tool-confirmation source URL was unavailable, so confirmation guidance above is based on the official current documentation.

<a id="codebase-review-2026-09-11--backend-preparation-for-the-later-frontend"></a>
### Backend preparation for the later frontend

No frontend build is needed now. First stabilize typed, authorized APIs for identity/project selection, enabled capabilities, creating and inspecting runs, run history, evidence retrieval, and connector readiness. Represent queued/running/succeeded/partial/failed/cancelled states and explicit insufficient-evidence outcomes. Return structured findings with evidence IDs, uncertainty, and safe next steps rather than one unstructured string.

Once execution is genuinely long-running, provide durable run IDs, cancellation, retry/idempotency semantics, and resumable progress events. SSE is a reasonable initial choice for one-way progress; WebSockets are unnecessary unless bidirectional real-time behavior is required. Add approval APIs only alongside a tested write workflow. Choose CORS/session/CSRF behavior when the frontend hosting and authentication design is known.

<a id="codebase-review-2026-09-11--recommended-implementation-order-and-exit-checks"></a>
### Recommended implementation order and exit checks

1. **Make the prototype honest and safe:** explicit demo mode, no fabricated production success, authenticated identity, correct manifest schema, enforced tenant/project checks, repaired tests and container exclusions. Exit: forged identity fails and fixtures cannot be returned as real evidence.
2. **Complete one read-only investigation:** real scoped providers, actual ADK execution, explicit state handoff, persistent sessions/evidence, grounded output. Exit: a fixture-backed end-to-end run invokes tools and resolves every citation; unavailable connectors return an honest partial/blocked result.
3. **Make it operable:** OTel-to-MLflow tracing, bounded execution and concurrency, cancellation, readiness, durable run status, tested container/CI, incident evaluation set. Exit: failures are observable and process restarts do not lose durable run/evidence records.
4. **Build the frontend against those contracts.** Introduce mutative remediation only after durable approval and replay protection pass their own checks.

<a id="codebase-review-2026-09-11--verification-record-and-limits"></a>
### Verification record and limits

- Installed versions checked through package metadata; latest releases checked against official PyPI pages.
- Native agent graph imports and module-form smoke test passed in the existing environment.
- In-process API checks reproduced self-declared administrator access and prompt-independent diagnosis.
- Direct policy check reproduced cross-tenant ALLOW with equal project IDs.
- Manifest loading reproduced discarded nested permissions.
- SQL guard checks reproduced unsafe statement acceptance against fixture-only code.
- Pytest could not start; its test imports also reference a missing package.
- Documented script-form smoke invocation failed with `ModuleNotFoundError: app`.
- Missing container/worker/evaluation entrypoints and absent Docker exclusions were checked from local files.
- No live model accuracy, cloud deployment, real connector behavior, production load, or container build was validated. The findings above do not imply those tests passed.

---

<a id="production-readiness-2026-09-11"></a>

<a id="production-readiness-2026-09-11--database-rebuild-and-production-readiness-review--11-september-2026"></a>
## Database rebuild and production readiness review — 11 September 2026

The repository's local database was dropped and recreated with the requested simplified design. PostgreSQL runs at `127.0.0.1:5432`; the API runs at `127.0.0.1:8000`. The existing Homebrew PostgreSQL 18 service was stopped with user authorization to release port 5432; its data directory was retained. Blob files were retained. This is a verified local deployment; live authentication, external integrations, production load and recovery still require deployment-specific validation.

<a id="production-readiness-2026-09-11--changes-completed"></a>
### Changes completed

| Area | Result | Implementation |
|---|---|---|
| Database layout | Seven schemas; 18 application tables plus migration metadata and upstream ADK/MLflow tables | [DDL](../../migrations/history/001_initial.sql) |
| ETL metadata | Six fields: `created_time`, `created_by`, `edited_time`, `edited_by`, `etl_src_system`, `etl_batch_id`; maintained by PostgreSQL triggers | [DDL](../../migrations/history/001_initial.sql), [tracking migration](../../migrations/history/003_tracking_columns.sql), [transaction context](../../app/persistence/lineage.py) |
| Platform/project configuration | Typed defaults, fixed or delegated project values, project display names, optimistic revisions and audit records | [parameter store](../../app/configuration/parameters.py), [API](../../app/api/routes/parameters.py) |
| Template deployment | Validated immutable configuration snapshots; initial import preserves existing values; later publication checks the current hash | [bundle store](../../app/configuration/database_bundle.py), [seed command](../../scripts/seed_database.py) |
| Secrets | Credential parameters hold `env://` references; providers resolve deployment environment variables | [secret resolver](../../app/connectors/providers/secrets.py) |
| Files | Attachment catalog contains metadata and content hashes; original bytes and extracted attachment content are in blobs | [store](../../app/persistence/store.py), [artifact store](../../app/persistence/chat_artifacts.py) |
| Runtime metadata | ADK sessions/events and MLflow tracking metadata use PostgreSQL; upstream schema ownership is preserved | [session service](../../app/persistence/database.py), [deployment job](../../scripts/deploy_database.py) |
| Query efficiency | Normal run listings use one data query; expired entries use one bounded update and refresh, rather than one lookup per row | [store](../../app/persistence/store.py), [regression test](../../tests/unit/test_store.py) |
| Input protection | Slow body reads time out, and upload capacity is released; authentication still precedes parsing | [HTTP boundary](../../app/api/application.py), [test](../../tests/harness/test_request_body_timeout.py) |
| Deployment permissions | Separate runtime role without schema ownership; migration credentials excluded from API environment; audit history cannot be updated/deleted by that role | [deployment scripts](../../scripts/deploy_database.py), [local setup](../../scripts/deploy_local_database.py) |
| Container efficiency | Dependency installation is cached independently of source changes; dependency caches and whole-environment ownership copies are excluded from the image | [Dockerfile](../../Dockerfile) |
| CI | Disposable PostgreSQL service enables actual migration and integration checks | [workflow](../../.github/workflows/ci.yml) |

Existing investigation evidence and native session events can retain snippets used during analysis. The metadata-only rule applies to file storage/catalog records; removing evidence content would change the investigation and citation contract.

<a id="production-readiness-2026-09-11--verification-performed"></a>
### Verification performed

- `make lint`: passed.
- `make test` with PostgreSQL integration enabled: **117 tests passed**, plus two subtests; no skipped PostgreSQL test.
- `make smoke`: **8 tests passed**.
- [PostgreSQL integration test](../../tests/integration/test_postgres.py): clean migration and replay, typed/fixed-value constraints, minimal ETL lineage, scoped parameter API, file metadata separation, native ADK event persistence, and native MLflow run/metric storage.
- Local deployment inspection: seven schemas, exactly 108 tracking columns at migration 3 across 18 application tables, 21 runtime parameter definitions, and readable MLflow metadata using the runtime account.
- Permission inspection: runtime account cannot create tables in `runtime` or update parameter audit history.
- Container build and startup: PostgreSQL and API healthy; API liveness returns 200.

The final image refresh exposed host disk exhaustion. Docker was recovered, unreachable dependency-cache entries and four exact cache layers from this task were removed, and the Dockerfile was corrected to avoid duplicate dependency layers. Database volumes and blob files were preserved.

Upstream deprecation and experimental-feature warnings remain visible in the test output. The tests use controlled model/connector fixtures; these results are not a live model-quality score.

<a id="production-readiness-2026-09-11--before-production-activation"></a>
### Before production activation

Configure the real JWT issuer, audience, RSA public key and server-side memberships. The local deployment deliberately remains unavailable to authenticated API traffic until those are configured. Set and verify live Jira, Splunk and model credentials and permissions. Run workload-specific capacity tests and a coordinated PostgreSQL/blob backup-and-restore exercise in the intended deployment environment. No durable background worker or automatic run resumption has been introduced.

Configuration changes take effect after restarting the API. Trusted environment overrides take precedence over database runtime parameters. Follow the [database guide](data-access-and-operations.md#database) for deployment, parameter updates and explicit development replay; use versioned migrations for subsequent non-destructive upgrades.

The final requested rebuild applied migrations 1–3 to a fresh application database on port 5432. All 18 application tables contain `created_time`, `created_by`, `edited_time`, `edited_by`, `etl_src_system`, and `etl_batch_id`; previous ETL column names are absent. Seeded rows carry `job:template-import` and matching initial creation/edit times. Tests verify preserved creation values, updated edit values, direct SQL fallback, and authenticated API writes. Blob files were retained. See the [tracking DDL](../../migrations/history/003_tracking_columns.sql) and [PostgreSQL test](../../tests/integration/test_postgres.py).

---

<a id="implementation-review"></a>

<a id="implementation-review--project-and-connector-implementation-review"></a>
## Project and connector implementation review

Review date: 13 September 2026. This is an evidence ledger for the implementation, separate from the target requirements. A passing unit suite does not establish that every requested workflow is delivered.

<a id="implementation-review--acceptance-standard"></a>
### Acceptance standard

- A user can configure, validate, save, reload, test and activate the same connector instance without re-entering data or changing its identity.
- Connection, authentication, authorization, resource access and data parsing have distinct outcomes. A successful health check does not establish that a query or environment mapping works.
- Displayed environments, credential references, test timestamps, approval state and readiness come from persisted backend records. Absent evidence is displayed as not configured or not tested.
- Project identity comes from authenticated deployment scope. A URL selects a view; it cannot grant access to another project.
- Form fields follow the selected connector, authentication method and environment choice. Unsupported modes cannot appear operational.
- Setup screens put the current task and its primary action first. Detailed policy information, hashes and diagnostics belong in secondary views.
- Tests use isolated servers with explicit test credentials. Test responses must never become product defaults or production evidence.

<a id="implementation-review--findings-and-corrections"></a>
### Findings and corrections

| Finding | Impact | Correction or acceptance evidence |
| --- | --- | --- |
| Applied migration 014 had been modified | Existing installations fail immutable migration checks | Original migration restored; additive migration 015 expands system names. Verified against the local database checksum and applied without deleting data. |
| Legacy saved templates fail the new schema | Application cannot start | Compatibility reader supplies missing project identity metadata. New publication remains a separate validation boundary. |
| Revised source catalog is absent from the saved deployment | Users see outdated connector names and forms | Updated the local active configuration through the immutable bundle store; preserved previous snapshots and unrelated project configuration. |
| Redaction status previously lacked a runtime-backed preview | UI cannot demonstrate what protection is actually applied | Project policy endpoint and bounded preview use the actual deterministic redaction function. Authentication, bounds and output tested; browser preview confirmed. |
| Upload provenance disappears after refresh | Users lose filename, digest and processing outcomes | Migration 016 persists upload metadata alongside project knowledge. The list API returns the same metadata as upload. |
| MCP project identity is missing | Similar systems cannot be clearly differentiated | Project-only system name, dependency choice, tool environment and active-project environment mappings added. Platform definitions cannot store project identity. Defaults preserve saved custom names. |
| Jira mapping declarations do not affect extraction | Saved fields appear functional without changing evidence | Provider accepts bounded canonical-ID-to-display-name mappings, returns mapped values and reports unavailable fields. Discovery verifies project access; real local TLS transport test covers success and denied access. |
| Unix passphrase input was not wired, and encrypted OpenSSH support was absent | Valid credentials fail despite apparently supported forms | Password and key authentication explicitly select the SSH method; passphrase reaches the provider. AsyncSSH's bcrypt extra is installed. A local SSH test covers password, encrypted key, wrong password and untrusted host-key behavior. PPK conversion remains explicit. |

<a id="implementation-review--verified-lifecycle-and-review-results"></a>
### Verified lifecycle and review results

| Area | Verified behavior | Evidence |
| --- | --- | --- |
| Saved identity | Draft, test and enable use the same instance, template version and provider configuration. Save-only metadata originally caused a hash mismatch; the browser exposed it and the editor now constructs one shared payload. | [Editor](../../frontend/src/components/ConnectorInstanceEditor.tsx), [public API lifecycle tests](../../tests/integration/test_connector_lifecycle.py) |
| Activation races | Activation compares the reviewed revision atomically; editing the draft during validation cannot enable its replacement. Archived instances cannot be activated. | [Persistence](../../app/persistence/platform_admin.py), [identity regression](../../tests/integration/test_connector_identity.py) |
| Names | Case-insensitive duplicate names are rejected within native project connectors; MCP registrations have their own uniqueness check. Cross-catalog uniqueness remains an improvement. | [Persistence](../../app/persistence/platform_admin.py), [MCP configuration](../../app/configuration/integrations.py) |
| Environment ownership | Save, validate, test, enable and field discovery reject mappings outside active authenticated-project environments. Runtime rejects invalid required bindings. | [Lifecycle API](../../app/api/routes/connectors_api.py), [runtime tests](../../tests/integration/test_connector_runtime_resolution.py) |
| Scoped reads | Tests construct the selected provider and perform bounded authorized reads. A health-only response cannot satisfy scoped-read validation. | [Candidate testing](../../app/connectors/candidate_testing.py), [TLS tests](../../tests/integration/test_connector_socket_transport.py), [SSH tests](../../tests/integration/test_unix_socket_transport.py) |
| Project navigation | Browser sign-in and direct reload resolve `/p/payments-prod/tools` and `/p/payments-prod/project-setup`; API scope remains authenticated. | [App navigation](../../frontend/src/App.tsx), browser review |
| Honest project details | Removed sample field counts and static lookback cards. Instance cards show the saved system name, template separately, and missing configuration explicitly. | [Project Setup](../../frontend/src/pages/ProjectSetup.tsx) |
| Accessible layout | Wrapped tabs/actions, named controls, selected-state semantics and collapsed advanced overrides. Browser review confirmed the corrected Tools header at 1280px and 390px widths. | [Tools](../../frontend/src/pages/Tools.tsx), [styles](../../frontend/src/styles/tools-workspace.css) |

<a id="implementation-review--validation-record"></a>
#### Validation record

- `make lint`: passed.
- `make test`: **256 passed, 2 skipped, 2 subtests passed**. Existing dependency warnings remain; skips are not successful coverage.
- `make smoke`: **8 passed**.
- Frontend production build: passed; frontend checks: **13 passed**.
- `git diff --check`: passed.
- Browser: created a real isolated project draft, saved it, reopened it, invoked testing, and confirmed missing endpoint/scope/credentials produce failure with enablement blocked. Archived the disposable draft afterward. No customer credentials were used.
- Browser review found defects missed by the automated detector: squeezed header content and a save/test payload mismatch. Both were corrected and rechecked. A clean detector is not design acceptance.

<a id="implementation-review--design-assessment"></a>
#### Design assessment

Two independent reviewers assessed the earlier interface. Assessment A scored **21/40** before final corrections: visibility 2, real-world language 2, control/freedom 3, consistency 2, error prevention 2, recognition 2, efficiency 2, minimalist design 2, recovery 2, help 2. Assessment B found zero automated detector matches but confirmed clipped navigation, unnamed controls and truncation through browser inspection.

The baseline is not a score for the final implementation. The follow-up corrected these findings, made actions readable at desktop width, checked phone width, removed nonfunctional links and reduced instructional copy. A fresh holistic review is still required before calling the design excellent. Novice users still face substantial configuration vocabulary; expert users need a concise revision/test timeline; keyboard users need a complete flow audit beyond individual tab and label checks.

<a id="implementation-review--scope-and-evidence-limits"></a>
### Scope and evidence limits

- Local TLS mock-server tests establish request, authentication, scope, parsing and error behavior against controlled responses. They do not establish compatibility with a particular customer deployment or production credential set.
- The local deployment remains in demo mode. No configured production Jira, Splunk, Kafka, Unix or Oracle connection has been verified during this review.
- Knowledge uploads currently retain extracted, redacted text and source metadata. Original-file retention, immutable runbook versions, deduplication and automatic retrieval by agents require their own complete implementation and acceptance tests.
- Built-in redaction rules are enforced. Persisted custom redaction patterns are currently metadata; the project view must state this clearly.
- Saved scheduling definitions do not imply a durable scheduler. This release has no durable background-worker or recovery contract.
- Jira-hosted attachment downloading is not implemented. Local attachments remain bounded and authenticated; image processing is OCR only.
- Required connectors with multiple active environment bindings remain blocked at runtime because investigations do not yet have an authenticated environment selector. Testing each mapping does not remove this execution limitation.
- Oracle Thin mode does not use Oracle Client libraries. Thick-mode support must demonstrate the appropriate runtime and local library handling before its form can claim successful operation.

<a id="implementation-review--improvements-to-carry-forward"></a>
### Improvements to carry forward

Prioritize a complete connector lifecycle over additional catalog decoration. The next strongest improvements are a task-oriented project overview with explicit blockers, a compact test-result timeline tied to configuration revisions, a source-aware field-mapping editor, and a versioned project artifact library with citations back to the exact version used by a run. Each must be backed by persisted records and exercised through the public API and interface.

<a id="implementation-review--source-references"></a>
### Source references

- [Project requirements](product-and-workspace-specifications.md#project-setup-requirements)
- [Connector requirements](connector-specifications.md#connector-template-requirements)
- [Connector form specification](connector-specifications.md#connector-forms)
- [Redaction API](../../app/api/routes/project_redaction.py)
- [Upload API](../../app/api/routes/knowledge_uploads.py)
- [MCP registration rules](../../app/configuration/integrations.py)
- [Connector lifecycle API](../../app/api/routes/connectors_api.py)
- [Jira provider](../../app/connectors/providers/jira.py)
- [Isolated TLS transport test](../../tests/integration/test_connector_socket_transport.py)

---

<a id="ui-flow-review"></a>

<a id="ui-flow-review--ui-flow-review"></a>
## UI flow review

Three parallel reviewers traced investigation/session flows, project configuration, and governance/catalog management. Changes preserve the deployment security and release boundaries in [AGENTS.md](../../AGENTS.md).

<a id="ui-flow-review--completed-fixes"></a>
### Completed fixes

| Flow | Result | Implementation / verification |
| --- | --- | --- |
| Session | Removed embedded demo credential, kept tokens in memory, discarded legacy browser storage, cleared stale form state. | [SessionModal](../../frontend/src/components/SessionModal.tsx), [API client](../../frontend/src/services/api.ts), [API regression](../../tests/frontend_api.mjs) |
| Workspace | A forbidden section no longer prevents permitted run and health data from loading; expired authentication clears the session. | [App](../../frontend/src/App.tsx), [partial loading regression](../../tests/frontend_workspace_loading.mjs) |
| Navigation | Search shortcut works, all pages are searchable, results are keyboard buttons, breadcrumbs identify every page. Pages load on demand. | [App](../../frontend/src/App.tsx), [CommandPalette](../../frontend/src/components/CommandPalette.tsx), [Topbar](../../frontend/src/components/Topbar.tsx) |
| Investigations | Selected capability carries into the form; local file checks/removal and readable errors improve submission; polling recovers from temporary errors. | form (`frontend/src/components/NewInvestigationModal.tsx`, since removed), [Runs](../../frontend/src/pages/Runs.tsx), [polling regression](../../tests/frontend_run_polling.mjs) |
| Project Setup | Saves preserve governed fields and multiline content; empty environment lists and inherited skill instructions round-trip correctly. Unsupported display metadata is explicit. | [ProjectSetup](../../frontend/src/pages/ProjectSetup.tsx), [round-trip regression](../../tests/frontend_project_setup_roundtrip.mjs) |
| Parameters / diagnostics | Blank numeric inputs remain editable, fractional integers are rejected, probe refreshes do not overlap, failures are visible. | [ParameterStudio](../../frontend/src/pages/ParameterStudio.tsx), [numeric regression](../../tests/frontend_parameter_values.mjs), [HealthChecks](../../frontend/src/pages/HealthChecks.tsx), [Settings](../../frontend/src/pages/Settings.tsx) |
| Harness / agents | Selection keys and exclusions round-trip, server permissions control editing, governance links open the exact candidate, action errors remain visible. | [HarnessLibrary](../../frontend/src/pages/HarnessLibrary.tsx), [selection regression](../../tests/frontend_harness_selection.mjs), [Agents](../../frontend/src/pages/Agents.tsx), [Governance](../../frontend/src/pages/Governance.tsx) |
| Evaluation | Dataset registration is available from the UI and selects the registered version; offline checks are described accurately. | [Optimization](../../frontend/src/pages/Optimization.tsx), [registration regression](../../tests/frontend_optimization_dataset.mjs), [Skills](../../frontend/src/pages/Skills.tsx) |

<a id="ui-flow-review--verification-and-limits"></a>
### Verification and limits

Final backend checks: make lint, make test (165 passed, 2 skipped, 2 subtests passed), and make smoke (8 passed). Frontend build, lint, and npm test (9 regression scripts) passed. Frontend lint still reports warnings. Initial JavaScript entry bundle fell from approximately 653 KB to 278 KB by loading pages on demand; this measures built asset size, not browser latency.

After explicit approval on September 12, 2026, the local demo administrator session was verified in the browser. All 21 navigation pages were opened. Checked keyboard search; selected-capability handoff; a simulated investigation and its saved result; exact governance candidate navigation and disabled self-approval; dataset validation, registration, and persistence across reload; and project validation, save, refresh, and revalidation. Refresh cleared the in-memory session as designed. This is targeted browser verification, not exhaustive coverage of every control, role, or responsive size. No live model or external provider certification is claimed.

The application is not 100% UI-managed: identity/membership, role policy, deployment secrets and runtime settings remain deployment-managed. Retention cleanup remains manual. Database evidence querying is disabled; live evidence providers remain read-only Jira and Splunk. Knowledge is retained attachment metadata rather than a full RAG administration surface, and unavailable billing/quality telemetry is not fabricated. See [editability inventory](historical-reviews.md#admin-editability-audit), [identity policy](../../app/identity/principals.py), [cleanup](../../scripts/cleanup.py), and [provider registry](../../app/connectors/providers/registry.py).

<a id="ui-flow-review--browser-discovered-fixes-on-september-12"></a>
### Browser-discovered fixes on September 12

- [Project Setup serialization](../../frontend/src/utils/projectSetupConfig.ts) respects the database-loaded deployment section allowlist. Older policies no longer receive an invented empty environments section; unavailable environment controls explain the restriction.
- [Agent review controls](../../frontend/src/pages/Agents.tsx) require a different authorized administrator, loaded hash, and nonblank rationale; [eligibility regression](../../tests/frontend_agent_review.mjs) covers these gates.
- [Page recovery](../../frontend/src/App.tsx) presents a reload action when an outdated or unavailable page bundle fails, with a [regression](../../tests/frontend_page_recovery.mjs).
- [Migration 005](../../migrations/history/005_configuration_save_privileges.sql) was applied to the local demo PostgreSQL database. It grants insertion of configuration snapshots and updates only to the active content_hash pointer. Existing snapshots remain immutable; scope changes and pointer deletion remain denied. [Deployment grants](../../scripts/deploy_database.py) now preserve the same restrictions. The [restricted-role PostgreSQL regression](../../tests/integration/test_configuration_save_privileges.py) passed in a separate disposable database.

Browser verification added a simulated log-correlation investigation (`run_3fa000559b1b44b4877e9330e19b7d9b`) and a synthetic example dataset (`ui_verification_20260912`, version `1.0.0`) to the local demo. The existing project form was saved without changing form inputs. No agents were approved, rejected, or revoked, and no live diagnosis was run.

---

<a id="validation-2026-09-15"></a>

<a id="validation-2026-09-15--rca-assist-validation--september-15-2026"></a>
## RCA assist validation — September 15, 2026

This records the implemented release and its verification. It does not claim that
all ideas in the rough reference notes are implemented or that fixture responses
establish diagnostic accuracy. The updated local application is served on port
8000; its health and readiness endpoints both returned HTTP 200 after restart.

<a id="validation-2026-09-15--results"></a>
### Results

| Check | Result |
| --- | --- |
| `make lint` | Passed |
| `make test` | **385 passed + 2 subtests**, zero failures or skips |
| PostgreSQL integration | All **3** checks included in that full run; migrations 001–027, restricted roles and native sessions |
| Final setup correction | **9 project integration tests passed** after the final legacy filesystem stale-edit correction |
| `make smoke` | **8 passed** on final backend code |
| `make eval` | **4 offline fixture contracts passed** |
| Frontend scripts | **26 passed** |
| Frontend production build and lint | Passed; lint still reports warnings |
| `git diff --check` | Passed |

The full Python run took 121.59 seconds. Its nine warnings concern upstream
interfaces and deprecations. Tests used isolated local TLS, SSH, MCP and PostgreSQL
services with socket access enabled. The disposable PostgreSQL clusters were
stopped and removed after verification.

Offline evaluation recorded means of 1.0 for `contract_status`,
`cited_evidence_exists` and `secrets_absent`, in MLflow run
`8a891b26e3b347bba04fe80deb652fad`. These are four fixture contracts, not a live
quality benchmark. [Evaluation implementation](../../scripts/eval.py).

<a id="validation-2026-09-15--browser-journeys-completed"></a>
### Browser journeys completed

Browser verification used a separate application on port 8005 with disposable
identities, fixture models and test providers. Test questions and documents were
not added to the user's local project on port 8000.

1. **Create a project:** created “Browser journey” through the project menu and
   opened its persisted setup. Its project list, blank conversation history and
   empty connector configuration were separate from the existing “payments” test
   project. [Workspace shell](../../frontend/src/App.tsx),
   [project service](../../app/configuration/projects.py).
2. **Request and approve access:** a second identity requested Owner access. The
   original owner reviewed the request and its reason, approved it, and the
   requester refreshed its history and selected the newly available project. The
   second identity displayed its actual Owner role rather than retaining its
   administrator role from the other project.
   [Access lifecycle](../../app/configuration/project_access.py),
   [access interface](../../frontend/src/components/ProjectAccessDialog.tsx).
3. **Add knowledge after creation:** saved a checkout runbook through Project Setup,
   submitted it in Knowledge, then approved it as the second project owner. The
   author could not approve its own pending revision. The page showed the reviewer
   and decision. [Knowledge service](../../app/configuration/knowledge.py),
   [knowledge interface](../../frontend/src/pages/Knowledge.tsx).
4. **Ask and inspect:** ordinary incident wording requested clarification; a ticket
   question ran the native ADK workflow and returned a short answer with source,
   uncertainty and next step. A question about the newly approved runbook selected
   project knowledge automatically and cited the exact approved document. Saved
   activity exposed measured step durations. Fixture-model text explicitly
   identified itself as an offline result.
   [Intent resolution](../../app/runtime/intent.py),
   [chat interface](../../frontend/src/pages/Chat.tsx).
5. **Files and reports:** reopened the prepared uploaded-log conversation. Files
   showed its original log and generated report. The extracted preview masked a
   test password; original-file and JSON-report download actions both reported
   “Download started.” Backend contracts verify byte integrity and ownership.
   [Preview service](../../app/persistence/chat_artifacts.py),
   [file interface](../../frontend/src/components/ChatFiles.tsx).
6. **Feedback and charts:** saved a Useful rating on the completed knowledge
   investigation. Insights showed one investigation and one Useful rating for that
   project, while missing provider token/cost values remained unrecorded or
   incomplete. Selecting the chart bar displayed its exact recorded measurements.
   [Feedback API](../../app/api/routes/feedback.py),
   [telemetry](../../app/persistence/telemetry.py),
   [Insights](../../frontend/src/pages/Insights.tsx).

The public landing page, its workspace entry, and the desktop Chat layout were
also visually inspected. A build during verification invalidated an older lazy
page asset; the page recovery screen correctly requested a reload. Final screens
were checked against the rebuilt application.

<a id="validation-2026-09-15--independent-critique-and-corrections"></a>
### Independent critique and corrections

- Replaced the mandatory investigation picker with automatic routing and durable
  clarification messages; choices preserve the original question and attachments.
- Made New Project create a database-backed workspace and separated team navigation
  from administration. Initial document uploads use bounded parallel batches.
- Fixed duplicate managed-skill inheritance when creating projects, immediate
  membership revocation, inactive members regaining old elevated roles, and runtime
  eviction while a streaming response was still active.
- Unmounted the old workspace before changing project headers. Late directory and
  health responses cannot overwrite the next project's state.
- Limited initial workspace loading to page-relevant APIs; feedback loads as its
  footer approaches the viewport rather than issuing requests for every old turn.
- Published applied project names, descriptions and timezones atomically with the
  configuration; rejected stale drafts. Removed a misleading project-status form.
- Simplified the crowded header, protected unsent follow-up drafts, and moved
  storage IDs/hashes out of the first view of evidence. Internal activity names use
  plain-language labels in Chat.
- Fixed fresh-install database role provisioning without editing previously applied
  migrations; added restricted-role project-creation and chat-sequence tests.

<a id="validation-2026-09-15--automated-contract-coverage"></a>
### Automated contract coverage

| Area | Evidence |
| --- | --- |
| Concurrent project isolation, restart, independent role review and revocation | [Project tests](../../tests/integration/test_projects.py), [independent tests](../../tests/integration/test_projects_independent_review.py) |
| Natural routing, unsupported requests, clarification persistence and context | [Intent tests](../../tests/integration/test_chat_intent.py), [conversation tests](../../tests/integration/test_chat_conversations.py) |
| Owned previews, expiry, integrity and redaction | [Preview tests](../../tests/harness/test_artifact_preview.py) |
| Feedback ownership, revision conflict, restart, redaction and retention | [Feedback tests](../../tests/integration/test_feedback.py) |
| Approved-only skill execution and concurrent review bounds | [Skill tests](../../tests/integration/test_skill_catalog.py) |
| File/document review, revocation, scoped retrieval and cited execution | [Knowledge tests](../../tests/integration/test_knowledge_lifecycle.py) |
| RS256, PKCE, nonce, CSRF, browser session and selected-project membership | [OIDC tests](../../tests/integration/test_oidc.py), [independent OIDC tests](../../tests/integration/test_oidc_independent_review.py), [selected-project checks](../../tests/integration/test_projects_independent_review.py) |
| Provider counters, coverage, caching, reviewed prices and TLS source integration | [Telemetry tests](../../tests/integration/test_telemetry.py) |
| Real migrated PostgreSQL, immutable scope keys and minimum runtime privileges | [Database tests](../../tests/integration/test_postgres.py), [project privilege tests](../../tests/integration/test_project_postgres_privileges.py), [configuration privileges](../../tests/integration/test_configuration_save_privileges.py) |
| Stale identity responses, page-specific loading and safe output presentation | [Scope checks](../../tests/frontend_project_scope.mjs), [workspace checks](../../tests/frontend_workspace_loading.mjs), [answer safety](../../tests/frontend_answer_safety.mjs) |

<a id="validation-2026-09-15--remaining-verification-and-release-boundaries"></a>
### Remaining verification and release boundaries

- **Phone rendering remains unverified.** The viewport control left the page at
  1280 × 720, and the separate browser connection was unavailable. A temporary
  narrow-frame harness was blocked by the application's framing protection; the
  protection was retained and the harness removed. Responsive styles require a
  working device/browser review before mobile release.
- **Browser file selection remains unverified.** Its chooser control stalled in an
  earlier check. Real API upload/parser/review contracts passed, and the resulting
  file's browser preview/download were exercised as described above.
- Real company SSO needs the organization's issuer, application registration and
  credentials. Signed local-provider protocol tests do not replace a real IdP
  login. [Company sign-in](data-access-and-operations.md#browser-sign-in).
- Live model accuracy, actual provider billing, representative user acceptance and
  production load tests are still required for a production rollout. Completion,
  citations and self-reported feedback are not accuracy scores.
- Skills extend approved analysis and existing tools. General semantic memory,
  automatic retraining, scheduled knowledge refresh, project archive/restore,
  bidirectional media and durable background recovery are not implemented by this
  release. [Extension boundaries](runtime-and-extension-contracts.md#extending-the-framework),
  [project workspaces](data-access-and-operations.md#project-workspaces).

After migration validation, additive migrations **025–027** were applied to the
existing local database, preserving its data. The local application was restarted
and its health/readiness checked. No external production deployment was performed.

---

<a id="readme-previous"></a>

<a id="readme-previous--rca-assist"></a>
## RCA assist

RCA assist is a Google ADK service for bounded, evidence-grounded incident analysis. The harness authenticates a request, verifies project membership and resolves an approved capability, runs a native ADK workflow against read-only connectors, records redacted evidence, validates citations, and persists the result.

Start with [Extend RCA assist with skills](runtime-and-extension-contracts.md#extending-the-framework) for the user
and administrator workflow, skill creation, and the implemented ADK feature map.
The public landing page opens the last accessible project’s **Chat**, the main team workspace: concise findings,
source inspection, streaming progress, and saved conversations. Use **Knowledge**
for reviewed project documents and **Insights** for measured usage and performance.

Use the [harness guide](runtime-and-extension-contracts.md#harness) for the component map and lifecycle
diagrams, the [architecture reference](runtime-and-extension-contracts.md#architecture) for implementation
details, and the [operations guide](data-access-and-operations.md#operations) for deployment behavior.

See [runtime context and tool lifecycle](runtime-and-extension-contracts.md#runtime-context) for evidence limits, complete request budgeting, and authorized follow-up context.

<a id="readme-previous--data-and-templates"></a>
### Data and templates

PostgreSQL manages configuration snapshots, platform/project parameters, run records and file metadata. Uploaded bytes, extracted content and generated artifacts use local/GCS blobs. [`blob_local/platform`](../../blob_local/platform) and project YAML provide validated deployment templates. See the [database guide](data-access-and-operations.md#database) for schema ownership, minimal ETL tracking, parameter inheritance and local deployment; implementation lives in the [snapshot loader](../../app/configuration/database_bundle.py), [store](../../app/persistence/store.py) and [blob provider](../../app/connectors/providers/blob.py).

<a id="readme-previous--documentation-map"></a>
### Documentation map

| Flow | What it explains |
|---|---|
| [Extend RCA assist with skills](runtime-and-extension-contracts.md#extending-the-framework) | Workspace entry, skill creation, supported extensions and ADK examples |
| [Project workspaces](data-access-and-operations.md#project-workspaces) | Create and switch projects, request access, and isolate team data |
| [Harness and lifecycles](runtime-and-extension-contracts.md#harness) | All runtime components, state machines and graphical flows |
| [Architecture](runtime-and-extension-contracts.md#architecture) | Ownership, package layout and detailed request/agent/tool/file/result flows |
| [Security model](data-access-and-operations.md#security-model) | Identity, scope, authorization, input safety and redaction |
| [Blob storage](data-access-and-operations.md#blob-storage) | Framework stages, chat uploads, generated outputs, retention and repair |
| [Connector runtime setup](connector-specifications.md#connector-runtime) | Native/MCP setup for all ten connectors, scoped operations and agent binding |
| [Connector onboarding](connector-specifications.md#connector-onboarding) | Provider boundaries, health checks and adding a read-only connector |
| [Capability authoring](configuration-and-review-contracts.md#capability-authoring) | Capability YAML contract and validation rules |
| [Skill inheritance](configuration-and-review-contracts.md#skill-inheritance) | Delegation, instruction precedence and action intersection |
| [Agent lifecycle](configuration-and-review-contracts.md#skill-lifecycle) | Submission, approval, activation, revocation and discovery |
| [Project knowledge and measured usage](data-access-and-operations.md#knowledge-and-usage) | Document review, runtime retrieval, usage coverage and approved prices |
| [Company sign-in](data-access-and-operations.md#browser-sign-in) | Reviewed OIDC setup, verified membership and browser sessions |
| [Design guide](product-and-workspace-specifications.md#design-previous) | Chat-first experience, accessibility and concise answers |
| [Chat artifacts](data-access-and-operations.md#chat-artifacts) | Upload and generated-output APIs |
| [Optimization](configuration-and-review-contracts.md#optimization) | Offline evaluation and reviewed promotion |
| [Database](data-access-and-operations.md#database) | PostgreSQL schemas, parameters, credentials and template publication |
| [Operations](data-access-and-operations.md#operations) | Configuration, health, cleanup, repair and verification |

<a id="readme-previous--api"></a>
### API

- `POST /api/v1/files`: multipart upload. Supports text, Markdown, logs, JSON, CSV/TSV, DOCX, XLSX, PDF text, and image OCR. Files are local-only and size/member bounded. Optional multipart `chat_id` groups uploads; omission creates a chat. Returns chat, attachment and artifact IDs. Original bytes are persisted separately from extracted text.
- `POST /api/v1/chats` creates an owned chat; `GET /api/v1/chats` lists yours. Chat details, runs, artifacts and original downloads use `/api/v1/chats/{chat_id}`. See [chat artifact persistence](data-access-and-operations.md#chat-artifacts).
- `GET/POST /api/v1/projects` lists accessible projects or creates one for an authorized administrator. `POST /api/v1/projects/{project_id}/select` checks membership and remembers the selection. `X-RCA-Project` chooses a context; it never grants membership.
- `POST /api/v1/chat/resolve` routes an owned conversation question using the approved catalog. Ambiguous or unsupported requests become durable messages without executing tools; `GET /api/v1/chats/{chat_id}/messages` reads them.
- `GET/PUT /api/v1/runs/{run_id}/feedback` reads or updates the author’s rating with a revision check. Project aggregates appear in Insights; feedback does not train models or approve changes.
- `POST /api/v1/runs`: JSON body with `prompt`, `capability`, optional `incident_id`, `chat_id`, and `attachment_ids`. An omitted chat ID is inferred from uploaded attachments; mixed-chat attachments are rejected.
- `GET /api/v1/runs`, `GET /api/v1/runs/{run_id}`, `GET /api/v1/runs/{run_id}/evidence`: inspect durable run state and evidence.
- `POST /api/v1/runs/{run_id}/cancel`: request cancellation.
- `GET /api/v1/runs/{run_id}/events`: SSE progress stream.
- `GET /api/v1/me`: authenticated server-side principal.
- `GET /api/v1/config`: redacted effective configuration, model profiles, and file limits. Prompt text is not returned.
- `GET /health`: liveness check.

Project specialists use a data-only YAML approval flow. See [agent lifecycle](configuration-and-review-contracts.md#skill-lifecycle).

<a id="readme-previous--local-setup"></a>
### Local setup

Install dependencies:

```bash
uv sync --locked --extra dev
```

Deploy the local PostgreSQL instance and template configuration:

```bash
make db-deploy
```

The [local deployer](../../scripts/deploy_local_database.py) creates missing credentials in `.env` and `.env.runtime` and starts PostgreSQL on `127.0.0.1:5432` by default. Configure authentication before using protected endpoints.

`RCA_MODE=demo` is offline and simulated; it must not be presented as a real diagnosis. Use `RCA_MODE=live` with trusted auth and connector configuration for live operation. `RCA_TENANT_ID` owns the deployment; `RCA_PROJECT_ID` identifies its bootstrap project. Existing `RCA_PRINCIPALS_JSON` memberships are imported once. Subsequent project memberships and last-used selection are database-managed and verified on every authenticated request. Request bodies cannot assign effective roles or tenant scope. See [project workspaces](data-access-and-operations.md#project-workspaces).

<a id="readme-previous--database-migrations"></a>
### Database migrations

Versioned SQL migrations are located in the [`migrations/`](../../migrations) directory. Migrations run inside a transaction under a PostgreSQL advisory lock (`726320260911`) and verify SHA-256 checksums to guarantee schema immutability.

- **Apply pending migrations:**
  ```bash
  make db-migrate
  # Equivalent to: uv run python -m scripts.migrate
  ```
  Applies any unapplied `.sql` migrations sequentially using `RCA_MIGRATION_DATABASE_URL` (or `RCA_DATABASE_URL` from `.env`) and records each version in `platform.schema_migrations`.

- **Initial deployment & role permission sync:**
  ```bash
  make db-deploy
  # Equivalent to: uv run python -m scripts.deploy_local_database
  ```
  Ensures the PostgreSQL container is up, applies all migrations, runs MLflow tracking upgrades, provisions/syncs data permissions for the restricted runtime `rca_app` role across all schemas, and seeds baseline platform and project templates. If a newly created table causes `permission denied for table ...` on startup, re-run `make db-deploy` (or `uv run python -m scripts.deploy_database`) to grant permissions to `rca_app`.

- **Recreate and re-migrate (clean database):**
  ```bash
  uv run python -m scripts.deploy_local_database --recreate
  ```
  Drops and recreates the database before running migrations and seeds; stored local blob files are retained.

<a id="readme-previous--starting-and-stopping-services"></a>
### Starting and stopping services

RCA assist consists of three core components:
1. **PostgreSQL Database** (`127.0.0.1:5432`)
2. **Backend API** (`127.0.0.1:8000`)
3. **RCA assist frontend** (`http://localhost:5173/` in development, or `http://localhost:8000/` when built); `/workspace` opens the assigned project and `/admins/overview` opens administration for authorized accounts.

<a id="readme-previous--option-1-local-development-separate-processes"></a>
#### Option 1: Local development (Separate processes)

<a id="readme-previous--starting-services"></a>
##### Starting services

1. **Database:**
   ```bash
   # Initialize credentials and start PostgreSQL (if not already running):
   make db-deploy

   # Or resume an existing container:
   docker compose up -d postgres
   ```

2. **Backend API:**
   ```bash
   make dev
   # Equivalent to: uv run uvicorn app.fast_api_app:app --reload --env-file .env --host 0.0.0.0 --port 8000
   ```
   Verify the API is running:
   ```bash
   curl http://127.0.0.1:8000/health
   curl http://127.0.0.1:8000/ready
   ```

3. **Frontend Admin Workspace:**
   ```bash
   cd frontend
   npm ci
   RCA_API_TARGET=http://127.0.0.1:8000 npm run dev
   ```
   Open `http://localhost:5173/` in your browser and choose **Open workspace**.

*(Optional production build)*: To serve the frontend directly through the FastAPI backend without running Vite:
```bash
cd frontend && npm run build
```
The FastAPI backend mounts and serves the built frontend at
`http://localhost:8000/`. Existing `/admin/` links remain compatible.

<a id="readme-previous--stopping-services"></a>
##### Stopping services

- **Frontend:** Press `Ctrl+C` in the frontend terminal, or terminate the process on port 5173:
  ```bash
  lsof -ti :5173 | xargs kill
  ```
- **Backend API:** Press `Ctrl+C` in the backend terminal, or terminate the process on port 8000:
  ```bash
  lsof -ti :8000 | xargs kill
  ```
- **Database:**
  ```bash
  # Stop PostgreSQL container without removing stored data:
  docker compose stop postgres

  # Or stop and remove Compose containers:
  docker compose down
  ```

---

<a id="readme-previous--option-2-full-stack-with-docker-compose"></a>
#### Option 2: Full stack with Docker Compose

<a id="readme-previous--starting-all-services"></a>
##### Starting all services

```bash
make docker-up
```
This runs `make db-deploy` to ensure `.env.runtime` and database credentials exist, then builds and starts both `postgres` and `api` containers in detached mode.

Verify container status:
```bash
docker compose ps
curl http://127.0.0.1:8000/health
```

<a id="readme-previous--stopping-all-services"></a>
##### Stopping all services

```bash
make docker-down
# Equivalent to: docker compose down
```

To pause containers without deleting them:
```bash
docker compose stop
```

To reset the database (recreate schemas while retaining local blob storage):
```bash
uv run python -m scripts.deploy_local_database --recreate
```


<a id="readme-previous--verification-and-current-boundaries"></a>
### Verification and current boundaries

The product introduction is at `/`; `/workspace` opens the assigned project and
`/admins/<page>` opens administration. See the [frontend setup guide](../development.md#local-frontend-and-adk-development-entrypoints)
for development, production builds, authentication, and the distinction between
persisted backend data and live connector execution.

From the source checkout, run `make lint`, `make test`, `make smoke`, and `make eval`. Smoke checks invoke the actual ADK runner with local model/HTTP fixtures. The four-case MLflow evaluation checks status handling, citation existence and redaction; it does not measure live root-cause accuracy. Its summary is written to `data/evaluation/summary.json`.

Images support local OCR, not visual scene reasoning. Scanned PDFs without extractable text are rejected. Model availability, live connector permissions, GCS access and production PostgreSQL operation must be verified in the deployment environment. Concurrency limits are per process. Runs persist across restarts but are not resumed automatically; expired runs become failed when read. See [operations](data-access-and-operations.md#operations) for retention and telemetry.

Configuration inheritance, optimization and storage lifecycle are documented in [architecture](runtime-and-extension-contracts.md#architecture), [optimization](configuration-and-review-contracts.md#optimization), and [blob storage](data-access-and-operations.md#blob-storage).

See the [database rebuild and readiness review](historical-reviews.md#production-readiness-2026-09-11) for the implemented changes, verification evidence and remaining live-deployment requirements.

---

<a id="gemini-previous"></a>

<a id="gemini-previous--rca-assist-developer-context"></a>
## RCA assist developer context

RCA assist is a Python 3.11 FastAPI service using Google ADK, SQLAlchemy async persistence, local bounded file extraction, Jira/Splunk read connectors, OpenTelemetry, and MLflow.

The API authenticates before uploads and runs. RS256 issuer, audience, public key, and server-side subject membership come from `RCA_AUTH_ISSUER`, `RCA_AUTH_AUDIENCE`, `RCA_AUTH_PUBLIC_KEY`, and `RCA_PRINCIPALS_JSON`. Each deployment is scoped by `RCA_TENANT_ID` and `RCA_PROJECT_ID`; callers cannot self-assign identity fields.

The ADK workflow is a native Workflow graph: an incident branch runs Jira triage then bounded Splunk investigation, while attachment summarization runs independently; a join feeds approved specialist AgentTools and final synthesis. Stage model profiles, capabilities, prompts, file limits, and parameter controls are stored and resolved database-first via `platform.system_configurations` and `platform.parameter_definitions`.

Use `RCA_MODE=demo` for offline simulation and `RCA_MODE=live` only with real credentials. Writes, issue mutations, database connector access, remote file fetches, macros, and code execution are unsupported. Jira operates strictly read-only via Jira Cloud REST API Version 3 with cursor-based pagination and in-traversal budgeted ADF parsing. See the [Gemini model](https://ai.google.dev/gemini-api/docs/models), [thinking](https://ai.google.dev/gemini-api/docs/thinking), and [ADK agents](https://google.github.io/adk-docs/agents/) references.

Approved project-specialist YAML is the supported exception to static topology: submit it at `/api/v1/agent-configurations`, review it with an expected content hash, and use it only after a same-scope administrator approves it. The router wraps approved definitions as ADK `AgentTool` instances; pending, rejected, and revoked definitions are invisible to runs. Storage is local by default and can use GCS via `RCA_CONFIG_BLOB_URI`.

<a id="gemini-previous--no-mockup-data--production-grade-engineering"></a>
### No mockup data & production-grade engineering

- **Zero Mockup Data**: Never introduce mock arrays, fake data fixtures, synthetic API stubs, or placeholder objects in frontend or agent code. All views and workflows must connect to authentic, live backend APIs and storage.
- **Reuse & Extend First**: Always inspect and reuse or extend existing components, services, tools, and endpoints before creating new ones. Do not build redundant or fragmented components.
- **Backend-First Implementation**: If backend support (endpoints, models, migrations, or domain tools) is missing, develop and connect the real backend first so that no mockup data is used anywhere.
- **Streamlined Full-Stack Quality**: Every feature must be built as a complete, production-grade vertical slice with strict typing, robust error handling, loading/empty states, and full contract fidelity.
