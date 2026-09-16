import { request, mapRun } from './api';
import type { Run } from '../types/api';

export interface Conversation { chat_id: string; created_at: number; title?: string; }
export const fetchConversations = () => request<Conversation[]>('/api/v1/chats');
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
export const fetchConversationMessages = (chatId: string) => request<ChatMessage[]>(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`);
export const resolveChatQuestion = (input: { chat_id: string; prompt: string; attachment_ids?: string[]; incident_id?: string }, signal?: AbortSignal) => request<ChatResolution>('/api/v1/chat/resolve', { method: 'POST', body: input, signal });
export async function fetchConversationRuns(chatId: string): Promise<Run[]> {
  const values = await request<Record<string, unknown>[]>(`/api/v1/chats/${encodeURIComponent(chatId)}/runs`);
  return values.map(mapRun).reverse();
}
