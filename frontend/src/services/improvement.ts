import { request } from './api';
import type { KnowledgeItem, RunConnectorSelections } from '../types/api';

export interface OptimizationInput { dataset_id: string; dataset_version: string; target_kind: 'prompt' | 'skill'; target_name: string }
export type KnowledgeCaptureSource = 'documents' | 'closed_tickets' | 'confluence' | 'feedback';
export interface KnowledgeCaptureInput {
  sources: KnowledgeCaptureSource[];
  lookback_months?: number;
  limit?: number;
  connector_selections: RunConnectorSelections;
  source_capabilities: Partial<Record<'closed_tickets' | 'confluence', string>>;
  topic?: string;
}
export interface JobInput { kind: 'prepare_feedback' | 'optimize' | 'capture_knowledge' | 'track_closures'; capability?: string | null; limit?: number; optimization?: OptimizationInput | null; capture?: KnowledgeCaptureInput | null }
export interface ImprovementJob {
  job_id: string; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; payload: JobInput;
  attempts: number; cancel_requested: boolean; error: string | null; created_at: number; updated_at: number;
  result: { optimization_id?: string; created?: number; skipped?: { source_key: string; reason: string }[]; [key: string]: unknown } | null;
}
export interface ImprovementSchedule {
  schedule_id: string; name: string; interval_seconds: number; enabled: boolean; revision: number;
  next_run_at: number; payload: JobInput; author_subject: string;
}
export interface ImprovementCandidate {
  candidate_id: string; source_run_id: string; source_subject: string; author_subject: string; capability: string;
  status: 'NEEDS_REVIEW' | 'VERIFIED'; revision: number; created_at: number; verifier_subject: string | null; reason: string | null;
  payload: { prompt: string; incident_id: string | null; signal: unknown; recorded_result: unknown; evidence: unknown[]; run_snapshot_hash: string };
  verification: { expected_outcome: 'FINDINGS' | 'INSUFFICIENT_EVIDENCE'; expected_facts: string[] } | null;
}
export type ImprovementCandidateSummary = Omit<ImprovementCandidate, 'payload' | 'verification'> & { incident_id: string | null };
export interface ScheduleInput { name: string; interval_seconds: number; enabled: boolean; job: JobInput; expected_revision?: number }
export const fetchImprovementJobs = () => request<ImprovementJob[]>('/api/v1/improvement/jobs');
export const enqueueImprovement = (body: JobInput, key: string) => request<ImprovementJob>('/api/v1/improvement/jobs', { method: 'POST', body, headers: { 'Idempotency-Key': key } });
export const controlImprovement = (id: string, action: 'cancel' | 'retry') => request<ImprovementJob>(`/api/v1/improvement/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
export const fetchImprovementSchedules = () => request<ImprovementSchedule[]>('/api/v1/improvement/schedules');
export const saveImprovementSchedule = (body: ScheduleInput, id?: string) => request<ImprovementSchedule>(`/api/v1/improvement/schedules${id ? '/' + encodeURIComponent(id) : ''}`, { method: id ? 'PUT' : 'POST', body });
export const fetchImprovementCandidates = () => request<ImprovementCandidateSummary[]>('/api/v1/improvement/candidates');
export const fetchImprovementCandidate = (id: string) => request<ImprovementCandidate>(`/api/v1/improvement/candidates/${encodeURIComponent(id)}`);
export const verifyImprovementCandidate = (id: string, body: { expected_revision: number; expected_outcome: string; expected_facts: string[]; reason: string }) => request<ImprovementCandidate>(`/api/v1/improvement/candidates/${encodeURIComponent(id)}/verify`, { method: 'POST', body });
export const draftCandidateKnowledge = (id: string, body: { expected_revision: number; title: string; category: string }) => request<KnowledgeItem>(`/api/v1/improvement/candidates/${encodeURIComponent(id)}/knowledge`, { method: 'POST', body });
export const publishCandidateDataset = (body: { id: string; version: string; description: string; capability: string; train_ids: string[]; holdout_ids: string[]; knowledge_document_ids: string[] }) => request<{ dataset_id: string; version: string }>('/api/v1/improvement/datasets', { method: 'POST', body });
export const undoOptimization = (id: string, action: 'rollback' | 'revoke', expectedHash: string, reason: string) => request(`/api/v1/optimizations/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { expected_hash: expectedHash, reason } });
