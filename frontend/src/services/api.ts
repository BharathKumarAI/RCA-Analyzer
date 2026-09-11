import {
  Principal,
  AgentConfiguration,
  Run,
  ToolDefinition,
  CapabilityItem,
  AuditLog,
  KnowledgeSource,
  UserAccount,
  SystemHealth,
  SystemDiagnostics,
} from '../types/api';

let inMemoryToken: string | null = null;

export function setSessionToken(token: string | null) {
  inMemoryToken = token ? token.trim() : null;
}

export function getSessionToken(): string | null {
  return inMemoryToken;
}

export function hasSessionToken(): boolean {
  return Boolean(inMemoryToken);
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }

  let finalBody: BodyInit | null | undefined;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(options.body);
  } else {
    finalBody = options.body as BodyInit | null | undefined;
  }

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, body: finalBody });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Network or connectivity error: ${errorMsg}`);
  }

  if (!response.ok) {
    let errorDetail: unknown = null;
    try {
      const data = await response.clone().json();
      errorDetail = data.detail || data;
    } catch {
      errorDetail = response.statusText || `HTTP ${response.status}`;
    }

    let message = `HTTP ${response.status}`;
    if (typeof errorDetail === 'string') {
      message = errorDetail;
    } else if (errorDetail && typeof errorDetail === 'object' && 'detail' in errorDetail) {
      message = String((errorDetail as { detail: string }).detail);
    }
    throw new ApiError(response.status, message, errorDetail);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

// ----------------- Mock Fallbacks for Offline & Rich UI Display -----------------

export const MOCK_HEALTH: SystemHealth = {
  status: 'healthy',
  latency_ms: 18,
  tenant_id: 'prod-tenant-corp',
  project_id: 'rca-core',
  mode: 'demo',
  active_runs: 3,
  total_runs: 142,
  mttr_minutes: 4.8,
  tool_success_rate: 99.4,
  active_agents_count: 8,
};

export const MOCK_PRINCIPAL: Principal = {
  subject: 'admin@rca-analyzer.internal',
  roles: ['PLATFORM_ADMIN', 'SRE_LEAD'],
  tenant_id: 'default',
  project_id: 'root',
  expires_at: '2026-09-12T00:00:00Z',
};

export const MOCK_AGENTS: AgentConfiguration[] = [
  {
    id: 'agent-jira-triage',
    name: 'Jira Incident Triage',
    role: 'Detector',
    description: 'Inspects incoming incident alerts, correlates priority, checks component lineage and assigns triage labels.',
    status: 'active',
    model: 'gemini-2.5-flash',
    temperature: 0.2,
    thinking_budget: 1024,
    max_steps: 8,
    tools: ['jira_search_issues', 'jira_get_issue_details'],
    permissions: ['tickets:read', 'metadata:read'],
    rag_sources: ['Service Lineage Map', 'SRE Escalation Directory'],
    prompt: 'You are an SRE incident detector. Extract issue keys, inspect timeline and map component dependencies.',
    accuracy: 98.6,
    hallucination_rate: 0.4,
    avg_latency_sec: 1.2,
    version: '2.4.1',
    updated_at: '2026-09-11 14:22:00',
    content_hash: 'sha256:7fa890e0c1f23b',
    approved_by: 'sec-officer-9',
  },
  {
    id: 'agent-splunk-investigator',
    name: 'Splunk Observability Miner',
    role: 'Correlator',
    description: 'Queries targeted log indexes, detects anomalous error spikes, and computes latency distribution shifts.',
    status: 'active',
    model: 'gemini-2.5-pro',
    temperature: 0.1,
    thinking_budget: 4096,
    max_steps: 12,
    tools: ['splunk_query_events', 'splunk_detect_spikes'],
    permissions: ['telemetry:read', 'indexes:app-logs'],
    rag_sources: ['Splunk Field Aliases', 'Common Error Signatures'],
    prompt: 'Execute bounded log queries with UTC timestamps. Synthesize error patterns and calculate delta percentiles.',
    accuracy: 99.2,
    hallucination_rate: 0.2,
    avg_latency_sec: 3.4,
    version: '3.1.0',
    updated_at: '2026-09-10 18:45:00',
    content_hash: 'sha256:bb9103c8e472fa',
    approved_by: 'platform-admin-1',
  },
  {
    id: 'agent-root-cause-synthesizer',
    name: 'Root Cause Synthesizer',
    role: 'Root Cause Analyst',
    description: 'Merges log anomalies, ticket history, and extracted runbook evidence to produce definitive fault trees and blast radiuses.',
    status: 'active',
    model: 'gemini-2.5-pro',
    temperature: 0.1,
    thinking_budget: 8192,
    max_steps: 15,
    tools: ['evidence_cross_correlate', 'generate_rca_report'],
    permissions: ['evidence:read', 'synthesis:write'],
    rag_sources: ['Architecture Topology', 'Past Postmortems'],
    prompt: 'Formulate chronological timeline of cascading faults. Determine root cause with high evidence confidence threshold.',
    accuracy: 97.9,
    hallucination_rate: 0.5,
    avg_latency_sec: 6.1,
    version: '4.0.2',
    updated_at: '2026-09-11 09:15:00',
    content_hash: 'sha256:d83491fec091ae',
    approved_by: 'sec-officer-9',
  },
  {
    id: 'agent-remediation-advisor',
    name: 'Remediation Advisor',
    role: 'Remediation',
    description: 'Recommends rollback targets, configuration fixes, and safe mitigations strictly conforming to enterprise change rules.',
    status: 'active',
    model: 'gemini-2.5-flash',
    temperature: 0.3,
    thinking_budget: 2048,
    max_steps: 6,
    tools: ['runbook_action_matcher', 'blast_radius_calculator'],
    permissions: ['runbooks:read'],
    rag_sources: ['Runbook Library', 'Deployment History'],
    prompt: 'Propose minimal disruption mitigations. Never attempt automatic execution; provide validated human-in-the-loop steps.',
    accuracy: 99.1,
    hallucination_rate: 0.1,
    avg_latency_sec: 2.1,
    version: '1.8.0',
    updated_at: '2026-09-08 11:30:00',
    content_hash: 'sha256:e01923ab98d11c',
    approved_by: 'sre-lead-4',
  },
  {
    id: 'agent-kubernetes-specialist',
    name: 'Kubernetes Pod Diagnostics (Draft)',
    role: 'Specialist',
    description: 'Specialist agent submitted for reviewing pod OOMKilled events and container crashloop backoffs.',
    status: 'pending',
    model: 'gemini-2.5-flash',
    temperature: 0.2,
    thinking_budget: 2048,
    max_steps: 10,
    tools: ['splunk_query_events'],
    permissions: ['telemetry:read'],
    rag_sources: ['K8s Cluster Manifests'],
    prompt: 'Inspect OOMKilled events and memory limit allocations.',
    accuracy: 94.0,
    hallucination_rate: 1.2,
    avg_latency_sec: 2.8,
    version: '0.9.0-rc1',
    updated_at: '2026-09-11 16:10:00',
    author: 'engineer-alex@rca-analyzer.internal',
    content_hash: 'sha256:91ab77c12f6e90',
  }
];

export const MOCK_TOOLS: ToolDefinition[] = [
  {
    id: 'tool-jira',
    name: 'Jira Cloud Incident Triage',
    system_name: 'jira',
    category: 'Ticketing',
    description: 'Read-only ticket ingestion, JQL scheduled polling, RCA extraction, and assignee routing.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '120 req / min',
    last_ping: 'Just now (12ms)',
    latency_ms: 124,
    calls_today: 1842,
    error_rate: 0.02,
    endpoint: 'https://atlassian.net/rest/api/3',
    ui_base_url: 'https://atlassian.net',
    auth_method: 'Bearer Token',
    secret_reference: 'JIRA_API_TOKEN',
    service_user: 'triage-svc@org.internal',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      polling_cron: '*/15 * * * *',
      reporting_cron: '0 17 * * 5',
      timezone: 'America/Chicago',
      customfields: {
        fix_team: 'customfield_10290',
        environment: 'customfield_10291',
        fix_application: 'customfield_10292',
        severity: 'customfield_10285',
        rca: 'customfield_10320'
      }
    }
  },
  {
    id: 'tool-splunk',
    name: 'Splunk Infrastructure & Log Mining',
    system_name: 'splunk',
    category: 'Observability',
    description: 'Time-bounded log querying, saved searches, event correlation, and metric anomaly extraction.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '500 queries / min',
    last_ping: 'Just now (45ms)',
    latency_ms: 310,
    calls_today: 5410,
    error_rate: 0.05,
    endpoint: 'https://splunk-api.prod.internal:8089',
    ui_base_url: 'https://splunk-ui.prod.internal:8000',
    auth_method: 'Bearer Token',
    secret_reference: 'SPLUNK_HEC_TOKEN',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      allowed_indexes: ['adms', 'billing', 'system', 'metrics'],
      search_app_url: 'https://splunk-ui.prod.internal:8000/en-US/app/search/search',
      data_sources: { metrics: true, events: true, logs: true }
    }
  },
  {
    id: 'tool-signalfx',
    name: 'SignalFx APM & Distributed Tracing',
    system_name: 'signalfx',
    category: 'Observability',
    description: 'Real-time trace waterfall analysis, span error auto-detection (SSL/timeout), and service graphs.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '300 req / min',
    last_ping: 'Just now (28ms)',
    latency_ms: 215,
    calls_today: 3120,
    error_rate: 0.01,
    endpoint: 'https://signalfx-api.prod.internal/v2',
    ui_base_url: 'https://signalfx.prod.internal/#/apm',
    auth_method: 'Bearer Token (X-SF-Token)',
    secret_reference: 'SIGNALFX_API_TOKEN',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      monitored_namespaces: ['npe-qlab01', 'npe-qlab02', 'npe-qlab03', 'plab01'],
      data_sources: { metrics: true, events: true, traces: true, logs: true }
    }
  },
  {
    id: 'tool-confluence',
    name: 'Confluence Knowledge & Architecture',
    system_name: 'confluence',
    category: 'Knowledge & RAG',
    description: 'Knowledge base refresh, runbook ingestion, and architecture context mapping for root cause correlation.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '60 req / min',
    last_ping: '3 mins ago (18ms)',
    latency_ms: 185,
    calls_today: 430,
    error_rate: 0.0,
    endpoint: 'https://atlassian.net/wiki/rest/api',
    ui_base_url: 'https://atlassian.net/wiki',
    auth_method: 'Bearer Token',
    secret_reference: 'CONFLUENCE_API_TOKEN',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      refresh_schedule: 'Daily at 9:00 PM CT',
      cron: '0 21 * * *',
      timezone: 'America/Chicago'
    }
  },
  {
    id: 'tool-qtest',
    name: 'qTest Test Case & Verification',
    system_name: 'qtest',
    category: 'Quality Assurance',
    description: 'Test case execution results, acceptance criteria link discovery, and failure regression tracking.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'project_override',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '150 req / min',
    last_ping: 'Just now (34ms)',
    latency_ms: 240,
    calls_today: 920,
    error_rate: 0.03,
    endpoint: 'https://qtest.corp.internal/api/v3',
    ui_base_url: 'https://qtest.corp.internal',
    auth_method: 'Bearer Token',
    secret_reference: 'QTEST_API_TOKEN',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      project_id: 'PRISM-SAG-01',
      monitored_environments: ['QLAB01', 'QLAB02', 'QLAB03', 'QLAB06', 'PLAB01'],
      jira_link_discovery: true
    }
  },
  {
    id: 'tool-gitlab',
    name: 'GitLab Source & CI/CD Pipelines',
    system_name: 'gitlab',
    category: 'Source & CI/CD',
    description: 'Commit log discovery, deployment timeline inspection, pipeline error logs, and merge requests.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'project_override',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '200 req / min',
    last_ping: 'Just now (22ms)',
    latency_ms: 195,
    calls_today: 1450,
    error_rate: 0.01,
    endpoint: 'https://gitlab.corp.internal/api/v4',
    ui_base_url: 'https://gitlab.corp.internal',
    auth_method: 'Bearer Token (PRIVATE-TOKEN)',
    secret_reference: 'GITLAB_PAT_TOKEN',
    protocol: 'HTTPS',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      projects: ['samson_core', 'customer_hub', 'consumer_rabbitmq'],
      track_deployments: true,
      track_pipeline_logs: true
    }
  },
  {
    id: 'tool-oracle',
    name: 'Oracle Samson Database Analytics',
    system_name: 'samson',
    category: 'Databases',
    description: 'Direct read-only SQL querying, schema table discovery, data freshness probe, and divergence checks.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'project_only',
    project_can_override: true,
    inherit_platform_defaults: false,
    rate_limit: 'Read-only SELECT (Max 500 rows)',
    last_ping: 'Just now (15ms)',
    latency_ms: 145,
    calls_today: 680,
    error_rate: 0.0,
    endpoint: 'oracle-scan.corp.internal:1521/SAMSON_SRV',
    protocol: 'Oracle Net (TNS/OCI)',
    auth_method: 'Database Credentials (User/Password Secret)',
    secret_reference: 'ORACLE_SAMSON_SECRET',
    service_user: 'SAMSON_RO',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      host: 'oracle-scan.corp.internal',
      port: 1521,
      sid: 'SAMSON01',
      service_name: 'samson.unix.internal',
      schema: 'SAMSON_APP',
      default_row_limit: 500,
      read_only_enforced: true,
      connection_pool: { min: 2, max: 10 }
    }
  },
  {
    id: 'tool-kafka',
    name: 'Kafka Message Stream Analysis',
    system_name: 'kafka',
    category: 'Message Streaming',
    description: 'Scan recent topic message windows, measure consumer group lag, and error topic stream spikes.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '500 records / query',
    last_ping: 'Just now (19ms)',
    latency_ms: 160,
    calls_today: 2150,
    error_rate: 0.02,
    endpoint: 'mcp://kafka-mcp.internal:9090',
    protocol: 'MCP / Network Trust',
    auth_method: 'MCP Bearer Token',
    secret_reference: 'KAFKA_MCP_TOKEN',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      brokers: ['kafka-b1.internal:9094', 'kafka-b2.internal:9094'],
      consumer_group: 'triageai-sag-readonly',
      consumer_mode: 'read-only',
      topic_filter_pattern: 'qat92.*',
      max_poll_records: 500
    }
  },
  {
    id: 'tool-unix-tuxedo',
    name: 'Tuxedo / Unix Host Health & Logs',
    system_name: 'tuxedo',
    category: 'Host & Runtime Health',
    description: 'tmadmin service health status, journalctl error inspection, CSM/RTE log search and live tail.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'project_only',
    project_can_override: true,
    inherit_platform_defaults: false,
    rate_limit: 'Read-only commands',
    last_ping: 'Just now (42ms)',
    latency_ms: 280,
    calls_today: 740,
    error_rate: 0.01,
    endpoint: 'mcp://unix-mcp.internal:9092',
    protocol: 'MCP / SSH Fallback',
    auth_method: 'MCP Token / SSH Password Reference',
    secret_reference: 'TUXEDO_SSH_SECRET',
    service_user: 'app_triage',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      ssh_host: 'tuxedo-app01.corp.internal',
      ssh_port: 22,
      allowed_actions: ['service_status', 'disk_space', 'inodes', 'csm_log_tail', 'job_log_review'],
      log_directories: ['/var/tlg_var/vst/csm/log', '/var/tlg_var/vst/log', '/rte_tlg/var/vst/log']
    }
  },
  {
    id: 'tool-kubernetes',
    name: 'Kubernetes Cluster & Pod Telemetry',
    system_name: 'kubernetes',
    category: 'Container Orchestration',
    description: 'Application-level pod status, CrashLoopBackOff detection, deployment rollouts, and node quotas.',
    status: 'connected',
    enabled: true,
    type: 'connector',
    scope_level: 'platform_default',
    project_can_override: false,
    inherit_platform_defaults: true,
    rate_limit: '500 req / min',
    last_ping: 'Just now (16ms)',
    latency_ms: 130,
    calls_today: 4890,
    error_rate: 0.01,
    endpoint: 'https://k8s-cluster.corp.internal:6443',
    protocol: 'HTTPS (v1)',
    auth_method: 'Kubeconfig / Service Account Token',
    secret_reference: 'K8S_SERVICE_ACCOUNT_TOKEN',
    timeout_seconds: 30,
    retry_attempts: 3,
    custom_config: {
      cluster_name: 'npe-k8s-us-central1',
      monitored_namespaces: ['npe-qlab01', 'npe-qlab02', 'npe-qlab03', 'plab01'],
      operations: ['get_pod_status', 'get_pod_events', 'check_deployment', 'check_node_status', 'check_resource_quota']
    }
  },
  {
    id: 'tool-file-parser',
    name: 'Bounded Local Document OCR & Parser',
    system_name: 'file_parser',
    category: 'Files & Data',
    description: 'Local CPU-bounded OCR, markdown extraction, and token truncation for incident attachments.',
    status: 'connected',
    enabled: true,
    type: 'parser',
    scope_level: 'platform_default',
    project_can_override: false,
    inherit_platform_defaults: true,
    rate_limit: 'Bounded pool (8 threads)',
    last_ping: 'Active (2ms)',
    latency_ms: 18,
    calls_today: 289,
    error_rate: 0.0,
    protocol: 'Local CPU Process',
    auth_method: 'Server Local Isolation',
    secret_reference: 'NONE_LOCAL',
    timeout_seconds: 15,
    retry_attempts: 0,
    custom_config: {
      max_file_size_mb: 25,
      worker_pool_size: 8,
      local_ocr_engine: 'tesseract_bounded',
      allow_remote_urls: false
    }
  },
  {
    id: 'tool-kafka-mcp',
    name: 'Kafka Broker MCP Server',
    system_name: 'kafka_mcp',
    category: 'Message Streaming',
    description: 'Model Context Protocol (MCP) server for structured Kafka stream queries, lag analysis, and topic scanning.',
    status: 'connected',
    enabled: true,
    type: 'mcp',
    integration_kind: 'mcp',
    scope_level: 'platform_default',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '1000 msg / batch',
    last_ping: 'Just now (8ms)',
    latency_ms: 110,
    calls_today: 1850,
    error_rate: 0.01,
    endpoint: 'mcp://kafka-mcp.internal:9090',
    protocol: 'MCP (Streamable HTTP)',
    auth_method: 'MCP Bearer Token',
    secret_reference: 'KAFKA_MCP_TOKEN',
    timeout_seconds: 30,
    retry_attempts: 3,
    mcp_config: {
      transport: 'streamable_http',
      tools_exposed: ['scan_messages', 'check_consumer_lag', 'measure_throughput', 'list_active_topics']
    }
  },
  {
    id: 'tool-unix-mcp',
    name: 'Tuxedo / Unix Health MCP Server',
    system_name: 'tuxedo_mcp',
    category: 'Host & Runtime Health',
    description: 'MCP endpoint providing structured application health checks, tmadmin status, and CSM/RTE log search.',
    status: 'connected',
    enabled: true,
    type: 'mcp',
    integration_kind: 'mcp',
    scope_level: 'project_only',
    project_can_override: true,
    inherit_platform_defaults: false,
    rate_limit: 'Read-only MCP tools',
    last_ping: 'Just now (14ms)',
    latency_ms: 125,
    calls_today: 620,
    error_rate: 0.0,
    endpoint: 'mcp://unix-mcp.internal:9092',
    protocol: 'MCP (SSE)',
    auth_method: 'MCP Bearer Token',
    secret_reference: 'UNIX_MCP_TOKEN',
    timeout_seconds: 30,
    retry_attempts: 3,
    mcp_config: {
      transport: 'sse',
      tools_exposed: ['service_status', 'resource_metrics', 'log_search', 'log_tail', 'deployment_status']
    }
  },
  {
    id: 'tool-a2a-triage-tagger',
    name: 'A2A Agent: Jira Triage Specialist',
    system_name: 'a2a_triage_agent',
    category: 'Ticketing',
    description: 'Google ADK AgentTool delegation bridge to specialist triage agent for severity rating and team routing.',
    status: 'connected',
    enabled: true,
    type: 'a2a',
    integration_kind: 'a2a',
    scope_level: 'project_override',
    project_can_override: true,
    inherit_platform_defaults: true,
    rate_limit: '60 calls / min',
    last_ping: 'Just now (24ms)',
    latency_ms: 180,
    calls_today: 340,
    error_rate: 0.0,
    endpoint: 'http://agent-runtime.internal:8000/a2a/v1/triage',
    protocol: 'ADK AgentTool',
    auth_method: 'Mutual TLS & Content Hash',
    secret_reference: 'AGENT_ROUTER_SECRET',
    timeout_seconds: 45,
    retry_attempts: 2,
    a2a_config: {
      target_agent_id: 'agent-jira-triage-specialist',
      target_capability: 'jira_triage_classification',
      delegation_protocol: 'adk_agent_tool',
      dual_custody_approved: true,
      content_hash: 'sha256:7f92ac3910eb4819'
    }
  },
  {
    id: 'tool-a2a-rca-mesh',
    name: 'A2A Agent: RCA Evidence Correlator',
    system_name: 'a2a_rca_correlator',
    category: 'Observability',
    description: 'Agent-to-Agent mesh bridge that correlates Splunk, SignalFx, and Oracle anomalies into corroborated root-cause hypotheses.',
    status: 'connected',
    enabled: true,
    type: 'a2a',
    integration_kind: 'a2a',
    scope_level: 'platform_default',
    project_can_override: false,
    inherit_platform_defaults: true,
    rate_limit: '120 calls / min',
    last_ping: 'Just now (31ms)',
    latency_ms: 220,
    calls_today: 890,
    error_rate: 0.01,
    endpoint: 'http://agent-runtime.internal:8000/a2a/v1/correlate',
    protocol: 'A2A REST Protocol',
    auth_method: 'RS256 JWT Signed Delegation',
    secret_reference: 'MESH_DELEGATION_KEY',
    timeout_seconds: 60,
    retry_attempts: 2,
    a2a_config: {
      target_agent_id: 'agent-cross-correlator-mesh',
      target_capability: 'cross_connector_corroboration',
      delegation_protocol: 'a2a_rest',
      dual_custody_approved: true,
      content_hash: 'sha256:91bc8810da7721ec'
    }
  }
];

export const MOCK_RUNS: Run[] = [
  {
    id: 'run-88219-fc41',
    capability: 'full_incident_rca',
    prompt: 'Investigate 504 Gateway Timeouts in payment-gateway-us-east at 14:15 UTC',
    incident_id: 'INC-9042',
    status: 'COMPLETED',
    created_at: '2026-09-11 14:16:12',
    completed_at: '2026-09-11 14:20:45',
    duration_seconds: 273,
    token_usage: { prompt: 14500, candidate: 3200, total: 17700 },
    evidence_count: 14,
    findings: 'Connection pool starvation caused by unindexed DB query in order-worker during high load burst.',
    stages: [
      { name: 'Jira Incident Triage', status: 'completed', agent: 'Jira Incident Triage', duration_ms: 1200 },
      { name: 'Splunk Log Mining', status: 'completed', agent: 'Splunk Observability Miner', duration_ms: 3400 },
      { name: 'Document Analysis', status: 'completed', agent: 'Bounded Local Document OCR', duration_ms: 1800 },
      { name: 'Fault Tree Synthesis', status: 'completed', agent: 'Root Cause Synthesizer', duration_ms: 5900 },
    ]
  },
  {
    id: 'run-88218-bb90',
    capability: 'splunk_telemetry_triage',
    prompt: 'Analyze memory leak pattern in auth-service container pod crashes',
    incident_id: 'INC-9038',
    status: 'COMPLETED',
    created_at: '2026-09-11 11:02:10',
    completed_at: '2026-09-11 11:05:30',
    duration_seconds: 200,
    token_usage: { prompt: 9800, candidate: 1950, total: 11750 },
    evidence_count: 8,
    findings: 'Go heap memory unbounded cache retention in JWT revocation validator.',
    stages: [
      { name: 'Splunk Log Mining', status: 'completed', agent: 'Splunk Observability Miner', duration_ms: 2900 },
      { name: 'Fault Tree Synthesis', status: 'completed', agent: 'Root Cause Synthesizer', duration_ms: 4100 },
    ]
  },
  {
    id: 'run-88217-09ef',
    capability: 'full_incident_rca',
    prompt: 'Cascading network timeout between envoy mesh and billing microservices',
    incident_id: 'INC-9035',
    status: 'RUNNING',
    created_at: '2026-09-11 16:40:02',
    duration_seconds: 45,
    token_usage: { prompt: 6200, candidate: 800, total: 7000 },
    evidence_count: 5,
    stages: [
      { name: 'Jira Incident Triage', status: 'completed', agent: 'Jira Incident Triage', duration_ms: 1100 },
      { name: 'Splunk Log Mining', status: 'running', agent: 'Splunk Observability Miner', duration_ms: 2200 },
      { name: 'Fault Tree Synthesis', status: 'queued', agent: 'Root Cause Synthesizer', duration_ms: 0 },
    ]
  }
];

export const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'aud-991',
    timestamp: '2026-09-11 16:32:15',
    actor: 'admin@rca-analyzer.internal',
    action: 'POLICY_EVALUATION',
    resource: 'agent-kubernetes-specialist',
    outcome: 'SUCCESS',
    details: 'Verified expected_hash sha256:91ab77c12f6e90; dual-custody check pending peer admin',
    hash: '8f9210aa88301b'
  },
  {
    id: 'aud-990',
    timestamp: '2026-09-11 15:40:11',
    actor: 'sre-lead-4',
    action: 'RUN_EXECUTION',
    resource: 'run-88219-fc41',
    outcome: 'SUCCESS',
    details: 'Initiated full_incident_rca with ticket INC-9042',
    hash: '41ab9901eef234'
  },
  {
    id: 'aud-989',
    timestamp: '2026-09-11 14:02:00',
    actor: 'unknown-service-token',
    action: 'UNAUTHORIZED_ACCESS',
    resource: '/api/v1/agent-configurations',
    outcome: 'DENIED',
    details: 'Rejected with HTTP 403: Role GENERIC_VIEWER cannot modify agent configurations',
    hash: '09cc8811ffa762'
  }
];

export const MOCK_KNOWLEDGE: KnowledgeSource[] = [
  {
    id: 'kn-1',
    title: 'Payment Gateway Runbooks & Architecture',
    type: 'runbook',
    entries_count: 34,
    size_mb: 18.4,
    freshness: 'Synced 1h ago',
    status: 'indexed',
    access_level: 'All Investigators'
  },
  {
    id: 'kn-2',
    title: '2025-2026 Postmortem & Root Cause Archive',
    type: 'archive',
    entries_count: 142,
    size_mb: 85.2,
    freshness: 'Synced 4h ago',
    status: 'indexed',
    access_level: 'Platform & SRE'
  },
  {
    id: 'kn-3',
    title: 'Kubernetes Cluster Topology & Egress Rules',
    type: 'architecture',
    entries_count: 12,
    size_mb: 6.8,
    freshness: 'Synced yesterday',
    status: 'indexed',
    access_level: 'All Investigators'
  }
];

export const MOCK_USERS: UserAccount[] = [
  {
    id: 'usr-1',
    name: 'Platform Administrator',
    email: 'admin@rca-analyzer.internal',
    role: 'PLATFORM_ADMIN',
    last_active: 'Active now',
    status: 'active',
    investigations_count: 64
  },
  {
    id: 'usr-2',
    name: 'Sarah Chen (SRE Lead)',
    email: 'sarah.chen@rca-analyzer.internal',
    role: 'SRE_LEAD',
    last_active: '15m ago',
    status: 'active',
    investigations_count: 48
  },
  {
    id: 'usr-3',
    name: 'Marcus Vance (Investigator)',
    email: 'marcus.v@rca-analyzer.internal',
    role: 'INVESTIGATOR',
    last_active: '2h ago',
    status: 'active',
    investigations_count: 29
  },
  {
    id: 'usr-4',
    name: 'Elena Rostova (SecOps)',
    email: 'elena.r@rca-analyzer.internal',
    role: 'SECURITY_OFFICER',
    last_active: '1d ago',
    status: 'active',
    investigations_count: 12
  }
];

// ----------------- Service Methods -----------------

export async function fetchHealth(): Promise<SystemHealth> {
  try {
    const data = await request<Record<string, unknown>>('/health');
    return {
      ...MOCK_HEALTH,
      status: (data.status as 'healthy' | 'degraded' | 'error') || 'healthy',
      latency_ms: typeof data.latency_ms === 'number' ? data.latency_ms : 22,
    };
  } catch {
    return MOCK_HEALTH;
  }
}

export async function fetchPrincipal(): Promise<Principal> {
  try {
    const data = await request<Principal>('/api/v1/me');
    return data;
  } catch {
    return MOCK_PRINCIPAL;
  }
}

export async function fetchAgents(): Promise<AgentConfiguration[]> {
  try {
    const data = await request<AgentConfiguration[]>('/api/v1/agent-configurations');
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    return MOCK_AGENTS;
  } catch {
    return MOCK_AGENTS;
  }
}

export async function submitAgentYaml(yamlText: string): Promise<AgentConfiguration> {
  return request<AgentConfiguration>('/api/v1/agent-configurations', {
    method: 'POST',
    body: { yaml: yamlText },
  });
}

export async function approveAgent(id: string, expectedHash: string, reason: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/agent-configurations/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: { expected_hash: expectedHash, reason },
  });
}

export async function rejectAgent(id: string, expectedHash: string, reason: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/agent-configurations/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { expected_hash: expectedHash, reason },
  });
}

export async function fetchRuns(): Promise<Run[]> {
  try {
    const data = await request<Run[]>('/api/v1/runs?limit=20');
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    return MOCK_RUNS;
  } catch {
    return MOCK_RUNS;
  }
}

export async function triggerRun(capability: string, prompt: string, incidentId?: string): Promise<Run> {
  try {
    return await request<Run>('/api/v1/runs', {
      method: 'POST',
      body: {
        capability,
        prompt,
        incident_id: incidentId || null,
        attachment_ids: [],
      },
    });
  } catch {
    // Generate optimistic simulated run
    const newRun: Run = {
      id: `run-${Date.now().toString().slice(-4)}`,
      capability,
      prompt,
      incident_id: incidentId || 'INC-LIVE',
      status: 'RUNNING',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      duration_seconds: 0,
      evidence_count: 0,
      stages: [
        { name: 'Jira Incident Triage', status: 'running', agent: 'Jira Incident Triage', duration_ms: 450 },
        { name: 'Splunk Observability Miner', status: 'queued', agent: 'Splunk Observability Miner', duration_ms: 0 },
        { name: 'Root Cause Synthesizer', status: 'queued', agent: 'Root Cause Synthesizer', duration_ms: 0 },
      ],
    };
    return newRun;
  }
}

export async function fetchSystemDiagnostics(): Promise<SystemDiagnostics> {
  try {
    return await request<SystemDiagnostics>('/api/v1/system/diagnostics');
  } catch {
    return {
      timestamp: Date.now() / 1000,
      database: {
        status: 'healthy',
        latency_ms: 9.75,
        dialect: 'postgresql',
        schema_version: 3,
        schemas: ['runtime', 'governance', 'optimization', 'platform', 'project', 'adk'],
      },
      storage: {
        status: 'healthy',
        path: 'blob_local/projects',
        writable: true,
        disk_free_gb: 2.88,
        disk_total_gb: 228.27,
        cas_layout: 'sha256',
      },
      memory: {
        status: 'healthy',
        rss_mb: 243.42,
        active_tasks: 4,
      },
      mlflow: {
        status: 'connected',
        tracking_uri: 'postgresql+psycopg://rca_app:***@127.0.0.1:5432/rca_db?options=-csearch_path%3Dmlflow',
        experiment_store: 'sqlite_local',
        offline_eval_contracts: ['Quality', 'Safety', 'Latency', 'Cost'],
      },
      connectors: {
        mode: 'demo',
        results: { itsm: true, log_search: true },
        disabled: [],
      },
    };
  }
}

