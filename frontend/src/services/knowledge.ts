import { request } from './api';
import type { KnowledgeStructure, Run } from '../types/api';

export interface KnowledgeSettings { lookback_months: number; revision: number | null; definition_revision: number }

export const fetchKnowledgeSettings = () => request<KnowledgeSettings>('/api/v1/knowledge/settings');
export const saveKnowledgeSettings = (lookback_months: number, expected_revision: number | null, expected_definition_revision: number) => request<KnowledgeSettings>('/api/v1/knowledge/settings', {
  method: 'PUT', body: { lookback_months, expected_revision, expected_definition_revision },
});

export function knowledgeStructureError(structure: KnowledgeStructure, maxText: number): string | null {
  if (!structure.topic.trim() || !structure.blocks.length || structure.blocks.some(block => !block.kind.trim() || !block.title.trim() || !block.content.trim())) return 'Give this document a topic and complete every section before saving.';
  if (structure.topic.length > 128 || structure.summary.length > 2000 || structure.blocks.length > 40 || structure.blocks.some(block => block.kind.length > 64 || block.title.length > 256 || block.content.length > 16000)) return 'Use a topic up to 128 characters, a summary up to 2,000 characters and up to 40 sections. Each section needs a kind up to 64 characters, a title up to 256 characters and content up to 16,000 characters.';
  if (structure.blocks.reduce((length, block) => length + block.content.length + block.title.length + block.kind.length, structure.topic.length + structure.summary.length) > Math.min(maxText, 1_000_000)) return 'The combined sections exceed the project text limit. Shorten the document before saving.';
  return null;
}

export interface ClosureAssessment {
  status: 'ASSESSED' | 'INSUFFICIENT_CLOSURE_EVIDENCE'; deviation_score: number | null; confidence: number;
  summary: string; discrepancies: string[]; expected_facts: string[];
}
export interface ClosureRecord {
  tracking_id: string; source_run_id: string; ticket_key: string; capability: string; status: 'OPEN' | 'CLOSED';
  last_checked_at: number | null; closed_at: number | null; last_error: string | null; created_at: number; updated_at: number;
  latest_judgment: ClosureAssessment | null;
}
export interface ClosureDashboard {
  metrics: { tracked: number; open: number; closed: number; assessed: number; insufficient: number; pending: number; errors: number; alerts: number; coverage: number | null; mean_deviation: number | null };
  items: ClosureRecord[]; next_cursor: string | null; generated_at: number;
  configuration: { deviation_threshold: number; min_confidence: number; judge_stage: string; judge_instruction: string };
}
export interface ClosureDetail extends Omit<ClosureRecord, 'latest_judgment'> {
  original: { result: NonNullable<Run['result']>; evidence_ids: string[]; ticket: Record<string, unknown> };
  connector_selection: { instance_id: string; environment_id?: string };
  judgments: { judgment_id: string; model: string; created_at: number; assessment: ClosureAssessment; closure: Record<string, unknown>; closure_hash: string; prompt_hash: string; context_hash: string }[];
}
export const fetchClosureDashboard = (cursor?: string) => request<ClosureDashboard>(`/api/v1/knowledge/closures?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const fetchClosureDetail = (id: string) => request<ClosureDetail>(`/api/v1/knowledge/closures/${encodeURIComponent(id)}`);
