# Project configuration

This is the legacy flat layer location. For new projects, use the [separate project initializer](../../../projects/README.md) and edit its generated `configuration/project.yaml`. Legacy files remain readable. Filenames do not grant scope: exact `tenant_id` and `project_id` select the layer. Files are data only, limited to 64 KiB, validated at startup, and excluded from Git and the container build. Mount the complete bundle read-only and restart after changes.

```yaml
tenant_id: acme
project_id: payments
capabilities:
  incident_triage:
    model_profile: fast-investigation
    allowed_actions: [itsm.get_ticket]
    allowed_roles: [PLATFORM_ADMIN, PROJECT_OWNER, PROJECT_ANALYST]
  log_correlation:
    enabled: false
disabled_connectors: [log_search]
limits:
  max_llm_calls: 6
  max_tool_calls: 2
  run_timeout_seconds: 60
  max_context_chars: 32000
workflow:
  planning: true
  attachments: true
  specialists: true
  parallel_evidence: false
prompts:
  synthesis: "Summarize captured evidence with citations and uncertainty. Propose verification steps only."
preferences:
  presentation: table
  detail: concise
allow_user_preferences: [presentation]
allow_user_overrides: [incident-triage]
skills:
  incident-triage:
    instruction: "Resolve the incident anchor and identify the owning payments team. Cite captured evidence."
    actions: [itsm.get_ticket]
```

[Platform policy](../platform.yaml) delegates sections, model-profile choices, skill overrides and user preference fields. Limits use the smaller of platform and project values. A project cannot enable a disabled platform capability, expand roles/actions, create a new connector, change a model ID, alter security or supply credentials. Custom agents still require the [separate approval lifecycle](../../../../docs/skill-lifecycle.md).

See the [application architecture and ownership matrix](../../../../docs/architecture.md#configuration-ownership-and-inheritance).
