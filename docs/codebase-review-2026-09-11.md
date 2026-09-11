# RCA Analyzer historical codebase review — 11 September 2026

> Historical pre-implementation review. Its findings and line links describe the original prototype, not the current runtime contract. See the [harness guide](harness.md), [architecture reference](architecture.md), and current source/tests for maintained behavior.

The repository is an architectural prototype, not a production investigation service. Its native ADK orchestration and connector/tool separation are useful foundations. However, the public API currently returns invented investigation findings, identity is supplied by the caller, and most documented governance is not enforced. Updating packages alone will not resolve these problems.

Scope: application code, manifests, skills, configuration, tests, container/developer entrypoints, and relevant official upstream examples/documentation. Local checks used the existing environment and mock providers; no live model, external connector, deployment, or database operation was invoked. Application code was not modified. Frontend implementation is deferred.

## Package baseline

| Package | Declared minimum / locked / installed | Latest release verified | Recommendation |
|---|---|---|---|
| Google ADK | 2.9.0 | 2.9.0, September 10, 2026 | Keep the verified release; exercise its real Runner and session/event APIs. |
| MLflow | 3.16.0 | 3.16.0, September 4, 2026 | Connect tracing and evaluation; installing it does not activate either. |
| HTTPX2 | 2.12.0 | 2.12.0, August 18, 2026 | Use it inside real connector providers with pooled async clients. |

