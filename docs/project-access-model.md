# Project access and personal experimentation

Project Viewer and Project Manager can start bounded, read-only Jira/Splunk triage,
ticket review, incident timeline, log correlation, and attachment review, upload
analysis inputs, and read project runs, live events, evidence, metrics, and
available evaluation feedback. They cannot change configuration, membership,
knowledge, feedback, connector settings, or external systems. Analysis creation
necessarily persists its run, input, and result; it does not grant configuration
or external mutation rights. Owners and platform administrators retain project
management. Existing analyst permissions remain in place. Roles combine
additively; adding Generic User does not remove an existing project membership.

The boundary runs before request-body and upload parsing. Operation-specific
endpoint and service checks continue to apply. Project capabilities remain
explicit YAML allowlists; project policy can narrow the platform baseline.
An empty allowlist denies execution. External tool mutations remain disabled
for every role.

Sources: [HTTP boundary](../app/api/application.py),
[access policy](../app/policy/access.py), [authoring permissions](../app/configuration/service.py),
[capability policy](../blob_local/platform/capabilities/incident_triage.yaml),
[resolver](../app/capabilities/resolver.py), [tool policy](../app/policy/engine.py).

## Generic User

A generic-only identity has no project access. JWT verification and server-side
membership checks still apply; request bodies never choose identity or scope.
The authenticated principal has no project ID, and `/api/v1/me` does not return
project or tenant identifiers for this identity. The tenant remains internal to
isolate personal records between organizations. Generic-only identities may be
configured with an empty project ID. Existing generic memberships remain valid.

Allowed APIs:

| API | Behavior |
| --- | --- |
| `GET /api/v1/me` | Own identity and roles |
| `GET /api/v1/access` | Server-computed access flags |
| `GET /api/v1/playground/capabilities` | Available personal capabilities and local tools |
| `POST /api/v1/playground/tools/generic.text_metrics` | Measure supplied `text` without model access |
| `POST /api/v1/playground/tools/generic.inspect_json` | Validate supplied JSON `text` without model access |
| `POST /api/v1/playground/runs` | Run a personal experiment with `prompt` and optional `capability` |
| `GET /api/v1/playground/runs` | Own experiment history; bounded `limit` |
| `GET /api/v1/playground/runs/{run_id}` | Own experiment result |

All project APIs, including project health, knowledge, tools, notifications,
configuration, and run history, reject generic-only identities. Personal results
use a separate SQL table and native ADK application/session namespace. Other
users, including administrators, cannot read them through the playground APIs.
Project run counts and history do not include personal experiments.

The initial text-review capability uses real local text/JSON tools and a native
ADK LlmAgent/Runner using the existing fast-investigation model profile. It gets
only user-supplied text and its local tools: no project overrides, project
prompts, skills, connectors, credentials, knowledge, attachments, or sessions.
Model calls require configured model access even when project mode is demo;
there is no simulated success fallback. Direct local-tool calls need no model.
Input, context, model calls, tool calls, concurrency, and request duration are
bounded. Model failures return a persisted failure without raw exception details.

Sources: [identity](../app/identity/auth.py), [API](../app/api/routes/playground.py),
[execution and persistence](../app/runtime/playground.py),
[local tools](../app/tools/domain/generic.py),
[declarative capability](../blob_local/platform/capabilities/playground/text_review.yaml).

## Deployment and limits

Apply migration 017 before starting the new backend against PostgreSQL. For
SQLite development, startup creates the personal experiment table. Publish the
updated capability manifests and personal capability through the versioned
configuration bundle when database configuration is enabled; repository YAML is
only a deployment template. Preserve any deliberate project-level restrictions.

There is no background recovery worker. Request cancellation is terminal, and
an expired unfinished experiment is reported as interrupted. Manual retention
cleanup removes expired personal records and their native ADK sessions alongside
existing project cleanup. Backend playground APIs are available; a dedicated
playground frontend is not included in this change. This change grants read
access to existing project data APIs, not a new feedback product.

Sources: [migration](../migrations/017_playground_runs.sql),
[bundle export](../app/optimization/content.py), [cleanup](../scripts/cleanup.py),
[boundary regressions](../tests/integration/test_project_role_boundaries.py).
