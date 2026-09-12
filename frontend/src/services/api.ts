import type {
  Principal, AgentConfiguration, Run, ToolDefinition, AuditLog, SystemHealth, SystemDiagnostics, CapabilityItem, ConnectorTemplateItem, RuntimeConfig,
  ConnectorsHealthResponse, AlertsResponse, NotificationsResponse, ProjectSetupResponse,
  ParameterDefinitionRow,
  ConnectorHealthRecord, SkillItem, SkillSaveResponse, ProjectValidationResult, ConnectionTestResponse,
  HarnessResponse, HarnessSelection,
  UserItem, UserPayload, RoleItem, RolePayload, BillingConfig, BillingPayload,
  PolicyConfig, RedactionPattern, FileLimitsConfig, CleanupResult, KnowledgeItem, KnowledgePayload,
  RuntimeStageItem, RuntimeStagePayload, CustomAlertPayload, AlertConfig, PlatformSettingsConfig
} from '../types/api';
// Session credentials stay in memory; discard storage left by older builds.
let inMemoryToken: string | null = null;
if (typeof window !== 'undefined') {
  for (const name of ['sessionStorage', 'localStorage'] as const) {
    try { window[name].removeItem('rca_auth_token'); } catch { /* Storage may be disabled. */ }
  }
}
export const setSessionToken = (token: string | null) => { inMemoryToken = token?.trim() || null; };
export const getSessionToken = () => inMemoryToken;
export const hasSessionToken = () => Boolean(inMemoryToken);
export class ApiError extends Error { constructor(public status: number, message: string, public details: unknown = null) { super(message); this.name = 'ApiError'; } }
type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };
async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('Accept', 'application/json'); if (inMemoryToken) headers.set('Authorization', `Bearer ${inMemoryToken}`);
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) { headers.set('Content-Type', 'application/json'); options = { ...options, body: JSON.stringify(options.body) }; }
  const { body, ...requestInit } = options;
  let response: Response; try { response = await fetch(path, { ...requestInit, headers, body: body as BodyInit | null | undefined }); } catch (error) { throw new ApiError(0, error instanceof Error ? error.message : 'Network request failed'); }
  if (!response.ok) { let detail: unknown = null; try { detail = await response.clone().json(); } catch { detail = response.statusText; } const value = detail && typeof detail === 'object' && 'detail' in detail ? (detail as { detail: unknown }).detail : detail;
    const message = typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => item && typeof item === 'object' && 'msg' in item ? `${Array.isArray(item.loc) ? item.loc.join('.') + ': ' : ''}${item.msg}` : JSON.stringify(item)).join('; ') : `HTTP ${response.status}`; throw new ApiError(response.status, message, detail); }
  return response.status === 204 ? null as T : response.json() as Promise<T>;
}
function mapRun(raw: any): Run { const result = raw.result; return { id: raw.run_id, mode: raw.mode, result: raw.result, capability: raw.capability, prompt: result?.summary || raw.reason || '', status: raw.status === 'SUCCEEDED' ? 'COMPLETED' : raw.status, created_at: raw.created_at ? new Date(raw.created_at * 1000).toISOString() : '', completed_at: raw.updated_at ? new Date(raw.updated_at * 1000).toISOString() : undefined, duration_seconds: raw.created_at && raw.updated_at ? Math.max(0, raw.updated_at - raw.created_at) : undefined, stages: raw.stage ? [{ name: raw.stage, status: raw.status === 'RUNNING' ? 'running' : 'completed', agent: raw.stage, duration_ms: 0 }] : [], evidence_count: raw.evidence_count ?? 0, findings: result?.summary || raw.reason }; }
function mapAgent(raw: any): AgentConfiguration { const d = raw.definition || raw; return { id: raw.draft_id || d.id, name: d.name, role: 'Specialist', description: d.description || '', status: raw.status === 'APPROVED' ? 'active' : raw.status === 'PENDING' ? 'pending' : raw.status === 'REVOKED' ? 'deprecated' : 'draft', model: d.model_profile || d.stage_model || 'configured', temperature: 0, thinking_budget: 0, max_steps: 0, tools: [...(d.tools || [])], permissions: [], rag_sources: [], prompt: d.instruction || '', accuracy: 0, hallucination_rate: 0, avg_latency_sec: 0, version: d.version || '', updated_at: raw.created_at ? new Date(raw.created_at * 1000).toISOString() : '', author: raw.author_subject, content_hash: raw.content_hash, approved_by: raw.reviewer_subject, rejection_reason: raw.review_reason }; }
export async function fetchHealth(): Promise<SystemHealth> { const started = performance.now(); const data = await request<any>('/api/v1/health'); return { status: data.status, latency_ms: Math.round(performance.now() - started), tenant_id: data.tenant_id, project_id: data.project_id, mode: data.mode, active_runs: data.active_runs, total_runs: data.total_runs, mttr_minutes: 0, tool_success_rate: 0, active_agents_count: 0 }; }
export async function fetchPrincipal(): Promise<Principal> { return request<Principal>('/api/v1/me'); }
export async function fetchAgents(): Promise<AgentConfiguration[]> { return (await request<any[]>('/api/v1/agent-configurations')).map(mapAgent); }
export async function submitAgentYaml(yaml: string): Promise<AgentConfiguration> { return mapAgent(await request('/api/v1/agent-configurations', { method: 'POST', body: { yaml } })); }
export async function approveAgent(id: string, expectedHash: string, reason: string) { return mapAgent(await request(`/api/v1/agent-configurations/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { expected_hash: expectedHash, reason } })); }
export async function rejectAgent(id: string, expectedHash: string, reason: string) { return mapAgent(await request(`/api/v1/agent-configurations/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { expected_hash: expectedHash, reason } })); }
export async function revokeAgent(id: string, reason: string) { return mapAgent(await request(`/api/v1/agent-configurations/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: { reason } })); }
export async function fetchRuns(): Promise<Run[]> { return (await request<any[]>('/api/v1/runs?limit=50')).map(mapRun); }
export async function fetchRun(id: string): Promise<Run> { return mapRun(await request(`/api/v1/runs/${encodeURIComponent(id)}`)); }
export async function cancelRun(id: string): Promise<Run> { return mapRun(await request(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })); }
export async function uploadInvestigationFiles(files: File[], chatId?: string): Promise<{ chat_id: string; attachments: Array<{ attachment_id: string }> }> {
  const body = new FormData(); files.forEach(file => body.append('files', file)); if (chatId) body.append('chat_id', chatId);
  return request('/api/v1/files', { method: 'POST', body });
}
export async function triggerRun(capability: string, prompt: string, incidentId?: string, attachmentIds: string[] = [], chatId?: string): Promise<Run> { return mapRun(await request('/api/v1/runs', { method: 'POST', body: { capability, prompt, incident_id: incidentId || null, chat_id: chatId || null, attachment_ids: attachmentIds } })); }
export async function fetchCapabilities(all = false): Promise<CapabilityItem[]> { return request<CapabilityItem[]>(`/api/v1/capabilities${all ? '?all=true' : ''}`); }
export async function fetchTools(): Promise<ToolDefinition[]> { return request<ToolDefinition[]>('/api/v1/tools'); }
export async function fetchConnectorTemplates(): Promise<ConnectorTemplateItem[]> { return request<ConnectorTemplateItem[]>('/api/v1/tools/templates'); }
export async function fetchConnectorsHealth(): Promise<ConnectorsHealthResponse> { return request<ConnectorsHealthResponse>('/api/v1/connectors/health'); }
export async function fetchConnectorHealthCheck(connector: string): Promise<ConnectorHealthRecord> {
  return request<ConnectorHealthRecord>(`/api/v1/connectors/${encodeURIComponent(connector)}/health`);
}
export async function fetchAlerts(): Promise<AlertsResponse> { return request<AlertsResponse>('/api/v1/alerts'); }
export async function fetchNotifications(): Promise<NotificationsResponse> { return request<NotificationsResponse>('/api/v1/notifications'); }
export async function fetchProjectSetup(): Promise<ProjectSetupResponse> { return request<ProjectSetupResponse>('/api/v1/project/setup'); }
export async function validateProjectSetup(yaml: string): Promise<ProjectValidationResult> {
  return request<ProjectValidationResult>('/api/v1/project/validate', { method: 'POST', body: { yaml } });
}
export async function saveProjectSetup(yaml: string): Promise<ProjectSetupResponse> {
  return request<ProjectSetupResponse>('/api/v1/project/setup', { method: 'POST', body: { yaml } });
}
export async function fetchAuditLogs(): Promise<AuditLog[]> { return request<AuditLog[]>('/api/v1/audit'); }
export async function fetchSystemDiagnostics(): Promise<SystemDiagnostics> { return request<SystemDiagnostics>('/api/v1/system/diagnostics'); }
export async function testSystemConnection(target: 'all' | 'database' | 'memory' | 'storage' | 'mlflow' | 'connectors' = 'all'): Promise<ConnectionTestResponse> {
  return request<ConnectionTestResponse>('/api/v1/system/test-connection', { method: 'POST', body: { target } });
}
export async function fetchOptimizationDatasets(): Promise<unknown[]> { return request<unknown[]>('/api/v1/optimization-datasets'); }
export async function fetchOptimization(id: string): Promise<unknown> { return request(`/api/v1/optimizations/${encodeURIComponent(id)}`); }
export async function fetchUsers(): Promise<UserItem[]> { return request<UserItem[]>('/api/v1/users'); }
export async function createUser(payload: UserPayload): Promise<UserItem> { return request('/api/v1/users', { method: 'POST', body: payload }); }
export async function updateUser(id: string, payload: UserPayload): Promise<UserItem> { return request(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }); }
export async function deleteUser(id: string): Promise<void> { await request(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

export async function fetchRoles(): Promise<RoleItem[]> { return request<RoleItem[]>('/api/v1/roles'); }
export async function createRole(payload: RolePayload): Promise<RoleItem> { return request('/api/v1/roles', { method: 'POST', body: payload }); }
export async function updateRole(id: string, payload: RolePayload): Promise<RoleItem> { return request(`/api/v1/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }); }
export async function deleteRole(id: string): Promise<void> { await request(`/api/v1/roles/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function fetchPermissions(): Promise<string[]> { return request<string[]>('/api/v1/permissions'); }

export async function fetchBilling(): Promise<BillingConfig> { return request<BillingConfig>('/api/v1/billing'); }
export async function updateBilling(payload: BillingPayload): Promise<BillingConfig> { return request('/api/v1/billing', { method: 'PUT', body: payload }); }

export async function fetchPolicy(): Promise<PolicyConfig> { return request<PolicyConfig>('/api/v1/policy'); }
export async function updatePolicy(payload: Partial<PolicyConfig>): Promise<PolicyConfig> { return request('/api/v1/policy', { method: 'PUT', body: payload }); }

export async function fetchFileLimits(): Promise<FileLimitsConfig> { return request<FileLimitsConfig>('/api/v1/persistence/limits'); }
export async function updateFileLimits(payload: Partial<FileLimitsConfig>): Promise<FileLimitsConfig> { return request('/api/v1/persistence/limits', { method: 'PUT', body: payload }); }
export async function triggerRetentionCleanup(): Promise<CleanupResult> { return request<CleanupResult>('/api/v1/persistence/cleanup', { method: 'POST' }); }

export async function fetchKnowledge(): Promise<KnowledgeItem[]> { return request<KnowledgeItem[]>('/api/v1/knowledge'); }
export async function createKnowledgeDoc(payload: KnowledgePayload): Promise<KnowledgeItem> { return request('/api/v1/knowledge', { method: 'POST', body: payload }); }
export async function updateKnowledgeDoc(id: string, payload: KnowledgePayload): Promise<KnowledgeItem> { return request(`/api/v1/knowledge/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }); }
export async function deleteKnowledgeDoc(id: string): Promise<void> { await request(`/api/v1/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

export async function fetchRuntimeStages(): Promise<RuntimeStageItem[]> { return request<RuntimeStageItem[]>('/api/v1/runtime/stages'); }
export async function updateRuntimeStage(stageId: string, payload: RuntimeStagePayload): Promise<RuntimeStageItem> { return request(`/api/v1/runtime/stages/${encodeURIComponent(stageId)}`, { method: 'PUT', body: payload }); }

export async function createAlert(payload: CustomAlertPayload): Promise<any> { return request('/api/v1/alerts', { method: 'POST', body: payload }); }
export async function updateAlertStatus(id: string, status: 'acknowledged' | 'resolved', resolutionNote?: string): Promise<any> { return request(`/api/v1/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, resolution_note: resolutionNote } }); }
export async function fetchAlertConfig(): Promise<AlertConfig> { return request<AlertConfig>('/api/v1/alerts/config'); }
export async function updateAlertConfig(payload: AlertConfig): Promise<AlertConfig> { return request('/api/v1/alerts/config', { method: 'PUT', body: payload }); }

