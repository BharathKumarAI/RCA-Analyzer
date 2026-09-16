import { ApiError, authHeaders, request } from './api';

export interface ChatArtifact {
  artifact_id: string;
  chat_id: string;
  attachment_id: string;
  filename: string;
  media_type: string;
  sha256: string;
  size_bytes: number;
  created_at: number;
  expires_at: number;
}
export interface ChatArtifactPreview {
  filename: string;
  media_type: string;
  text: string;
  truncated: boolean;
  warnings: string[];
}
const chatPath = (chatId: string) => `/api/v1/chats/${encodeURIComponent(chatId)}`;
const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);

export function fetchChatArtifacts(chatId: string, before?: number, signal?: AbortSignal): Promise<ChatArtifact[]> {
  const query = new URLSearchParams({ limit: '100' });
  if (before !== undefined) query.set('before', String(before));
  return request(`${chatPath(chatId)}/artifacts?${query}`, { signal: boundedSignal(signal) });
}
export function fetchChatArtifactPreview(chatId: string, artifactId: string, signal?: AbortSignal): Promise<ChatArtifactPreview> {
  return request(`${chatPath(chatId)}/artifacts/${encodeURIComponent(artifactId)}/preview`, { signal: boundedSignal(signal) });
}
async function download(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { headers: authHeaders(), credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError(0, 'The download could not finish. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 404 ? 'This file is no longer available. Refresh the file list to check its status.' : 'The file could not be downloaded. Try again.');
  }
  return response.blob();
}
export const downloadChatArtifact = (chatId: string, artifactId: string) => download(`${chatPath(chatId)}/artifacts/${encodeURIComponent(artifactId)}/download`);
export const downloadChatReport = (chatId: string, runId: string) => download(`${chatPath(chatId)}/created/${encodeURIComponent(runId)}/download`);
