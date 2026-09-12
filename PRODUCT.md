# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Site Reliability Engineers (SREs), on-call incident responders, DevOps engineers, and platform administrators investigating or reviewing production outages and system alerts.

## Product Purpose

Deliver bounded, evidence-grounded root cause analysis. RCA Analyzer synthesizes incident tickets, telemetry logs, and diagnostic attachments into verifiable incident timelines, correlated findings, and actionable remediation proposals without model hallucination.

## Positioning

Strict evidence grounding powered by Google ADK native workflows, read-only connectors (Jira, Splunk), and local attachment parsing. Unlike open-ended chat assistants, every diagnosis must be supported by cryptographic evidence hashes, validated citations, and strict deployment-scoped authorization.

## Operating Context

Web-based incident workspace and administrative dashboard (`/admin/`), incident response bridges, Jira ticket workflows, Splunk log analytics, and post-incident review (post-mortem) generation.

## Capabilities and Constraints

- **Confirmed Capabilities**: Incident triage, log correlation, ticket review, incident timeline generation, and local attachment review.
- **Connectors**: Read-only Jira and Splunk providers. Database connector queries and external write capabilities are currently disabled.
- **Security Boundaries**: Single tenant/project scope enforced via `RCA_TENANT_ID` and `RCA_PROJECT_ID`. Request-level role tampering is rejected; authentication requires verified RS256 JWT signatures.
- **File Processing**: Local-only, bounded file extraction. Images are limited to local OCR text extraction (no visual scene reasoning). Remote URL fetches, macros, and arbitrary code execution are prohibited.

## Brand Commitments

- High-density SRE/observability design aesthetic: focused, dark-mode first, monospace code/telemetry treatments, clear visual hierarchy.
- Direct evidence citations: prominent source badges, event hashes, and audit trails.

## Evidence on Hand

- Declarative capability manifests in `blob_local/platform/capabilities/`.
- Full React 19 + TypeScript + Vite frontend in `frontend/`.
- Platform configuration snapshots, connectors, and database migrations in `app/` and `migrations/`.
- Offline MLflow fixture evaluation and ADK runner smoke tests.

## Product Principles

1. **Evidence before assertion**: Every root-cause claim must cite verifiable connector or attachment evidence.
2. **Operational speed & scanability**: High-pressure incident responders need dense, scannable data layouts and zero decorative friction.
3. **Strict perimeter isolation**: Maintain read-only connector boundaries and immutable audit trails across all tenant sessions.
4. **Transparent boundaries**: Explicitly surface ingestion limits, connector timeouts, and uncertainty rather than guessing.
