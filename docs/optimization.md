# Prompt and skill optimization

The backend supports an explicit evaluate → review → activate cycle. It uses native MLflow `genai.optimize_prompts`, Prompt Registry and `genai.evaluate`, with a native ADK reflection agent. No LangChain dependency is introduced. One job revises one prompt or one skill body; skill frontmatter, tools, capabilities and policies stay outside the optimizer's authority.

## Storage and write-back

`blob_local/platform` holds the shipped baseline. Dataset bodies and complete evaluated content bundles are immutable, hash-addressed blobs under `RCA_OPTIMIZATION_BLOB_URI` (default `blob_local/optimizations`; GCS is also supported). The application database stores scoped dataset metadata, optimization/review records and the active bundle pointer. MLflow stores prompt versions, evaluation runs, traces, metrics and comparison artifacts in `RCA_OPTIMIZATION_TRACKING_URI`.

Approval atomically moves the tenant/project pointer to the evaluated bundle. Every subsequent investigation reads that bundle and saves its revision, prompt snapshot and skill hashes in its immutable run contract. Existing investigations keep their snapshots. Baseline files are not overwritten. Changing platform files or approved agent definitions invalidates pending approvals; platform changes require restart and re-evaluation. The database is authoritative for approval state; MLflow's `evaluation_status` tag describes the evaluation result at completion.

## Benchmark and decision

Start with `blob_local/platform/evaluation/datasets/rca-example.json` as a format example. It is synthetic and has purpose `example`, which always blocks activation. A benchmark should contain sanitized, resolved incidents with recorded tickets, logs and attachment text, reviewed expected facts, and expected outcomes. Separate training and held-out incidents; use distinct incidents from different failure families, include insufficient-evidence cases, and reserve fresh incidents for future evaluations. Exact duplicate cases are rejected, but curators must detect near duplicates and avoid tuning repeatedly against the same holdout.

The reflection model receives training feedback only. Baseline and candidate each run through the actual ADK investigation pipeline on repeated held-out cases. Replay connectors serve recorded evidence without live network calls. Log replay returns the recorded case logs; this evaluates reasoning over supplied evidence, not production search retrieval accuracy. A separate judge scores correctness, groundedness and safety; deterministic checks cover outcome and citation integrity. Judge scores remain estimates that require human inspection.

Defaults in `blob_local/platform/config/optimization.yaml` require at least 3 training and 5 held-out cases, with 2 held-out repetitions. Approval eligibility requires quality ≥ 0.8, quality gain ≥ 0.02, all safety/citation/outcome checks passing, no case quality drop above 0.1, latency ≤ 1.5× baseline and token usage ≤ 1.25× baseline. Missing token usage blocks qualification. These are initial operational gates, not statistically validated claims. Inspect individual cases and calibrate the judge against human labels before trusting production comparisons. Injected test models and example data can never qualify.

## API workflow

Use an authenticated project owner/author to register a dataset:

```sh
curl -X POST "$API/api/v1/optimization-datasets" \
  -H "Authorization: Bearer $AUTHOR_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @blob_local/platform/evaluation/datasets/rca-example.json
```

Start a comparison (this request waits for completion):

```sh
curl -X POST "$API/api/v1/optimizations" \
  -H "Authorization: Bearer $AUTHOR_TOKEN" -H 'Content-Type: application/json' \
  --data '{"dataset_id":"rca-example","dataset_version":"1.0.0","target_kind":"prompt","target_name":"synthesis"}'
```

Use the registered dataset's actual ID/version. For a skill, use `target_kind: "skill"` and `target_name: "incident-triage"`. Model credentials must be configured. Jobs have explicit time and model-call budgets; only one optimization runs per API process. They are request-bound, not a durable background queue. After a process failure, expired RUNNING records become FAILED on inspection; submit another comparison explicitly.

`GET /api/v1/optimizations` lists scoped history. `GET /api/v1/optimizations/{id}` returns the review state, immutable report hash, exact instruction diff, before/after metrics, case details, gating reasons, model/config snapshots, and MLflow run/version IDs. The report is the reviewable result; frontend work remains separate.

A different administrator may approve a passing `PENDING_APPROVAL` record:

```sh
curl -X POST "$API/api/v1/optimizations/$OPTIMIZATION_ID/approve" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" -H 'Content-Type: application/json' \
  --data '{"expected_hash":"sha256:REPLACE_WITH_REPORT_HASH","reason":"Reviewed held-out evidence and regressions"}'
```

Use `/reject` with the same body to reject. Authors cannot review their own revision. Hash mismatches, stale parent revisions and changed runtime context fail closed. NO_IMPROVEMENT and FAILED records cannot be approved. Rejection does not change active content.

## Inspect in MLflow

For the default local tracking database, run from the project directory:

```sh
uv run mlflow ui --backend-store-uri sqlite:///./data/optimization-mlflow.db --host 127.0.0.1 --port 5000
```

Open the project experiment and the run ID returned by the API. Inspect the held-out baseline/candidate evaluation runs, `comparison.json`, `instruction.diff`, quality metrics, usage and prompt versions. Preserve the MLflow artifact store as well as the tracking database. For remote deployments, configure an authenticated MLflow server and its durable artifact store. Project experiment naming is organizational separation; MLflow access control must independently restrict who can inspect evidence and traces. API role checks do not secure a separately exposed MLflow server.

No real quality improvement is claimed from the offline fixture tests. They verify the integration, comparison rules, approval restrictions, and use of approved content in subsequent ADK runs.
