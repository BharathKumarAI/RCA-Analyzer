import { request } from './api';

export interface Timing {
  mean_duration_ms: number | null;
  p95_duration_ms: number | null;
}

export interface Measurements {
  reported_token_fields: Record<'input_tokens' | 'output_tokens' | 'thinking_tokens' | 'total_tokens' | 'cached_input_tokens', number>;
  runs: number;
  succeeded_runs: number;
  failed_runs: number;
  partial_runs: number;
  cancelled_runs: number;
  active_runs: number;
  evidence_items: number;
  run_latency: Timing;
  model_latency: Timing;
  model_calls: number;
  completed_model_calls: number;
  failed_model_calls: number;
  cancelled_model_calls: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  usage_reported_calls: number;
  usage_unknown_calls: number;
  priced_calls: number;
  unpriced_calls: number;
  known_cost_usd: number;
  estimated_cost_usd: number | null;
  cache_hits: number;
  cache_misses: number;
  cache_unknown_calls: number;
  cache_hit_rate: number | null;
  unfinished_model_calls?: number;
}

export interface SreMetrics {
  mttt: Timing;
  mttr: Timing;
  tickets_total: number;
  tickets_resolved: number;
  tickets_active: number;
  sla_compliance_rate: number | null;
  ongoing_breaches: number;
  priority_breakdown: Record<'P1' | 'P2' | 'P3' | 'P4', number>;
  analyst_validation: {
    confirmed: number;
    rejected: number;
    candidate: number;
    agreement_rate: number | null;
  };
  auto_triage: {
    runs: number;
    succeeded: number;
    success_rate: number | null;
  };
}

export interface TelemetryFilters {
  start?: string;
  end?: string;
  capability?: string;
  stage?: string;
  mode: 'live' | 'demo';
  window?: '24h' | '7d' | '30d' | '90d';
}

export interface NodeMeasurement {
  name: string;
  calls: number;
  errors: number;
  cancelled: number;
  mean_duration_ms: number | null;
  p95_duration_ms: number | null;
}

export interface Telemetry {
  feedback?: {
    reviewed_runs: number;
    helpful: number;
    needs_work: number;
    unreviewed_runs: number;
  };
  filters: TelemetryFilters;
  summary: Measurements;
  sre_metrics?: SreMetrics;
  daily: Array<Measurements & { date: string; tickets?: number; resolved_tickets?: number }>;
  by_stage: Array<Measurements & { stage: string }>;
  by_model: Array<Measurements & { model: string }>;
  by_capability: Array<Measurements & { capability: string }>;
  agents: NodeMeasurement[];
  tools: NodeMeasurement[];
  coverage: {
    matched_runs: number;
    analyzed_runs: number;
    events_analyzed: number;
    run_limit: number;
    event_limit: number;
    truncated: boolean;
    legacy_runs: number;
    unfinished_model_calls: number;
    notes: string[];
  };
}

export interface ProjectComparisonRow {
  project_id: string;
  project_name: string;
  runs: number;
  succeeded_runs: number;
  failed_runs: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  mean_duration_ms: number | null;
  p95_duration_ms: number | null;
  active_tickets: number;
}

export interface PlatformMetrics {
  filters: {
    start: string;
    end: string;
    mode: 'live' | 'demo';
  };
  totals: Measurements & {
    overall_run_latency: Timing;
  };
  projects: ProjectComparisonRow[];
  tools: NodeMeasurement[];
  coverage: Telemetry['coverage'];
}

export function fetchTelemetry(filters: TelemetryFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return request<Telemetry>(`/api/v1/telemetry?${params}`);
}

export function fetchProjectMetrics(filters: TelemetryFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return request<Telemetry>(`/api/v1/metrics?${params}`);
}

export function fetchPlatformMetrics(filters: { start?: string; end?: string; mode?: 'live' | 'demo'; window?: string }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return request<PlatformMetrics>(`/api/v1/metrics/platform?${params}`);
}

export interface ModelRate {
  input_per_million: number;
  output_per_million: number;
  cached_input_per_million?: number | null;
}

export interface ModelPricing {
  revision: number;
  rates: Record<string, ModelRate>;
}

export const fetchModelPricing = () => request<ModelPricing>('/api/v1/telemetry/pricing');
export const saveModelPricing = (value: { expected_revision: number; rates: Record<string, ModelRate> }) =>
  request<ModelPricing>('/api/v1/telemetry/pricing', { method: 'PUT', body: value });
