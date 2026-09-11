# Security model

Authentication runs before file upload and run creation. In live mode, the service verifies an RS256 JWT's signature, issuer, audience, expiry, and subject membership. The subject maps through `RCA_PRINCIPALS_JSON` to a server-side principal.

A deployment has one tenant/project boundary from `RCA_TENANT_ID` and `RCA_PROJECT_ID`. Roles and connector scope come from server configuration and capability YAML; request JSON cannot override them. Connector credentials remain in environment or secret management and are redacted from effective configuration responses.

File inputs are local-only. Parsers enforce size and archive-member limits, process DOCX/XLSX/PDF/text/images, and use OCR for images. They do not fetch URLs, execute macros or code, or infer visual image semantics.

Runs and connectors are read-only. Jira and Splunk access is project/index scoped. Agent configuration review is the supported administrative mutation: authors submit data-only YAML, a different same-scope administrator approves or rejects the expected content hash, and administrators can revoke active definitions. Investigation tool writes and durable background recovery are unsupported.

Configuration inherits only explicitly delegated fields. Project permissions intersect platform ceilings; project budgets can only decrease them. User configuration is limited to permitted skill overrides and presentation preferences. Identity, credential-bearing database URLs, token settings and deployment scope are rejected in operational YAML; they must come from deployment environment. See [settings validation](../app/settings.py), [layer resolution](../app/configuration/layers.py), [tool catalog](../app/tools/catalog.py) and [per-call governance](../app/runtime/governance.py).

Real project configuration and artifacts are excluded from Git and container builds. Compose mounts platform defaults read-only and the separate project root read-write for artifact storage; operators manage project configuration permissions. Native authentication, audit, redaction and storage controls cannot be disabled by a layer. Custom agents retain separate expected-hash, same-scope, non-self administrator approval in the [approval service](../app/configuration/service.py).
