"""UI-readable facts about implemented connector execution, never editable settings."""


def connector_runtime_support(adapter: str) -> list[dict[str, str]]:
    common = [
        {"name": "Write access", "status": "unavailable", "detail": "This release provides read-only investigation access."},
        {"name": "Polling schedules and reports", "status": "unavailable", "detail": "No durable scheduler or report worker is implemented. Custom scripts cannot execute."},
        {"name": "Webhook listeners", "status": "unavailable", "detail": "Inbound connector webhook processing is not implemented."},
        {"name": "OAuth and SAML sign-in", "status": "unavailable", "detail": "Interactive sign-in and token refresh are not implemented by the native adapters. Use an available credential-reference profile."},
    ]
    details = {
        "itsm": [
            {"name": "Jira REST API", "status": "supported", "detail": "Version 3, bounded Atlassian Document Format parsing and project-scoped requests."},
            {"name": "Comments and attachments", "status": "supported", "detail": "Reads returned comments and attachment metadata. File processing uses local uploads; remote attachment downloads are unavailable."},
            {"name": "Dynamic JQL and search fields", "status": "limited", "detail": "Scoped JQL validation and saved filters are available. Queue polling and configurable runtime search-field selection are not implemented."},
            {"name": "Linked issues, qTest links and historical tickets", "status": "unavailable", "detail": "Automatic relationship traversal and historical similarity retrieval are not implemented."},
            {"name": "Create, update and delete tickets", "status": "unavailable", "detail": "Issue mutations are blocked by release policy."},
        ],
        "confluence": [{"name": "Space content", "status": "supported", "detail": "Reads pages from one authorized space ID. Writing pages or granting cross-space access is unavailable."}],
        "log_search": [{"name": "Index and lookback", "status": "supported", "detail": "Queries use a fixed authorized index, bounded results and a bounded time window. Wildcard index scope is not offered."}],
        "signalfx": [{"name": "Detector evidence", "status": "limited", "detail": "Reads a detector definition from the configured API endpoint and detector ID. Metric streaming, ingest, backfill, and infrastructure health checks are not implemented by this adapter."}],
        "qtest": [{"name": "Project test evidence", "status": "supported", "detail": "Reads test runs from one authorized project ID. All-project access and test mutations are unavailable."}],
        "gitlab": [{"name": "Deployment evidence", "status": "supported", "detail": "Reads deployment records from one authorized project ID."}],
        "kubernetes": [{"name": "Infrastructure health", "status": "supported", "detail": "Reads pod status in one authorized namespace. Cluster mutations and remote execution are unavailable."}],
        "unix": [{"name": "Log evidence", "status": "supported", "detail": "Reads a bounded tail of the authorized log path over SFTP. Shell commands cannot execute."}],
        "kafka": [{"name": "Topic evidence", "status": "limited", "detail": "Reads bounded partition metadata for one authorized topic. Message consumption, production and consumer-group lag are unavailable."}],
        "oracle": [{"name": "Session diagnostics", "status": "supported", "detail": "Reads a fixed, bounded session wait snapshot for one authorized database username using Thin mode and a read-only account. Arbitrary SQL and database mutations are unavailable."}],
    }
    return [*details.get(adapter, []), *common]
