import { request, mapRun } from './api';
import type { Run } from '../types/api';

export interface Conversation { chat_id: string; created_at: number; title?: string; }
export const CHAT_PAGE_SIZE = 50;
export const CHAT_MESSAGE_PAGE_SIZE = 100;
interface HistoryPage { before?: number; signal?: AbortSignal; }
function pageQuery(limit: number, before?: number): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) query.set('before', String(before));
  return query.toString();
}
export const fetchConversations = ({ before, signal }: HistoryPage = {}) => request<Conversation[]>(`/api/v1/chats?${pageQuery(CHAT_PAGE_SIZE, before)}`, { signal });
export const createConversation = () => request<Conversation>('/api/v1/chats', { method: 'POST' });
export interface IntentChoice { capability: string; label: string; prompt: string; }
export interface ChatMessage {
  id: string; exchange_id: string; sequence: number; role: 'user' | 'assistant'; content: string;
  kind: 'question' | 'clarification' | 'unsupported'; reason_code: string | null; choices: IntentChoice[]; created_at: number;
  attachment_ids?: string[];
}
export interface ChatResolution {
  status: 'ready' | 'clarification' | 'unsupported'; capability: string | null; message: string;
  reason_code: string; catalog_hash: string; choices: IntentChoice[]; exchange_id: string | null; message_id: string | null;
}
export const fetchConversationMessages = (chatId: string, { before, signal }: HistoryPage = {}) => request<ChatMessage[]>(`/api/v1/chats/${encodeURIComponent(chatId)}/messages?${pageQuery(CHAT_MESSAGE_PAGE_SIZE, before)}`, { signal });
export const resolveChatQuestion = (input: { chat_id: string; prompt: string; attachment_ids?: string[]; incident_id?: string; knowledge_document_ids?: string[]; environment_id?: string }, signal?: AbortSignal) => request<ChatResolution>('/api/v1/chat/resolve', { method: 'POST', body: input, signal });
export async function fetchConversationRuns(chatId: string, { before, signal }: HistoryPage = {}): Promise<Run[]> {
  const values = await request<Record<string, unknown>[]>(`/api/v1/chats/${encodeURIComponent(chatId)}/runs?${pageQuery(CHAT_PAGE_SIZE, before)}`, { signal });
  return values.map(mapRun).reverse();
}
