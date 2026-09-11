# ADK agent entrypoint

`agents/rca_analyzer/` is the Google ADK-compatible development entrypoint. It exports `root_agent` from `agent.py` so ADK CLI commands can inspect the package. It is intentionally inert: the authenticated API assembles the governed runtime graph in `app/agents/root.py`.

Run the RCA Analyzer agent locally with:

```bash
adk run agents/rca_analyzer
adk web agents/rca_analyzer
```

For the real harness lifecycle, use [docs/harness.md](../docs/harness.md). The entrypoint does not receive deployment credentials, create live connectors, or produce a diagnosis by itself.
