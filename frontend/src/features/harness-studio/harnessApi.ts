import { getSessionToken } from '../../services/api';
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
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const { body, ...requestInit } = options;
  const response = await fetch(path, { ...requestInit, headers, body: body as BodyInit | null | undefined });
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
  const headers = new Headers({ Accept: 'application/zip, application/octet-stream' });
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const params = query(capability, draftId ? `draft_id=${encodeURIComponent(draftId)}` : '');
  const response = await fetch(`/api/v1/harness/export?${params}`, { headers });
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
): Promise<Record<string, unknown>> {
  const headers = new Headers({ Accept: 'text/event-stream, application/json' });
  headers.set('Content-Type', 'application/json');
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api/v1/runs?stream=true`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ capability, prompt }),
  });
  if (!response.ok) throw new Error(`Run failed (${response.status})`);

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
  let eventType = 'message';
  let last: Record<string, unknown> = {};
  const emit = (raw: string) => {
    const data = raw.trim();
    if (!data) return;
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      last = parsed;
      onEvent({ type: eventType === 'message' ? String(parsed.type || 'progress') : eventType, data: parsed });
    } catch {
      onEvent({ type: eventType === 'message' ? 'progress' : eventType, data: { message: data } });
    }
    eventType = 'message';
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) emit(line.slice(5));
      else if (!line.trim()) eventType = 'message';
    }
    if (done) break;
  }
  emit(buffer);
  return last;
}

export function downloadStudioBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
