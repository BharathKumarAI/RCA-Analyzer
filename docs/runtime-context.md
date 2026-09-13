# Runtime context and tool lifecycle

The harness continues to execute through native ADK. It does not add another agent runtime, a recovery worker, or executable extensions.

## Evidence capacity and tool events

[RunGovernance](../app/runtime/governance.py) reserves evidence capacity before awaiting persistence. Concurrent source branches share the same per-run item limit; failed and cancelled saves release their reservations. Connector requests remain concurrent.

A `tool_completed` event follows successful evidence persistence and includes the recorded evidence ID. Handled connector errors emit a correlated `tool_failed` event, without raw exception text. Run cleanup finalizes outstanding calls as failed or cancelled. Terminal events carry the original call ID and elapsed time. These events depend on the trace database being available; they do not constitute a crash-recovery contract.

## Complete request budget

[Context projection](../app/runtime/context.py) checks the serialized character count of ADK contents and generation configuration, including instructions, history, tool declarations, and the response schema. [BoundedModel](../app/models/bounded.py) applies this check before invoking the model. `max_context_chars` is a character budget, not a provider token estimate or an output-token budget.

The [agent builder](../app/agents/root.py) uses server-owned placeholders for evidence and attachment context. At the model boundary, the harness fills the available space with deterministically ordered evidence, rotating among sources before expanding excerpts. Evidence IDs and source labels remain attached. The stored evidence is unchanged. Context selection events record selected IDs, omission counts, and truncation; truncated projections make the final assessment partial.

Required instructions, user content, stage notes, and existing tool-call history are never silently cut. If these inputs and the required metadata cannot fit, the run fails with stage `context_limit` before that model invocation. This release uses bounded excerpts, not semantic ranking or model-generated compaction. Extremely small limits can omit all evidence.

## Follow-up context

[The store](../app/persistence/store.py) selects up to three recently completed runs from the same owner's chat. Historical notes are eligible only when capability identity/hash, policy hash, permitted actions, disabled connectors, environment mappings, and workflow settings match. Runs completed after the new run started are excluded.

The history is bounded to one quarter of the context character limit and contains the prior request, summary, timestamp, status, and run ID. [The runner](../app/runtime/runner.py) freezes the selected notes into the run snapshot. The full model request still has to satisfy the overall context limit.

Historical notes are untrusted and potentially stale. They help interpret follow-up questions but do not count as newly captured evidence. Findings still require evidence IDs persisted for the current run; prior citations are not imported. Requests to rerun an investigation must retrieve supporting observations again.

## Verification

[Runtime regression tests](../tests/unit/test_runtime_governance.py) exercise real SQLite persistence and native ADK request objects for capacity, tool finalization, context projection, and chat ownership. The existing offline harness and smoke suites exercise native ADK workflows with the repository's test providers. These checks do not measure live model quality.
