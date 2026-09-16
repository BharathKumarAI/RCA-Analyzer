import type { RunConnectorSelections } from '../../types/api';
import { authHeaders } from '../../services/api';
import type { CatalogItem, GraphEdge, GraphNode, Permissions, Workspace } from './types/workspace.generated';

export type StudioSeverity = 'error' | 'warning' | 'info';

export type StudioGraphNode = GraphNode;

export type StudioGraphEdge = GraphEdge & { label?: string | null };

export interface StudioGraph {
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
}

export type StudioCatalogItem = CatalogItem;

export interface StudioDiagnostic {
  path?: string | null;
  message: string;
  severity: StudioSeverity;
  line?: number;
  column?: number;
}

export type StudioWorkspace = Workspace & {
  graph: StudioGraph;
  diagnostics: StudioDiagnostic[];
  permissions: Permissions & { [key: string]: unknown };
  catalog?: CatalogItem[];
};

export interface StudioDraftSummary {
  draft_id: string;
  revision: string;
  status: string;
  author_subject?: string;
  capability?: string;
  updated_at?: number;
}

export interface StudioTraceEvent {
  sequence: number;
  node_id?: string | null;
  kind: string;
  timestamp?: string | number | null;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StudioTrace {
  graph?: StudioGraph;
  events: StudioTraceEvent[];
  run_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface StudioRunEvent {
  type: 'run' | 'progress' | 'trace' | 'complete' | 'error' | string;
  data: Record<string, unknown>;
}

type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = authHeaders(options.headers, options.method);
  headers.set('Accept', 'application/json');
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const { body, ...requestInit } = options;
  const response = await fetch(path, { ...requestInit, credentials: 'same-origin', headers, body: body as BodyInit | null | undefined });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.clone().json();
      detail = typeof payload?.detail === 'string' ? payload.detail : JSON.stringify(payload);
    } catch {
      // Keep the HTTP status text when the API did not return JSON.
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

function query(capability: string, extra = ''): string {
  const params = new URLSearchParams({ capability });
  return `${params.toString()}${extra ? `&${extra}` : ''}`;
}

export function fetchStudioWorkspace(capability: string, draftId?: string | null): Promise<StudioWorkspace> {
  return request<StudioWorkspace>(`/api/v1/harness/workspace?${query(capability, draftId ? `draft_id=${encodeURIComponent(draftId)}` : '')}`);
}

export function fetchStudioDrafts(capability: string): Promise<StudioDraftSummary[]> {
  return request<StudioDraftSummary[]>(`/api/v1/harness/drafts?${query(capability)}`);
}

export function validateStudioWorkspace(files: Record<string, string>, capability: string): Promise<StudioWorkspace> {
  return request<StudioWorkspace>('/api/v1/harness/validate', {
    method: 'POST',
    body: { files, capability },
  });
}

export function saveStudioDraft(payload: {
  files: Record<string, string>;
  capability: string;
  expected_revision: string;
  draft_id?: string | null;
}): Promise<StudioWorkspace> {
  return request<StudioWorkspace>('/api/v1/harness/draft', { method: 'PUT', body: payload });
}

export function reviewStudioDraft(
  draftId: string,
  action: 'submit' | 'approve' | 'reject' | 'revoke',
  expectedRevision: string,
  reason: string,
): Promise<StudioWorkspace> {
  return request<StudioWorkspace>(`/api/v1/harness/drafts/${encodeURIComponent(draftId)}/${action}`, {
    method: 'POST',
    body: { expected_revision: expectedRevision, reason },
  });
}

export function importStudioBundle(file: File, capability: string): Promise<StudioWorkspace> {
  const body = new FormData();
  body.append('file', file);
  body.append('capability', capability);
  return request<StudioWorkspace>('/api/v1/harness/import', { method: 'POST', body });
}

export async function exportStudioBundle(capability: string, draftId?: string | null): Promise<Blob> {
  const headers = authHeaders({ Accept: 'application/zip, application/octet-stream' });
  const params = query(capability, draftId ? `draft_id=${encodeURIComponent(draftId)}` : '');
  const response = await fetch(`/api/v1/harness/export?${params}`, { headers, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  return response.blob();
}

export async function fetchStudioTrace(runId: string): Promise<StudioTrace> {
  return request<StudioTrace>(`/api/v1/runs/${encodeURIComponent(runId)}/trace`);
}

export async function streamStudioRun(
  capability: string,
  prompt: string,
  onEvent: (event: StudioRunEvent) => void,
  signal?: AbortSignal,
  options?: { chatId?: string; attachmentIds?: string[]; incidentId?: string; idempotencyKey?: string; connectorSelections?: RunConnectorSelections },
): Promise<Record<string, unknown>> {
  const headers = authHeaders({ Accept: 'text/event-stream, application/json' }, 'POST');
  headers.set('Content-Type', 'application/json');
  if (options?.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  const response = await fetch(`/api/v1/runs?stream=true`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    signal,
    body: JSON.stringify({ capability, prompt, ...(options?.chatId ? { chat_id: options.chatId } : {}), ...(options?.attachmentIds ? { attachment_ids: options.attachmentIds } : {}), ...(options?.incidentId ? { incident_id: options.incidentId } : {}), ...(options?.connectorSelections ? { connector_selections: options.connectorSelections } : {}) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = typeof payload?.detail === 'string' ? payload.detail : payload?.detail?.message;
    throw new Error(detail || `Run failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = (await response.json()) as Record<string, unknown>;
    const type = payload.status === 'FAILED' ? 'error' : 'complete';
    onEvent({ type, data: payload });
    return payload;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last: Record<string, unknown> = {};
  let terminal = false;
  const emit = (frame: string) => {
    const lines = frame.split('\n');
    const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'progress';
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The investigation returned an unreadable update.');
    last = parsed as Record<string, unknown>;
    terminal ||= type === 'complete' || type === 'error';
    onEvent({ type, data: last });
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        emit(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > 2_000_000) throw new Error('An investigation update exceeded the allowed size.');
      if (done) break;
    }
    if (buffer.trim()) emit(buffer);
    if (!terminal) throw new Error('The connection ended before the investigation finished. Reload this conversation to check its saved status.');
    return last;
  } finally {
    reader.releaseLock();
  }
}

export function downloadStudioBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
