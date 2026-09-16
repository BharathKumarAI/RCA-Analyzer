import { ApiError, authHeaders, request } from './api';
import type { KnowledgeItem } from '../types/api';

export interface OkfBundle { bundle_id: string; name: string; revision: number; content_hash: string; concept_count: number; updated_at: number }
export interface OkfDiagnostic { path: string; code: string; message: string }
export interface OkfPreview {
  bundle_id: string | null; name: string; source_hash: string; preview_hash: string;
  concepts: { path: string; title: string; type: string; content: string; metadata: Record<string, unknown>; redacted: boolean; source_hash: string; doc_id: string | null; current_hash: string | null; operation: 'create' | 'update' }[];
  diagnostics: OkfDiagnostic[];
  navigation: { path: string; metadata: Record<string, unknown>; content: string }[];
}
export const fetchOkfBundles = () => request<OkfBundle[]>('/api/v1/knowledge/okf/bundles');
const upload = (file: File, bundleId?: string) => {
  const body = new FormData(); body.set('file', file);
  if (bundleId) body.set('bundle_id', bundleId);
  return body;
};
export const previewOkf = (file: File, bundleId?: string) => request<OkfPreview>('/api/v1/knowledge/okf/preview', { method: 'POST', body: upload(file, bundleId) });
export const importOkf = (file: File, preview: OkfPreview) => {
  const body = upload(file, preview.bundle_id ?? undefined);
  body.set('preview_hash', preview.preview_hash);
  body.set('expected_hashes', JSON.stringify(Object.fromEntries(preview.concepts.filter(item => item.current_hash).map(item => [item.path, item.current_hash]))));
  return request<{ bundle_id: string; documents: KnowledgeItem[]; diagnostics: OkfDiagnostic[] }>('/api/v1/knowledge/okf/import', { method: 'POST', body });
};
export async function exportOkf(documents: KnowledgeItem[], format: 'zip' | 'markdown', includeDrafts: boolean) {
  const bundles = [...new Set(documents.map(item => item.okf_bundle_id).filter(Boolean))];
  const response = await fetch('/api/v1/knowledge/okf/export', {
    method: 'POST', credentials: 'same-origin', headers: authHeaders({ 'Content-Type': 'application/json' }, 'POST'),
    body: JSON.stringify({ ...(bundles.length === 1 && documents.every(item => item.okf_bundle_id === bundles[0]) && { bundle_id: bundles[0] }), document_ids: documents.map(item => item.id), expected_hashes: Object.fromEntries(documents.map(item => [item.id, item.content_hash])), include_drafts: includeDrafts, format }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof detail?.detail === 'string' ? detail.detail : 'Export failed. Refresh the documents and try again.');
  }
  const blob = await response.blob();
  const expectedHash = response.headers.get('X-Content-SHA256');
  if (expectedHash) {
    const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = 'sha256:' + Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedHash && actual.slice(7) !== expectedHash) throw new Error('Export integrity check failed. Retry the download.');
  }
  return { blob, diagnostics: response.headers.get('X-OKF-Diagnostics') };
}
