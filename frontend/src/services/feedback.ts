import { request } from './api';

export type FeedbackRating = 'helpful' | 'needs_work';
export interface RunFeedbackRecord {
  rating: FeedbackRating;
  note: string;
  revision: number;
  updated_at: number;
}
const feedbackPath = (runId: string) => `/api/v1/runs/${encodeURIComponent(runId)}/feedback`;
const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
export const fetchRunFeedback = (runId: string, signal?: AbortSignal) => request<RunFeedbackRecord | null>(feedbackPath(runId), { signal: boundedSignal(signal) });
export const saveRunFeedback = (runId: string, payload: { rating: FeedbackRating; note: string; expected_revision: number }, signal?: AbortSignal) => request<RunFeedbackRecord>(feedbackPath(runId), { method: 'PUT', body: payload, signal: boundedSignal(signal) });
