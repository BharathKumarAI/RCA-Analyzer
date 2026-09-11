export type SystemRole = 'PLATFORM_ADMIN' | 'SRE_LEAD' | 'INVESTIGATOR' | 'SECURITY_OFFICER' | 'GENERIC_VIEWER';

export interface Principal {
  subject: string;
  roles: SystemRole[];
  tenant_id: string;
  project_id: string;
  expires_at?: string;
}

export interface AgentConfiguration {
  id: string;
  name: string;
  role: 'Detector' | 'Correlator' | 'Root Cause Analyst' | 'Explainer' | 'Remediation' | 'Summarizer' | 'Specialist';
  description: string;
  status: 'active' | 'pending' | 'draft' | 'deprecated';
  model: string;
  temperature: number;
  thinking_budget: number;
  max_steps: number;
  tools: string[];
  permissions: string[];
  rag_sources: string[];
  prompt: string;
  accuracy: number;
  hallucination_rate: number;
  avg_latency_sec: number;
  version: string;
  updated_at: string;
  author?: string;
  content_hash?: string;
  approved_by?: string;
  rejection_reason?: string;
}

export interface RunStage {
  name: string;
  status: 'completed' | 'running' | 'queued' | 'skipped';
  agent: string;
  duration_ms: number;
}

export interface Run {
  id: string;
  capability: string;
  prompt: string;
  incident_id?: string;
  status: 'COMPLETED' | 'RUNNING' | 'FAILED' | 'QUEUED' | 'PARTIAL' | 'CANCELLED' | 'SIMULATED' | 'BLOCKED';
  created_at: string;
  completed_at?: string;
  duration_seconds?: number;
  token_usage?: {
    prompt: number;
    candidate: number;
    total: number;
  };
  stages?: RunStage[];
  evidence_count?: number;
  findings?: string;
}

export type ConnectorCategory =
  | 'Ticketing'
  | 'Observability'
  | 'Knowledge & RAG'
  | 'Quality Assurance'
  | 'Source & CI/CD'
  | 'Databases'
  | 'Message Streaming'
  | 'Host & Runtime Health'
  | 'Container Orchestration'
  | 'Files & Data'
  | 'Security';

export type ScopeLevel = 'platform_default' | 'project_override' | 'project_only';

export type IntegrationKind = 'native' | 'mcp' | 'a2a' | 'parser';

export interface ToolDefinition {
  id: string;
  name: string;
  system_name?: string;
  category: ConnectorCategory | string;
  description: string;
  status: 'connected' | 'degraded' | 'disabled' | 'planned';
  enabled: boolean;
  type: 'connector' | 'parser' | 'synthesizer' | 'mcp' | 'a2a';
  integration_kind?: IntegrationKind;
  scope_level: ScopeLevel;
  project_can_override: boolean;
  inherit_platform_defaults: boolean;
  rate_limit: string;
  last_ping: string;
  latency_ms?: number;
  calls_today?: number;
  error_rate?: number;
  endpoint?: string;
  ui_base_url?: string;
  auth_method?: string;
  secret_reference?: string;
  service_user?: string;
  protocol?: string;
  timeout_seconds?: number;
  retry_attempts?: number;
  retry_backoff_seconds?: number;
  max_response_bytes?: number;
  verify_ssl?: boolean;
  token_header_format?: string;
  project_key?: string;
  custom_config?: Record<string, any>;
  mcp_config?: {
    transport: 'sse' | 'stdio' | 'websocket' | 'streamable_http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    tools_exposed?: string[];
  };
  a2a_config?: {
    target_agent_id: string;
    target_capability: string;
    delegation_protocol: 'adk_agent_tool' | 'a2a_rest' | 'a2a_jsonrpc';
    dual_custody_approved?: boolean;
    content_hash?: string;
  };
}

export interface CapabilityItem {
  name: string;
  description: string;
  stage_type: string;
  orchestrator: string;
  max_steps: number;
  agents: string[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'SUCCESS' | 'DENIED' | 'FLAGGED';
  details: string;
  hash: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  type: 'runbook' | 'archive' | 'architecture' | 'policy';
  entries_count: number;
  size_mb: number;
  freshness: string;
  status: 'indexed' | 'syncing' | 'stale';
  access_level: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  last_active: string;
  status: 'active' | 'suspended';
  investigations_count: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'error';
  latency_ms: number;
  tenant_id: string;
  project_id: string;
  mode: 'demo' | 'live';
  active_runs: number;
  total_runs: number;
  mttr_minutes: number;
  tool_success_rate: number;
  active_agents_count: number;
}

export interface SystemDiagnostics {
  timestamp: number;
  database: {
    status: 'healthy' | 'unreachable' | 'degraded';
    latency_ms: number;
    dialect: string;
    schema_version: number | null;
    schemas: string[];
  };
  storage: {
    status: 'healthy' | 'degraded';
    path: string;
    writable: boolean;
    disk_free_gb: number;
    disk_total_gb: number;
    cas_layout: string;
  };
  memory: {
    status: 'healthy' | 'warning';
    rss_mb: number;
    active_tasks: number;
  };
  mlflow: {
    status: 'connected' | 'unconfigured';
    tracking_uri: string;
    experiment_store: string;
    offline_eval_contracts: string[];
  };
  connectors: {
    mode: string;
    results: Record<string, unknown>;
    disabled: string[];
  };
}
