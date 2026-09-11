import { Principal, AgentConfiguration, Run, ToolDefinition, AuditLog, SystemHealth, SystemDiagnostics, CapabilityItem } from '../types/api';
let inMemoryToken: string | null = null;
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
  if (!response.ok) { let detail: unknown = null; try { detail = await response.clone().json(); } catch { detail = response.statusText; } const message = typeof detail === 'string' ? detail : (detail && typeof detail === 'object' && 'detail' in detail ? String((detail as { detail: unknown }).detail) : `HTTP ${response.status}`); throw new ApiError(response.status, message, detail); }
  return response.status === 204 ? null as T : response.json() as Promise<T>;
}
function mapRun(raw: any): Run { const result = raw.result; return { id: raw.run_id, capability: raw.capability, prompt: result?.summary || raw.reason || '', status: raw.status === 'SUCCEEDED' ? 'COMPLETED' : raw.status, created_at: raw.created_at ? new Date(raw.created_at * 1000).toISOString() : '', completed_at: raw.updated_at ? new Date(raw.updated_at * 1000).toISOString() : undefined, duration_seconds: raw.created_at && raw.updated_at ? Math.max(0, raw.updated_at - raw.created_at) : undefined, stages: raw.stage ? [{ name: raw.stage, status: raw.status === 'RUNNING' ? 'running' : 'completed', agent: raw.stage, duration_ms: 0 }] : [], evidence_count: raw.evidence_count ?? 0, findings: result?.summary || raw.reason }; }
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
export async function triggerRun(capability: string, prompt: string, incidentId?: string): Promise<Run> { return mapRun(await request('/api/v1/runs', { method: 'POST', body: { capability, prompt, incident_id: incidentId || null, attachment_ids: [] } })); }
export async function fetchCapabilities(): Promise<CapabilityItem[]> { return request<CapabilityItem[]>('/api/v1/capabilities'); }
export async function fetchTools(): Promise<ToolDefinition[]> { return request<ToolDefinition[]>('/api/v1/tools'); }
export async function fetchAuditLogs(): Promise<AuditLog[]> { return request<AuditLog[]>('/api/v1/audit'); }
export async function fetchSystemDiagnostics(): Promise<SystemDiagnostics> { return request<SystemDiagnostics>('/api/v1/system/diagnostics'); }
export async function fetchOptimizationDatasets(): Promise<unknown[]> { return request<unknown[]>('/api/v1/optimization-datasets'); }
export async function fetchOptimization(id: string): Promise<unknown> { return request(`/api/v1/optimizations/${encodeURIComponent(id)}`); }
export async function fetchUsers(): Promise<Array<{ id: string; name: string; email?: string; roles: string[]; status: string }>> { return request('/api/v1/users'); }
export async function fetchKnowledge(): Promise<any[]> { return request('/api/v1/knowledge'); }
export async function fetchConfig(): Promise<any> { return request('/api/v1/config'); }
export async function fetchParameters(): Promise<any> { return request('/api/v1/parameters'); }
export async function fetchOptimizations(): Promise<any[]> { return request('/api/v1/optimizations'); }
export async function createOptimization(body: unknown): Promise<any> { return request('/api/v1/optimizations', { method: 'POST', body }); }
export async function reviewOptimization(id: string, approve: boolean, expectedHash: string, reason: string): Promise<any> { return request(`/api/v1/optimizations/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { expected_hash: expectedHash, reason } }); }
export async function setParameterOverride(tool: string, name: string, body: unknown): Promise<any> { return request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/override`, { method: 'PUT', body }); }
export async function resetParameterOverride(tool: string, name: string, revision: number): Promise<void> { await request(`/api/v1/parameters/${encodeURIComponent(tool)}/${encodeURIComponent(name)}/override?expected_revision=${revision}`, { method: 'DELETE' }); }
export async function fetchSkills(): Promise<any[]> { return request('/api/v1/skills'); }
export async function fetchRoles(): Promise<any> { return request('/api/v1/roles'); }
export async function fetchPolicy(): Promise<any> { return request('/api/v1/policy'); }