export async function fetchPlatformSettings(): Promise<PlatformSettingsConfig> { return request<PlatformSettingsConfig>('/api/v1/platform/settings'); }
export async function updatePlatformSettings(payload: Partial<PlatformSettingsConfig>): Promise<PlatformSettingsConfig> { return request('/api/v1/platform/settings', { method: 'PUT', body: payload }); }

export async function fetchConfig(): Promise<RuntimeConfig> { return request<RuntimeConfig>('/api/v1/config'); }
export async function fetchParameters(): Promise<ParameterDefinitionRow[]> { return request<ParameterDefinitionRow[]>('/api/v1/parameters'); }
export async function fetchOptimizations(): Promise<any[]> { return request('/api/v1/optimizations'); }
export async function createOptimization(body: unknown): Promise<any> { return request('/api/v1/optimizations', { method: 'POST', body }); }
export async function reviewOptimization(id: string, approve: boolean, expectedHash: string, reason: string): Promise<any> { return request(`/api/v1/optimizations/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { expected_hash: expectedHash, reason } }); }
export async function setParameterOverride(tool: string, name: string, body: unknown): Promise<any> { return request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/override`, { method: 'PUT', body }); }
export async function defineParameter(tool: string, name: string, body: {
  value_type: ParameterDefinitionRow['value_type'];
  description: string;
  default_value: unknown;
  allow_project_override: boolean;
  icon: string;
  expected_revision: number;
}): Promise<{ revision: number }> {
  return request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/definition`, { method: 'PUT', body });
}
export async function deleteParameterDefinition(tool: string, name: string, revision: number): Promise<void> {
  await request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/definition?expected_revision=${revision}`, { method: 'DELETE' });
}
export async function resetParameterOverride(tool: string, name: string, revision: number): Promise<void> { await request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/override?expected_revision=${revision}`, { method: 'DELETE' }); }
export async function fetchSkills(): Promise<SkillItem[]> { return request<SkillItem[]>('/api/v1/skills'); }
export async function saveProjectSkill(
  skillId: string,
  payload: { instruction: string; enabled?: boolean; actions?: string[] }
): Promise<SkillSaveResponse> {
  return request<SkillSaveResponse>(`/api/v1/skills/${encodeURIComponent(skillId)}`, {
    method: 'POST',
    body: payload,
  });
}
export async function resetProjectSkill(skillId: string): Promise<{ reset: boolean; skill_id: string; status: string }> {
  return request<{ reset: boolean; skill_id: string; status: string }>(`/api/v1/skills/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
  });
}
export async function fetchHarnessLibrary(): Promise<HarnessResponse> {
  return request<HarnessResponse>('/api/v1/harness');
}
export async function updateHarnessLibrary(selection: HarnessSelection, expectedRevision: string, expectedProjectRevision: string): Promise<HarnessResponse> {
  return request<HarnessResponse>('/api/v1/harness/project', { method: 'PUT', body: { selection, expected_revision: expectedRevision, expected_project_revision: expectedProjectRevision } });
}
export async function resetHarnessLibrary(expectedProjectRevision: string): Promise<HarnessResponse> {
  return request<HarnessResponse>(`/api/v1/harness/project?expected_project_revision=${encodeURIComponent(expectedProjectRevision)}`, { method: 'DELETE' });
}
export async function updatePlatformHarness(document: import('../types/api').HarnessDocument, expectedRevision: string): Promise<HarnessResponse> {
  return request<HarnessResponse>('/api/v1/harness/platform', { method: 'PUT', body: { document, expected_revision: expectedRevision } });
}