Release sources: [Google ADK](https://pypi.org/project/google-adk/2.9.0/), [MLflow](https://pypi.org/project/mlflow/), [HTTPX2](https://pypi.org/project/httpx2/). Search indexing initially lagged the ADK release; the explicit 2.9.0 release page and local installation agree.

The environment also contains `httpx==0.28.1`, required transitively. HTTPX2 is a separate package, not simply the HTTP/2 switch for HTTPX. Both can coexist, but their client/transport/response objects are not interchangeable. Keep SDK-owned HTTPX clients intact. HTTP/2 requires the HTTPX2 extra and explicit enablement, and should be enabled for a measured need. [Migration guidance](https://pydantic.dev/docs/httpx2/get-started/migration/), [HTTP/2 guidance](https://pydantic.dev/docs/httpx2/guides/http2/).

## Prioritized findings

P0 means a release blocker. P1 means a high-priority correctness or production gap. Some defects are currently masked by simulated execution; these are identified explicitly.

### 1. P0 — The API returns fabricated success

[the earlier runner implementation](../app/runtime/runner.py) never called `run_async`. This finding describes the original prototype; the current execution path is documented in the [harness guide](harness.md).

Verified: a request about an unrelated DNS incident returned `SUCCEEDED` with the CheckoutService database diagnosis.

Correction: make demo mode explicit and visibly label synthetic results. The production path must create/load an authorized session, invoke ADK, consume events, capture errors, and return validated output from the actual run. Missing credentials or evidence must produce an unavailable/failed/insufficient-evidence outcome, never an invented successful diagnosis.

### 2. P0 — Callers grant themselves permissions

[the original API boundary] accepted identity, roles, tenant, and project from request JSON. The current boundary is [app/api/application.py](../app/api/application.py) and derives identity from verified authentication and server membership.

Verified using the in-process API client: `PROJECT_VIEWER` returned 403; changing only the self-declared role to `PLATFORM_ADMIN` returned 200. No authentication header was supplied.

Correction: authenticate at the gateway, derive a server-owned principal from verified identity and membership, and authorize the requested project separately. Scope capability and connector-health listings too; keep public liveness minimal.

### 3. P0 — Policy, redaction, and write interception are disconnected

[the original runner and tool boundary] did not enforce policy or redaction. The current read-only implementation is documented in [governance](../app/runtime/governance.py) and [typed tools](../app/tools/domain/).

Current exposure is limited by mock providers and the comment tool not being attached to the current root graph. These gaps become dangerous when providers or real execution are enabled.

Correction: enforce one shared policy boundary around every tool invocation, with trusted scope, explicit side-effect metadata, output filtering, and fail-closed handling. Shadow mode must intercept writes before entering providers. Keep mutation tools disabled until durable approval, expiry, approver authorization, exact-argument binding, and replay prevention are tested.

### 4. P1 — Tenant isolation and action permissions are incomplete

[the original policy engine] did not fully enforce tenant and action boundaries. The maintained scope and policy rules are described in the [security model](security-model.md) and [current policy engine](../app/policy/engine.py).

Correction: validate tenant membership and project/resource scope first, then action permission, then approval requirements. Use explicit role-to-permission sets instead of treating all roles as a single numeric ladder. Any intentional administrative cross-tenant operation needs a separate explicit audited permission.

### 5. P1 — YAML permissions are silently discarded

The original capability parser did not fully honor nested permission data. The current strict schema is [app/capabilities/models.py](../app/capabilities/models.py), with resolution described in the [capability lifecycle](harness.md#4-capability-lifecycle).

Verified: `database_rca` loads with `PROJECT_ANALYST` and an empty allow-list despite its manifest. Changing the manifest's nested minimum role would not change the effective default.

Correction: match the schema to the YAML, reject unknown fields, constrain safety values with enums/literals, and test effective authorization from actual manifest fixtures. Fail startup on duplicate IDs, unresolved references, or invalid configuration.

### 6. P1 — Capabilities do not govern execution

[the original capability resolver] did not fully bind readiness to execution. The current resolver and run preflight are described in the [capability lifecycle](harness.md#4-capability-lifecycle).

Correction: resolve a validated snapshot containing the permitted tools, applicable workflow, effective model configuration, and connector readiness. Required failures block; optional failures yield a visible partial result. Only expose implemented capabilities. Use simple explicit capability-to-workflow mappings before building a general dynamic planner.

### 7. P1 — Connector health and data are simulated

[the original connector providers] returned fixtures. The current provider boundary and health lifecycle are documented in [connector onboarding](connector-onboarding.md) and implemented under [app/connectors/providers](../app/connectors/providers/).

Correction: clearly separate test providers. In real providers, own credentials and a reusable async HTTPX2 client within application lifespan; close it on shutdown. Set connect/read/write/pool timeouts, pool limits, response-size limits, and bounded result pagination. Retry only appropriate failures and idempotent operations; honor rate limits. Health probes must be bounded, authenticated, and operation-specific. Inject the same scoped provider instances into health checks and tools. [Official async client guidance](https://pydantic.dev/docs/httpx2/guides/async/).

### 8. P1 — The SQL guard does not establish read-only safety

[the original database tool] used a superficial read-only check. Database querying remains disabled; see the [database capability](../blob_local/platform/capabilities/database_rca.yaml).

Correction: prefer granular diagnostic tools such as lock/session inspection backed by fixed parameterized queries. Use least-privilege read-only database credentials, server-enforced read-only transactions where supported, resource-scoped views, and statement/result limits. If arbitrary SQL is necessary, validate dialect-specific single-statement semantics as defense in depth. Keep database I/O inside a provider.

### 9. P1 — Evidence and contracts are neither immutable nor durable

[the original evidence store] was process-local. The maintained evidence and run-contract paths are [app/persistence/store.py](../app/persistence/store.py) and [app/runtime/run_contract.py](../app/runtime/run_contract.py).

Correction: persist server-computed evidence hashes and provenance, enforce tenant/run ownership at retrieval, reject conflicting overwrites, and verify report citations against saved evidence. Bind runs to canonical capability/skill/policy content hashes and the actual effective model configuration. Freezing a Pydantic model alone does not freeze nested lists/dicts; persist an immutable serialized snapshot. Add signing only with a defined signer/verifier trust boundary. Use ADK's persistent session service rather than inventing another conversation store. [ADK session services](https://adk.dev/sessions/session/).

### 10. P1 — Observability does not record the advertised information

[the original telemetry adapter] was incomplete. Current telemetry behavior and its live-mode boundary are documented in [operations](operations.md).

Correction: configure one tracer provider during startup and export ADK spans using OTLP to MLflow's `/v1/traces`, with the experiment ID header and a SQL-backed tracking server. Prefer batched production export, bounded shutdown flush, and visible export-failure metrics. Correlate run/session/capability IDs and redact payloads before export. Do not infer SDK autologging from package installation: MLflow's documented ADK integration uses OpenTelemetry. [Official integration](https://mlflow.org/docs/latest/genai/tracing/integrations/listing/google-adk/).

### 11. P1 — Tests cannot establish correctness

The original test harness could not establish correctness. Current verification commands and fixture boundaries are documented in [operations](operations.md) and the repository `tests/` tree.

Correction: declare development dependencies, repair imports and entrypoints, then use fake ADK model responses and mock transports to test the actual pipeline without credentials. Add focused tests for forged identity, tenant boundaries, manifest parsing, tool policy interception, partial connector failure, evidence ownership, invalid citations, cancellation, and run limits. Add replay/expiry tests when writes are introduced. CI should run these plus import/lint checks and a container startup check.

For quality, build a small incident dataset covering temporal anchors, conflicting evidence, unknown causes, and prompt injection in logs/tickets. Measure evidence grounding, citation validity, tool correctness, abstention, latency, and cost. Use native ADK evaluation and/or `mlflow.genai.evaluate` with deterministic custom checks and selected model judges; security authorization must remain deterministic. [MLflow evaluation quickstart](https://mlflow.org/docs/latest/genai/eval-monitor/quickstart/).

### 12. P1 — Container and developer entrypoints are broken or unsafe

[the original Dockerfile](../Dockerfile) copied too much of the workspace. The current container and environment boundary should be checked against the repository `.dockerignore` and deployment configuration.

Compose references nonexistent API and worker Dockerfiles. The Makefile points to absent `apps.*` modules and an absent evaluation script. The deployment manifest references `app.agent:app`, but that module only exports `root_agent` and `agent`. Compose's fixed database healthcheck identity also disagrees with the example environment overrides.

Correction: establish one working API entrypoint and one container first. Exclude secrets, `.git`, and host environments from build context; ignore local environment files in Git while retaining the template. Use a non-root runtime, reproducible dependency installation, and immutable production startup. Keep local database services private and repair healthcheck configuration. Remove the worker definition until there is an actual durable worker implementation.

## Simplification recommendations

1. Keep FastAPI, native ADK agents/tools, the capability resolver, provider boundaries, and explicit policy checks. Avoid a replacement orchestration framework.
2. Start with one complete read-only capability and one deployed service. Add a worker only when durable long-running execution or operational limits require it; do not rely on in-process background tasks for durable jobs.
3. Keep the current SequentialAgent/ParallelAgent design until measured needs justify ADK's newer graph workflow features. Consider merging synthesis and remediation drafting into one structured final response. Use deterministic connector calls where no model reasoning is needed.
4. Use Postgres for durable run/evidence/application records and an ADK-supported session backend. Defer Redis, vector search, optimization subsystems, and multiple deployment targets until they have a concrete workload.
5. Consolidate empty duplicate trees: top-level `observability/` versus `app/observability/`, `persistence/` versus `app/state/`, multiple migration locations, and unused optimization/knowledge scaffolding. An empty directory is not an implemented capability. The unused `observability/langsmith/` is misleading for the chosen MLflow architecture.
6. Remove unused direct dependencies such as LiteLLM unless provider routing is actually required. Declare imports the application relies on directly—FastAPI, Pydantic, PyYAML, Uvicorn, and the OTel SDK—instead of relying on transitive installation. Preserve the lockfile and validate upgrades deliberately.
7. Load settings once. Make capability versions, model profiles, provider instances, and budgets have one effective source of truth. Do not leave configuration that appears enforced but is ignored.
8. Update documentation to separate working behavior from planned behavior, especially signed contracts, hot-loaded skills, mutation halt, durable evidence, WebSockets, and production deployment support.

## Upstream examples reviewed and how to apply them

| Official example or guide | Relevant lesson | Application here |
|---|---|---|
| [ADK parallel-functions source](https://raw.githubusercontent.com/google/adk-python/main/contributing/samples/parallel_functions/agent.py) | Async tool functions yield during I/O; the example itself uses mock data. | Use async provider methods and await them in tools; do not copy its synthetic-data behavior into production. |
| [ADK workflow-triage sample](https://github.com/google/adk-python/blob/main/contributing/samples/patterns/workflow_triage/README.md) | Relevant workers are selected/skipped; outputs have explicit state keys. | Gate optional investigations with validated capability/readiness state; avoid running every investigator for every capability. The README was reviewed, not the complete sample implementation. |
| [ADK parallel research and synthesis example](https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/) | Branch outputs are written to separate keys and explicitly consumed by synthesis. | Define `triage_result`, `log_evidence`, and `database_evidence`, then feed them into a structured final result. Current agents have no `output_key`; test actual event/state flow rather than assuming all branch evidence reaches synthesis correctly. |
| [ADK action-confirmation examples](https://adk.dev/tools-custom/confirmation/) | Native confirmation exists but is experimental; the current guide lists DatabaseSessionService and VertexAiSessionService as unsupported. | Do not assume confirmation plus persistent sessions works merely because each feature exists. Validate the exact 2.9.0 combination; keep writes disabled or use a durable application approval boundary until proven. |
| [ADK callback patterns](https://adk.dev/callbacks/design-patterns-and-best-practices/) | Callbacks support interception and transformation. | Centralize policy and redaction through native interception hooks, covering every registered tool and output path. |

Upstream `main` examples evolve independently of releases. Adapt against the locked package and add compatibility checks; examples demonstrate patterns, not this platform's tenant security or durability. The old standalone human-tool-confirmation source URL was unavailable, so confirmation guidance above is based on the official current documentation.

## Backend preparation for the later frontend

No frontend build is needed now. First stabilize typed, authorized APIs for identity/project selection, enabled capabilities, creating and inspecting runs, run history, evidence retrieval, and connector readiness. Represent queued/running/succeeded/partial/failed/cancelled states and explicit insufficient-evidence outcomes. Return structured findings with evidence IDs, uncertainty, and safe next steps rather than one unstructured string.

Once execution is genuinely long-running, provide durable run IDs, cancellation, retry/idempotency semantics, and resumable progress events. SSE is a reasonable initial choice for one-way progress; WebSockets are unnecessary unless bidirectional real-time behavior is required. Add approval APIs only alongside a tested write workflow. Choose CORS/session/CSRF behavior when the frontend hosting and authentication design is known.

## Recommended implementation order and exit checks

1. **Make the prototype honest and safe:** explicit demo mode, no fabricated production success, authenticated identity, correct manifest schema, enforced tenant/project checks, repaired tests and container exclusions. Exit: forged identity fails and fixtures cannot be returned as real evidence.
2. **Complete one read-only investigation:** real scoped providers, actual ADK execution, explicit state handoff, persistent sessions/evidence, grounded output. Exit: a fixture-backed end-to-end run invokes tools and resolves every citation; unavailable connectors return an honest partial/blocked result.
3. **Make it operable:** OTel-to-MLflow tracing, bounded execution and concurrency, cancellation, readiness, durable run status, tested container/CI, incident evaluation set. Exit: failures are observable and process restarts do not lose durable run/evidence records.
4. **Build the frontend against those contracts.** Introduce mutative remediation only after durable approval and replay protection pass their own checks.

## Verification record and limits

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
