import type { Run } from './api';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'UNKNOWN';

export type WorkState =
  | 'NEW'
  | 'IN_TRIAGE'
  | 'RETURNED'
  | 'FOLLOW_UP'
  | 'APP_TEAM'
  | 'WAITING'
  | 'RESOLVED';

export type RiskState = 'BREACHED' | 'AT_RISK' | 'HEALTHY' | 'UNKNOWN';

export interface TriageTicket {
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  summary: string;
  description: string;
  priority: Priority;
  status: string;
  work_state: WorkState;
  current_team: string;
  assignee: string | null;
  reporter: string | null;
  environment: string | null;
  service: string | null;
  labels: string[];
  custom_fields: Record<string, any>;
  created_at: number;
  updated_at: number;
}

export interface SlaState {
  ticket_id: string;
  priority: Priority;
  priority_rank: number;
  sla_target_seconds: number | null;
  sla_target_formatted: string;
  sla_consumed_seconds: number;
  sla_consumed_formatted: string;
  sla_remaining_seconds: number | null;
  sla_remaining_formatted: string;
  sla_utilization: number | null;
  risk_state: RiskState;
  ticket_age_seconds: number;
  ticket_age_formatted: string;
  current_stay_seconds: number;
  current_stay_formatted: string;
  is_returned: boolean;
  return_age_seconds: number | null;
  return_age_formatted: string | null;
  explanation: string;
  active_stay: QueueStay | null;
  prior_stays_count: number;
}

export interface QueueStay {
  stay_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  entered_at: number;
  exited_at: number | null;
  accountable_duration: number;
  reason: string;
  previous_team: string | null;
  created_at: number;
}

export interface Hypothesis {
  title: string;
  status: 'CONFIRMED' | 'INVESTIGATING' | 'DISPROVED' | 'CANDIDATE';
  confidence: number;
  details: string;
}

export interface AutoTriageSummary {
  summary?: string;
  recommended_actions?: string[];
  uncertainties?: string[];
  hypotheses?: Hypothesis[];
  failure_boundary?: string;
  executive_rca?: string;
  confidence?: number;
  recommendation?: string;
}

export interface DeltaChange {
  timestamp: number;
  author: string;
  category: 'comment' | 'status_change' | 'attachment' | 'team_transfer';
  text: string;
}

export interface TriageInvestigation {
  investigation_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  state: 'NEW' | 'AUTO_TRIAGING' | 'READY' | 'INVESTIGATING' | 'WAITING' | 'FINALIZED';
  owner: string | null;
  auto_triage_run_id: string | null;
  auto_triage_summary: AutoTriageSummary;
  what_changed: DeltaChange[];
  created_at: number;
  updated_at: number;
  finalized_at: number | null;
}

export interface ToolProposal {
  proposal_id: string;
  investigation_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  capability: string;
  title: string;
  rationale: string;
  generated_query: string;
  current_query: string;
  parameters: Record<string, any>;
  status: 'GENERATED' | 'EDITED' | 'EXECUTED' | 'REJECTED';
  latest_result: {
    count: number;
    execution_time_ms: number;
    interpretation: string;
    confidence: number;
    items?: any[];
  } | null;
  execution_count: number;
  is_recommended: boolean;
  created_at: number;
  updated_at: number;
}

export interface InvestigationEvidence {
  evidence_id: string;
  investigation_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  source: string;
  query_ref: string | null;
  summary: string;
  payload_json: Record<string, any>;
  status: 'CANDIDATE' | 'ACCEPTED' | 'REJECTED';
  confidence: number;
  created_at: number;
}

export interface InvestigationFinding {
  finding_id: string;
  investigation_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  statement: string;
  confidence: number;
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  evidence_refs: string[];
  created_at: number;
}

export interface GovernedAction {
  action_id: string;
  investigation_id: string;
  ticket_id: string;
  tenant_id: string;
  project_id: string;
  action_type: 'ESCALATE_TO_TEAM' | 'POST_JIRA_COMMENT' | 'TRANSITION_STATUS' | 'TRIGGER_REMEDIATION';
  title: string;
  target: string;
  payload: Record<string, any>;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  requested_by: string;
  approved_by: string | null;
  executed_at: number | null;
  created_at: number;
}

export interface InvestigationEvent {
  event_id: string;
  ticket_id: string;
  investigation_id: string | null;
  tenant_id: string;
  project_id: string;
  event_type: string;
  actor_type: 'USER' | 'AGENT' | 'SYSTEM';
  actor_id: string;
  summary: string;
  payload: Record<string, any>;
  occurred_at: number;
}

