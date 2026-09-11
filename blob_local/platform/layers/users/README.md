# User configuration

This is the legacy flat layer location. For new projects, use the [separate project initializer](../../../projects/README.md) and edit its generated `configuration/users/<subject-key>.yaml`. Legacy files remain readable. `subject` must match server-side membership. Files are deployment configuration, limited to 64 KiB, excluded from Git and container builds, and loaded at startup. They are not an end-user upload API.

```yaml
tenant_id: acme
project_id: payments
subject: analyst
preferences:
  presentation: timeline
skills:
  incident-triage:
    instruction: "Identify the incident anchor and owning team. Use concise UTC timelines and cite captured evidence."
    actions: [itsm.get_ticket]
```

The matching [project example](../projects/README.md) explicitly delegates `presentation` and `incident-triage`. User preferences guide model instructions; they do not change tools or the server's workflow graph. A user cannot change capability enablement, roles, connector access, model profiles, budgets, workflow controls or stage prompts. Skill action restrictions accumulate; project denials cannot be restored.

No credentials, API keys or executable imports belong here. See the [application ownership matrix](../../../../docs/architecture.md#configuration-ownership-and-inheritance).
