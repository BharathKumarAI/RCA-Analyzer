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