export interface RelatedTicket {
  ticket_id: string;
  summary: string;
  similarity: number | null;
  root_cause: string;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface TeamAnalyst {
  name: string;
  role: string;
  active_tickets: number;
  current_ticket: string | null;
  status: 'ACTIVE' | 'ONLINE' | 'AWAY';
}

export interface ConnectorHealthStatus {
  connector: string;
  status: 'Healthy' | 'Degraded' | 'Down';
  latency_ms: number;
  description: string;
}

export interface PerformanceMetrics {
  mttt: string | null;
  mttt_trend: string | null;
  auto_triage_success_rate: string | null;
  auto_triage_success_trend: string | null;
  analyst_validation_rate: string | null;
  analyst_validation_trend: string | null;
  rca_accuracy_rate: string | null;
  rca_accuracy_trend: string | null;
}

export interface FocusQueueItem {
  ticket: TriageTicket;
  sla: SlaState;
  primary_action: 'Start Triage' | 'Resume' | 'Continue' | 'Review Update' | 'View';
}

export interface LiveBoardResponse {
  urgency_strip: {
    breached: number;
    at_risk: number;
    action_required: number;
    healthy: number;
    unknown?: number;
  };
  work_buckets: Record<string, number>;
  focus_queue: FocusQueueItem[];
  team_capacity: TeamAnalyst[];
  connectors_health: ConnectorHealthStatus[];
  performance_metrics: PerformanceMetrics;
  total_tickets: number;
  timestamp: number;
}

export interface TicketWorkspaceResponse {
  ticket: TriageTicket;
  sla: SlaState;
  queue_stays: QueueStay[];
  investigation: TriageInvestigation;
  tool_proposals: ToolProposal[];
  evidence: InvestigationEvidence[];
  findings: InvestigationFinding[];
  governed_actions: GovernedAction[];
  events: InvestigationEvent[];
  related_tickets: RelatedTicket[];
}

export interface TicketComment {
  id: string;
  author: string;
  comment: string;
  is_internal: boolean;
  timestamp: number;
}

export interface CalibrationFeedback {
  id: string;
  ticketKey: string;
  rating: 'UP' | 'DOWN';
  tags: string[];
  comment: string;
  author: string;
  time: string;
  timestamp: number;
}

export interface RcaFiveWhysStep {
  level: number;
  question: string;
  answer: string;
  evidence: string;
}

export interface RcaFishboneCategory {
  name: string;
  factors: string[];
  confidence: number;
}

export interface RcaKepnerTregoeDimension {
  dimension: string;
  is_fact: string;
  is_not_fact: string;
  distinction: string;
  probable_cause: string;
}

export interface RcaFmeaMode {
  failure_mode: string;
  effect: string;
  severity: number;
  cause: string;
  occurrence: number;
  detection: number;
  rpn: number;
  recommended_mitigation: string;
}

export interface RcaFaultTreeNode {
  event: string;
  operator?: string;
  status: string;
  probability?: string;
  evidence?: string;
  description?: string;
  children?: RcaFaultTreeNode[];
}

export type RcaMethod = 'five_whys' | 'fishbone' | 'kepner_tregoe' | 'fmea' | 'fault_tree' | 'auto_ensemble';

export interface RcaAnalysis {
  run_id: string;
  status: string;
  result: NonNullable<Run['result']>;
  created_at: number;
}

export interface RcaMethodologyData {
  analyses?: Partial<Record<RcaMethod, RcaAnalysis>>;
  available_methods?: string[];
  findings?: InvestigationFinding[];
  ticket_id: string;
  incident_title: string;
  five_whys?: {
    steps: RcaFiveWhysStep[];
    root_cause_summary: string;
  };
  fishbone?: {
    categories: RcaFishboneCategory[];
  };
  kepner_tregoe?: {
    dimensions: RcaKepnerTregoeDimension[];
  };
  fmea?: {
    modes: RcaFmeaMode[];
  };
  fault_tree?: {
    top_event: string;
    conclusion: string;
    active_cut_set: string[];
    root_gate: RcaFaultTreeNode | null;
  };
  auto_ensemble?: {
    incident_title: string;
    executive_summary: {
      isolated_root_cause: string;
      environmental_delta: string;
      critical_mitigation: string;
      max_rpn: number;
    };
  };
  context_budget?: {
    system_instructions_tokens: number;
    domain_tools_schema_tokens: number;
    telemetry_evidence_tokens: number;
    previous_turn_history_tokens: number;
    current_prompt_tokens: number;
    max_budget_tokens: number;
    budget_utilization_pct: number;
  } | null;
}

