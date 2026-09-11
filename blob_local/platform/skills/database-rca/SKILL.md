---
id: database-rca
version: 1.4.0
summary: Diagnose read-only database latency, lock contention, and active transaction regressions.
category: investigation
entrypoints:
  - inspect_locks
  - analyze_slow_queries
required_tools:
  - database.query_readonly
forbidden_tools:
  - database.execute_write
input_schema: DatabaseIncidentContext
output_schema: DatabaseEvidenceBundle
status: approved
---

# Database RCA Skill

## Workflow

1. **Lock Contention**:
   - Inspect active session locks and blocking transaction IDs during the incident window.
2. **Slow Query Plan Analysis**:
   - Identify queries exceeding latency thresholds (e.g. >2000ms).
3. **Evidence Citations**:
   - Record exact query hash and execution metrics in the evidence ledger.
