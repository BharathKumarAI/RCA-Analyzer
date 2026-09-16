import { request } from './api';
import type { Run, RunConnectorSelections } from '../types/api';
export interface ProjectCandidateInput {
  yaml: string; expected_project_revision?: string; expected_editor_version: number;
  run: { capability: string; prompt: string; incident_id?: string; chat_id?: string; attachment_ids?: string[]; connector_selections?: RunConnectorSelections; environment_id?: string; knowledge_document_ids?: string[] };
}
export interface ProjectCandidateTest {
  run: { run_id: string; status: string; mode: 'live' | 'demo'; capability: string; created_at: number; result: Run['result'] | null; reason?: string | null; evidence_count: number };
  receipt: { run_id: string; candidate_hash: string; dependency_hash: string; project_revision: string; editor_version: number; passed: boolean };
}
export const testProjectCandidate = (input: ProjectCandidateInput, key: string) => request<ProjectCandidateTest>('/api/v1/project/test', { method: 'POST', body: input, headers: { 'Idempotency-Key': key } });
