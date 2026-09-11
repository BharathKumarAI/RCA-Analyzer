---
id: log-correlation
version: 1.5.0
summary: Correlate structured logs and detect error rate spikes within incident time windows.
category: investigation
entrypoints:
  - query_window
  - extract_stack_traces
required_tools:
  - log_search.query_range
forbidden_tools:
  - logs.delete_index
input_schema: IncidentTimeWindow
output_schema: LogEvidenceBundle
status: approved
---

# Log Correlation Skill

## Workflow

1. **Query Window Definition**:
   - Use the configured lookback and the connector’s bounded read-only query window. Record the actual window; do not imply an historical anchor was queried if the tool used a relative lookback.
2. **Filter & Group**:
   - Group by HTTP status codes (5xx), exception names, and service instances.
3. **Evidence Bounds**:
   - The runtime records redacted, bounded evidence. Cite those evidence IDs and report truncation or missing data. Do not invent an artifact reference.