export interface RunEvidence {
  evidence_id: string;
  source: { connector: string; system: string };
  observed_at: string;
  content_json: string;
  content_hash: string;
  classification: string;
}
export async function fetchRunEvidence(id: string): Promise<RunEvidence[]> {
  return request(`/api/v1/runs/${encodeURIComponent(id)}/evidence`);
}

export async function saveIntegration(scope: 'platform' | 'project', id: string, body: {
  definition: import('../types/api').IntegrationDefinition;
  expected_revision: string;
  expected_platform_revision: string;
}): Promise<import('../types/api').IntegrationRegistration[]> {
  return request(`/api/v1/integrations/${scope}/${encodeURIComponent(id)}`, { method: 'PUT', body });
}
export async function resetProjectIntegration(id: string, revision: string): Promise<void> {
  return request(`/api/v1/integrations/project/${encodeURIComponent(id)}?expected_revision=${encodeURIComponent(revision)}`, { method: 'DELETE' });
}

export interface IntegrationTestResult {
  status: 'reachable' | 'failed' | 'blocked';
  message: string;
  latency_ms?: number;
  checked_at: string;
  revision: string;
}
export async function testIntegration(id: string): Promise<IntegrationTestResult> {
  return request(`/api/v1/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' });
}

export async function registerOptimizationDataset(body: Record<string, unknown>): Promise<{ dataset_id: string; version: string }> {
  return request('/api/v1/optimization-datasets', { method: 'POST', body });
}


export async function previewMcpImport(source: string, format: 'json' | 'command'): Promise<{
  connections: { id: string; definition: import('../types/api').IntegrationDefinition }[];
}> {
  return request('/api/v1/integrations/mcp/preview', {
    method: 'POST', headers: { 'Content-Type': format === 'json' ? 'application/json' : 'text/plain' }, body: source,
  });
}

export async function setProjectAvailability(kind: 'connectors' | 'capabilities', id: string, enabled: boolean, expectedEnabled: boolean): Promise<void> {
  await request(`/api/v1/project/availability/${kind}/${encodeURIComponent(id)}`, {
    method: 'PUT', body: { enabled, expected_enabled: expectedEnabled },
  });
}
