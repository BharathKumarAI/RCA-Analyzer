---
id: incident-triage
version: 2.1.0
summary: Triage incident reports, extract temporal anchors, and map to responsible application teams.
category: triage
entrypoints:
  - extract_anchor
  - classify_severity
  - recommend_routing
required_tools:
  - itsm.get_ticket
forbidden_tools:
  - itsm.delete_ticket
input_schema: IncidentContext
output_schema: TriageResult
status: approved
---

# Incident Triage Skill

## Workflow

1. **Extract Temporal Anchor**:
   - Resolve explicit incident timestamps from summary or stack traces.
   - Use confidence prioritization: `explicit_incident_timestamp` (1.0) > `transaction_timestamp` (0.95) > `trace_error_timestamp` (0.90) > `reported_time` (0.85) > `ticket_created` (0.70).

2. **Determine Affected Scope**:
   - Identify affected environment (e.g. `QLAB01`, `PLAB01`) and component tags.

3. **Formulate Initial Hypotheses**:
   - Produce prioritized list of candidate root causes for downstream parallel investigation.
