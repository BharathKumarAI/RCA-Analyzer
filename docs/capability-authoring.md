# Capability authoring

Capabilities are YAML contracts in [capabilities](../blob_local/platform/capabilities). A capability names its skills, minimum role, required/optional connectors, safety profile, and stage model profile.

```yaml
id: incident_triage
version: 2.1.0
enabled: true
name: "Incident Triage & Anchor Resolution"
description: "Ingests incident reports, extracts temporal anchors, classifies severity, and maps to owning teams."
category: triage

skills:
  - incident-triage
  - log-correlation

requires:
  connectors:
    - itsm

optional:
  connectors:
    - log_search

permissions:
  minimum_role: PROJECT_ANALYST
  allowed_roles:
    - PLATFORM_ADMIN
    - PROJECT_OWNER
    - PROJECT_MANAGER
    - PROJECT_ANALYST
  allowed_actions:
    - itsm.get_ticket
    - log_search.query_range

safety_profile:
  tool_mutations: approval_required
  pii_access: project_scoped
  raw_payload_access: restricted
  external_network: connector_allowlist

model_profile: balanced-investigation
```

Keep required connectors limited to services the workflow actually needs. A missing required connector blocks the run; an unavailable optional connector permits partial progress. Capability resolution does not grant identity: authentication and deployment tenant/project scope are checked separately.

Platform manifests define the maximum capability contract. A project can disable the capability, remove actions, reduce allowed roles, or choose a delegated model profile; it cannot add actions, roles, connectors, or models. Users cannot change capability selection. The complete platform → project → user selection matrix is in the [harness guide](harness.md#selection-rules-by-harness-element).

Validate changes with `make lint`, `make test`, and `make smoke`.


Skill-to-tool bindings and override permissions live in [platform skill policy](../blob_local/platform/layers/platform.yaml). The [inheritance resolver](skill-inheritance.md) intersects these with capability actions before ADK assembly.

## Platform capability matrix

The following enabled capabilities are the platform catalog. The YAML manifests are the source of truth; the API projection is implemented by [`app/api/routes/catalog.py`](../app/api/routes/catalog.py), and approved project specialists appear under each capability's `agent_bindings` field.

| Capability | Source agents | Required connector | Optional connector | Actions | Dedicated attachment agent |
| --- | --- | --- | --- | --- | --- |
| `ticket_review` | `triage` ([`triage.py`](../app/agents/triage.py)) | `itsm` (Jira) | — | `itsm.get_ticket` | No |
| `incident_timeline` | `triage`, `logs` ([`triage.py`](../app/agents/triage.py), [`evidence_acquisition.py`](../app/agents/workflows/evidence_acquisition.py)) | `itsm` (Jira) | `log_search` (Splunk) | `itsm.get_ticket`, `log_search.query_range` | No |
| `attachment_review` | `file` ([`evidence_acquisition.py`](../app/agents/workflows/evidence_acquisition.py)) | — | — | — | Yes (local attachments) |
| `incident_triage` | `triage`, `logs`, `file` ([`triage.py`](../app/agents/triage.py), [`evidence_acquisition.py`](../app/agents/workflows/evidence_acquisition.py)) | `itsm` (Jira) | `log_search` (Splunk) | `itsm.get_ticket`, `log_search.query_range` | Yes (workflow dependent) |
| `log_correlation` | `logs`, `file` ([`evidence_acquisition.py`](../app/agents/workflows/evidence_acquisition.py)) | `log_search` (Splunk) | `itsm` (Jira) | `log_search.query_range` | Yes (workflow dependent) |

The manifests for these contracts live in [`blob_local/platform/capabilities`](../blob_local/platform/capabilities). `database_rca` remains disabled because its `database_query` connector and `database.query_readonly` action are not implemented.

`agent_stages` selects the native source branches in [`root.py`](../app/agents/root.py); planning and synthesis remain shared workflow stages. Source branches still require their permitted tool actions, declared connectors, and enabled model stages. Supplied attachments can contribute captured evidence to synthesis even when a dedicated file agent is not selected.

Catalog specialist bindings describe configuration eligibility, not a successful live health probe. [`runner.py`](../app/runtime/runner.py) checks connector health before each live run. Demo runs do not invoke connectors or models.
