export type SystemRole = 'PLATFORM_ADMIN' | 'PROJECT_OWNER' | 'PROJECT_MANAGER' | 'PROJECT_ANALYST' | 'PROJECT_VIEWER' | 'GENERIC_USER';

export interface Principal {
  subject: string;
  roles: SystemRole[];
  tenant_id: string;
  project_id: string;
  expires_at?: string;
  authn_method?: string;
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

export interface StageModelProfile {
  model: string;
  enabled?: boolean;
  temperature: number;
  max_output_tokens: number;
  thinking_level?: 'minimal' | 'low' | 'medium' | 'high' | string;
  thinking_budget?: number | null;
}

export interface RuntimeModelProfiles {
  stages: Record<string, StageModelProfile>;
  profiles: Record<string, Record<string, string | number>>;
}

export interface ConnectorTemplateItem {
  type: string;
  name: string;
  system_name: string;
  category: string;
  description: string;
  integration_kind: 'native' | 'mcp' | 'a2a' | 'parser';
  protocol: string;
  auth_method: string;
  default_endpoint: string;
  default_ui_base_url?: string;
  default_secret: string;
  secret_variable?: string;
  parameter_fields?: ConnectorTemplateField[];
  default_service_user?: string;
  default_scope: 'platform_default' | 'project_override' | 'project_only';
  can_override: boolean;
  default_timeout_seconds: number;
  default_retry_attempts: number;
  default_retry_backoff: number;
  default_rate_limit: string;
  default_config: Record<string, any>;
  default_mcp?: Record<string, any>;
  default_a2a?: Record<string, any>;
}

export interface ConnectorTemplateField {
  variable_name: string;
  description: string;
  value_type: ConnectorValueType;
  default_value: any;
  allow_project_override: boolean;
  visible_in_project: boolean;
  icon: string;
}

export type ConnectorValueType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'json'
  | 'secret_ref';

export interface ParameterDefinitionRow {
  active_value?: unknown;
  restart_required?: boolean;
  tool: string;
  variable_name: string;
  value_type: ConnectorValueType;
  description: string;
  default_value: unknown;
  effective_value: unknown;
  revision: number;
  override_revision: number | null;
  allow_project_override: boolean;
  project_visible: boolean;
  source: 'platform' | 'project';
  scope?: 'platform' | 'project' | 'platform_only';
  icon?: string;
}

export interface ConnectorParameterField {
  tool: string;
  variable_name: string;
  value_type: ConnectorValueType;
  description: string;
  default_value: unknown;
  effective_value: unknown;
  revision: number;
  override_revision: number | null;
  allow_project_override: boolean;
  project_visible: boolean;
  source: 'platform' | 'project';
}

export interface RuntimeConfig {
  configuration_hash: string;
  workflow: Record<string, boolean>;
  preferences: Record<string, string>;
  disabled_connectors: string[];
  max_tool_calls: number;
  mode: 'demo' | 'live';
  execution: {
    run_timeout_seconds: number;
    max_concurrent_runs: number;
    retention_days: number;
    max_llm_calls: number;
    max_context_chars: number;
    max_upload_batch_bytes: number;
    tenant_id?: string;
    project_id?: string;
    default_log_window?: string;
    [key: string]: unknown;
  };
  model_profiles: RuntimeModelProfiles;
  file_limits: { allowed_extensions: string[]; max_file_bytes: number; max_files: number; max_expanded_bytes: number; max_zip_members: number; max_pdf_pages: number; max_rows: number; max_cells: number; max_text_chars: number; max_image_pixels: number; parser_timeout_seconds: number; concurrency: number };
  optimization: Record<string, any>;
  telemetry: Record<string, any>;
}

export interface RunStage {
  name: string;
  status: 'completed' | 'running' | 'queued' | 'skipped';
  agent: string;
  duration_ms: number;
}

export interface Run {
  id: string;
  mode?: 'demo' | 'live';
  result?: {
    outcome: string;
    summary: string;
    findings: Array<{ summary: string; evidence_ids: string[] }>;
    uncertainties: string[];
    recommended_actions: string[];
  };
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
  raw?: Record<string, unknown>;
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
  project_enabled?: boolean;
  registration?: IntegrationRegistration;
  probe_available?: boolean;
  id: string;
  name: string;
  system_name?: string;
  category: ConnectorCategory | string;
  description: string;
  status: 'connected' | 'degraded' | 'disabled' | 'planned' | 'not_configured';
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

export interface CapabilitySafetyProfile {
  tool_mutations?: 'forbidden' | 'approval_required' | 'allowed' | string;
  pii_access?: 'none' | 'redacted' | 'project_scoped' | 'full' | string;
  raw_payload_access?: 'restricted' | 'offload_to_artifacts' | 'direct' | string;
  external_network?: 'connector_allowlist' | string;
}

export interface CapabilityItem {
  project_enabled?: boolean;
  id: string;
  name: string;
  version?: string;
  description: string;
  stage_type?: string;
  orchestrator?: string;
  model_profile?: string;
  max_steps?: number;
  agents?: string[];
  category?: string;
  enabled?: boolean;
  skills?: string[];
  requires?: {
    connectors?: string[];
  };
  optional?: {
    connectors?: string[];
  };
  permissions?: {
    minimum_role?: string;
    allowed_roles?: string[];
    allowed_actions?: string[];
  };
  safety_profile?: CapabilitySafetyProfile;
  is_authorized?: boolean;
  rejection_reason?: string | null;
  allowed_skills?: string[];
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
  status: 'active' | 'inactive';
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
    status: 'connected' | 'configured' | 'unconfigured' | 'error';
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

export interface ConnectionTestTargetResult {
  target: 'database' | 'memory' | 'storage' | 'mlflow' | 'connectors';
  status: 'connected' | 'healthy' | 'warning' | 'error' | 'unconfigured';
  latency_ms: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConnectionTestResponse {
  timestamp: number;
  results: Record<string, ConnectionTestTargetResult>;
}

export type ConnectorCheckStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'RATE_LIMITED'
  | 'SCHEMA_MISMATCH';

export interface ConnectorHealthRecord {
  connector_id: string;
  overall: ConnectorCheckStatus;
  latency_ms: number;
  connectivity: ConnectorCheckStatus;
  authentication: ConnectorCheckStatus;
  authorization: ConnectorCheckStatus;
  rate_limit_status: ConnectorCheckStatus;
  schema_compatibility: ConnectorCheckStatus;
  capability_health: Record<string, ConnectorCheckStatus>;
  last_probed_at: number;
  message: string;
}

export interface ConnectorsHealthResponse {
  disabled: string[];
  mode: 'demo' | 'live';
  connectors: Record<string, ConnectorHealthRecord>;
  unconfigured: string[];
}

export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface AlertItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  component: string;
  title: string;
  summary: string;
  message: string;
  created_at: number;
  metadata?: Record<string, any>;
  status: 'open' | 'suppressed' | 'dismissed' | 'acknowledged' | 'resolved' | string;
  resolution_note?: string;
  resolved_at?: number;
}

export interface AlertsResponse {
  generated_at: number;
  items: AlertItem[];
  summary: AlertSummary;
}

export interface NotificationItem {
  id: string;
  kind: 'run' | 'governance';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  created_at: number;
  created_at_iso?: string;
  metadata?: Record<string, any>;
  read?: boolean;
}

export interface NotificationsResponse {
  generated_at: number;
  items: NotificationItem[];
  unread_count: number;
}

export interface ProjectSetupScope {
  tenant_id: string;
  project_id: string;
  subject: string;
  mode: 'demo' | 'live';
  auth_configured: boolean;
}

export interface ProjectRuntimeSection {
  settings: RuntimeConfig['execution'] & Record<string, unknown>;
  max_tool_calls: number;
  workflow: Record<string, boolean>;
  preferences: Record<string, string>;
  disabled_connectors: string[];
  prompts: Record<string, string>;
  environments?: EnvironmentConfig[];
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  enabled?: boolean;
  cluster?: string | null;
  namespace?: string | null;
  host?: string | null;
  splunk_index?: string | null;
  jira_env_name?: string | null;
}

export interface PlatformSkillRule {
  immutable: boolean;
  project_override: boolean;
  user_override: boolean;
  actions: string[];
}

export interface PlatformPolicyData {
  project_sections: string[];
  model_profiles: string[];
  user_preferences: string[];
  skills: Record<string, PlatformSkillRule>;
}

export interface AvailableSkillItem {
  id: string;
  name: string;
  immutable: boolean;
  project_override: boolean;
  user_override: boolean;
  actions: string[];
}

export interface StageDefinitionItem {
  id: string;
  name: string;
  description: string;
  default_model: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  effective_configuration: Record<string, unknown> | null;
}

export interface ProjectSetupResponse {
  generated_at: number;
  scope: ProjectSetupScope;
  runtime: ProjectRuntimeSection;
  policy: Record<string, unknown>;
  platform_policy?: PlatformPolicyData;
  available_capabilities?: CapabilityItem[];
  available_skills?: AvailableSkillItem[];
  stage_definitions?: StageDefinitionItem[];
  template_yaml?: string;
  project_layer: Record<string, unknown> | null;
  template_snapshot: Record<string, unknown>[];
  connector_fields: ConnectorParameterField[];
  project_file: {
    path: string | null;
    exists: boolean;
    status: 'read' | 'template' | 'missing';
    content: string | null;
  };
  connector_health: Record<string, ConnectorHealthRecord>;
}

export interface SkillFrontmatter {
  id?: string;
  version?: string;
  summary?: string;
  category?: string;
  entrypoints?: string[];
  required_tools?: string[];
  forbidden_tools?: string[];
  input_schema?: string;
  output_schema?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SkillMlflowMetrics {
  contract_status?: number;
  citation_rate?: number;
  temporal_precision?: number;
  secrets_absent?: number;
  instruction_chars?: number;
  quality_score?: number;
  [key: string]: number | undefined;
}

export interface SkillMlflowReport {
  run_id: string;
  experiment_id: string;
  experiment_name: string;
  status: string;
  stage_executed: string;
  timestamp: number;
  baseline_metrics: SkillMlflowMetrics;
  candidate_metrics: SkillMlflowMetrics;
  improvement: {
    delta: number;
    status: 'IMPROVED' | 'MAINTAINED' | 'REGRESSED';
    summary: string;
  };
}

export interface SkillSaveResponse {
  saved: boolean;
  skill_id: string;
  stage: string;
  project_id: string;
  tenant_id: string;
  is_overridden_in_project: boolean;
  project_instruction: string;
  project_enabled: boolean;
  mlflow: SkillMlflowReport;
}

export interface SkillItem {
  id: string;
  name?: string;
  status?: string;
  size_bytes?: number;
  sha256?: string;
  source?: string;
  stage?: string;
  immutable?: boolean;
  allowed_actions?: string[];
  project_override?: boolean;
  user_override?: boolean;
  content?: string;
  frontmatter?: SkillFrontmatter;
  instruction_body?: string;
  is_overridden_in_project?: boolean;
  project_instruction?: string | null;
  project_enabled?: boolean;
  project_actions?: string[] | null;
}

export type HarnessResourceKind = 'agent' | 'skill' | 'capability' | 'plugin';
export interface HarnessSelection {
  agents: string[];
  disabled_agents: string[];
  plugins: string[];
  disabled_skills?: string[];
  disabled_capabilities?: string[];
  disabled_plugins: string[];
}
export interface HarnessDocument {
  version: number;
  agents: Array<{ enabled: boolean; definition: AgentDefinition }>;
  plugins: Array<{ id: string; name: string; description: string; capabilities: string[]; skills: string[]; agents: string[]; enabled: boolean }>;
}
export interface HarnessResponse {
  revision: string;
  document: HarnessDocument;
  selection: HarnessSelection;
  effective_agents: string[];
  effective_plugins: string[];
  effective_skills?: string[];
  effective_capabilities?: string[];
  project_revision?: string;
}
export interface AgentDefinition {
  id: string; version: string; name: string; description: string; instruction: string;
  capability: string; model_profile: string; tools: string[]; stage_model: string;
}
export interface HarnessLibraryItem {
  id: string;
  name: string;
  kind: HarnessResourceKind;
  description?: string;
  version?: string;
  source: 'platform' | 'project';
  inherited: boolean;
  selected: boolean;
  customizable: boolean;
  immutable?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationDefinition {
  name: string;
  kind: 'mcp' | 'a2a';
  endpoint: string;
  description: string;
  auth_method: 'none' | 'bearer';
  secret_reference: string;
  transport: 'streamable_http' | 'sse' | 'stdio' | 'a2a_jsonrpc' | 'a2a_rest';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout_seconds: number;
  allow_project_override: boolean;
}
export interface IntegrationRegistration {
  id: string;
  definition: IntegrationDefinition;
  revision: string;
  platform_definition: IntegrationDefinition | null;
  platform_revision: string;
  project_revision: string;
  scope_level: ScopeLevel;
}

// ----------------------------------------------------------------------------
// Platform Admin Management Types
// ----------------------------------------------------------------------------
export interface UserItem {
  id: string;
  name: string;
  email?: string | null;
  roles: string[];
  status: 'active' | 'inactive';
  tenant_id?: string;
  project_id?: string;
  groups?: string[];
  authn_method?: string;
  updated_at?: number;
}

export interface UserPayload {
  id?: string;
  name: string;
  email?: string | null;
  roles: string[];
  status: 'active' | 'inactive';
}

export interface RoleItem {
  id: string;
  role_id?: string;
  name: string;
  tier?: string;
  description: string;
  permissions: string[];
  is_system?: boolean;
  status: 'active' | 'deprecated';
  updated_at?: number;
}

export interface RolePayload {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
  status: 'active' | 'deprecated';
}

export interface BillingUsageTelemetry {
  total_runs: number;
  active_runs: number;
  completed_runs: number;
  failed_runs: number;
  total_evidence_collected: number;
  estimated_tokens_processed: number;
  month_to_date_spend_usd: number;
  budget_consumed_percent: number;
}

export interface BillingConfig {
  tenant_id: string;
  project_id: string;
  tier: string;
  monthly_spend_budget: number;
  monthly_token_budget: number;
  max_concurrent_investigations: number;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  alert_threshold_percent: number;
  webhook_url?: string;
  pricing_matrix: Record<string, { input_per_million: number; output_per_million: number }>;
  usage?: BillingUsageTelemetry;
  updated_at?: number;
}

export interface BillingPayload {
  tier: string;
  monthly_spend_budget: number;
  monthly_token_budget: number;
  max_concurrent_investigations: number;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  alert_threshold_percent: number;
  webhook_url?: string;
  pricing_matrix: Record<string, { input_per_million: number; output_per_million: number }>;
}

export interface RedactionPattern {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
  description: string;
}

export interface PolicyConfig {
  redaction_patterns: RedactionPattern[];
  guardrails: {
    dual_custody_enforced?: boolean;
    max_tool_call_depth?: number;
    request_deadline_seconds?: number;
    write_protection_active?: boolean;
    blocked_keywords?: string[];
    [key: string]: unknown;
  };
  skills?: Record<string, {
    actions?: string[];
    immutable?: boolean;
    project_override?: boolean;
    [key: string]: unknown;
  }>;
  updated_at?: number;
}

export interface FileLimitsConfig {
  tenant_id: string;
  project_id: string;
  max_file_bytes: number;
  max_files: number;
  max_text_chars: number;
  max_pdf_pages: number;
  max_rows: number;
  max_cells: number;
  parser_timeout_seconds: number;
  concurrency: number;
  allowed_extensions: string[];
  retention_days: number;
  auto_prune_enabled: boolean;
  updated_at?: number;
}

export interface PlatformFileProcessingConfig {
  section: 'file-processing';
  values: Record<string, unknown>;
  active_values: Record<string, unknown>;
  content_hash: string;
  activation: string;
  pending_restart?: boolean;
}

export interface CleanupResult {
  status: string;
  purged_attachments: number;
  purged_runs: number;
  purged_artifacts?: number;
  freed_bytes: number | null;
  deleted_records?: number;
  retention_cutoff_utc: string;
  timestamp: string;
  message: string;
}

export interface KnowledgeItem {
  id: string;
  doc_id?: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
  media_type: string;
  size_bytes: number;
  status: string;
  created_at?: number;
  updated_at?: number;
}

export interface KnowledgePayload {
  title: string;
  category: string;
  tags: string[];
  content: string;
  media_type?: string;
  status?: string;
}

export interface RuntimeStageItem {
  stage_id: string;
  name: string;
  model: string;
  thinking_level: string | null;
  thinking_budget: number | null;
  output_limit: number;
  temperature: number;
  enabled: boolean;
  content_hash: string;
  editable_fields?: string[];
  immutable_fields?: string[];
  updated_at?: number;
}

export interface RuntimeStagePayload {
  model: string;
  thinking_level?: string | null;
  thinking_budget?: number | null;
  output_limit: number;
  temperature: number;
  enabled: boolean;
  expected_hash: string;
}

export interface CustomAlertPayload {
  severity: 'critical' | 'warning' | 'info';
  source: string;
  component: string;
  title: string;
  summary: string;
  message: string;
}

export interface AlertConfig {
  mttr_warning_minutes: number;
  tool_failure_rate_percent: number;
  probe_latency_warning_ms: number;
  updated_at?: number;
}

export interface PlatformSettingsConfig {
  run_timeout_seconds: number;
  max_concurrent_runs: number;
  max_llm_calls: number;
  max_input_chars: number;
  max_context_chars: number;
  retention_days: number;
  allowed_extensions: string[];
  mode: string;
  updated_at?: number;
}

export interface UiNavigationItem {
  page: string;
  label: string;
  description: string;
  group: string;
  visible: boolean;
}

export interface UiSettingsConfig {
  tenant_id?: string;
  project_id?: string;
  brand_name: string;
  workspace_label: string;
  default_theme: 'dark' | 'light' | 'system';
  default_page: string;
  welcome_title: string;
  welcome_description: string;
  navigation: UiNavigationItem[];
  version: number;
  updated_at?: number;
}

export interface FileProcessingValues {
  max_file_bytes: number;
  max_files: number;
  max_expanded_bytes: number;
  max_zip_members: number;
  max_pdf_pages: number;
  max_rows: number;
  max_cells: number;
  max_text_chars: number;
  max_image_pixels: number;
  parser_timeout_seconds: number;
  concurrency: number;
  allowed_extensions: string[];
}

export interface PlatformConfigurationSnapshot {
  section: string;
  source: string;
  values: FileProcessingValues & Record<string, unknown>;
  active_values: FileProcessingValues & Record<string, unknown>;
  fields: Record<string, unknown>;
  content_hash: string;
  activation: string;
  pending_restart: boolean;
}
