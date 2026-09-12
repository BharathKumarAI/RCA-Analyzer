---
id: incident-timeline
version: 1.0.0
summary: Build an incident timeline from Jira facts and optional bounded Splunk observations.
category: investigation
entrypoints:
  - collect_anchors
  - correlate_observations
required_tools:
  - itsm.get_ticket
optional_tools:
  - log_search.query_range
forbidden_tools:
  - itsm.add_comment
  - itsm.delete_ticket
input_schema: IncidentTimelineContext
output_schema: IncidentTimelineResult
status: approved
---

# Incident Timeline Skill

## Workflow

1. Retrieve the Jira ticket and record explicit incident, transaction, error, reported, and creation timestamps with their source.
2. Use the ticket's bounded time window to query Splunk only when the connector is available and the request needs log correlation.
3. Order observations by timestamp, label each source, and distinguish direct evidence from correlation.
4. Cite actual evidence IDs and report gaps, truncation, or unavailable optional log data.
5. Do not modify Jira, widen connector query bounds, or invent events.
