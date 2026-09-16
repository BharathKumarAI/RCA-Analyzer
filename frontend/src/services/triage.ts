import { request } from './api';
import type {
  LiveBoardResponse,
  TicketWorkspaceResponse,
  InvestigationEvent,
  ToolProposal,
  InvestigationEvidence,
  TriageTicket,
  TicketComment,
  CalibrationFeedback,
  RcaMethodologyData,
} from '../types/triage';

export async function fetchLiveBoard(params?: {
  work_state?: string;
  search?: string;
}): Promise<LiveBoardResponse> {
  const q = new URLSearchParams();
  if (params?.work_state && params.work_state !== 'ALL') {
    q.set('work_state', params.work_state);
  }
  if (params?.search) {
    q.set('search', params.search);
  }
  const query = q.toString() ? `?${q.toString()}` : '';
  return request<LiveBoardResponse>(`/api/v1/triage/live-board${query}`);
}

export async function fetchTicketWorkspace(ticketId: string): Promise<TicketWorkspaceResponse> {
  return request<TicketWorkspaceResponse>(`/api/v1/triage/tickets/${encodeURIComponent(ticketId)}`);
}

export async function acknowledgeTicket(ticketId: string): Promise<{ status: string; owner: string; work_state: string }> {
  return request<{ status: string; owner: string; work_state: string }>(
    `/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/acknowledge`,
    { method: 'POST' }
  );
}

export async function updateProposalRevision(
  proposalId: string,
  currentQuery: string,
  parameters?: Record<string, any>
): Promise<ToolProposal> {
  return request<ToolProposal>(`/api/v1/triage/tool-proposals/${encodeURIComponent(proposalId)}/revision`, {
    method: 'POST',
    body: { current_query: currentQuery, parameters },
  });
}

export async function executeToolProposal(
  proposalId: string,
  parameters?: Record<string, any>
): Promise<{ status: string; execution_count: number; result: any }> {
  return request<{ status: string; execution_count: number; result: any }>(
    `/api/v1/triage/tool-proposals/${encodeURIComponent(proposalId)}/execute`,
    {
      method: 'POST',
      body: { parameters },
    }
  );
}

export async function promoteProposalEvidence(
  proposalId: string,
  summary: string,
  confidence = 0.90
): Promise<InvestigationEvidence> {
  return request<InvestigationEvidence>(
    `/api/v1/triage/tool-proposals/${encodeURIComponent(proposalId)}/promote-evidence`,
    {
      method: 'POST',
      body: { summary, confidence },
    }
  );
}

export async function updateEvidenceStatus(
  evidenceId: string,
  status: 'ACCEPTED' | 'REJECTED'
): Promise<{ status: string; evidence_id: string; new_status: string }> {
  return request<{ status: string; evidence_id: string; new_status: string }>(
    `/api/v1/triage/evidence/${encodeURIComponent(evidenceId)}/status`,
    {
      method: 'POST',
      body: { status },
    }
  );
}

export async function updateFindingStatus(
  findingId: string,
  status: 'CONFIRMED' | 'REJECTED'
): Promise<{ status: string; finding_id: string; new_status: string }> {
  return request<{ status: string; finding_id: string; new_status: string }>(
    `/api/v1/triage/findings/${encodeURIComponent(findingId)}/status`,
    {
      method: 'POST',
      body: { status },
    }
  );
}

export async function approveGovernedAction(
  actionId: string
): Promise<{ status: string; action_id: string; executed_at: number }> {
  return request<{ status: string; action_id: string; executed_at: number }>(
    `/api/v1/triage/actions/${encodeURIComponent(actionId)}/approve`,
    { method: 'POST' }
  );
}

export async function escalateTicket(
  ticketId: string,
  targetTeam: string,
  reason?: string
): Promise<{ status: string; current_team: string; work_state: string }> {
  return request<{ status: string; current_team: string; work_state: string }>(
    `/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/escalate`,
    {
      method: 'POST',
      body: { target_team: targetTeam, reason },
    }
  );
}

export async function returnTicket(
  ticketId: string,
  fromTeam: string,
  reason?: string
): Promise<{ status: string; work_state: string; stay_id: string }> {
  return request<{ status: string; work_state: string; stay_id: string }>(
    `/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/return`,
    {
      method: 'POST',
      body: { from_team: fromTeam, reason },
    }
  );
}

export async function fetchTeamActivity(limit = 30): Promise<InvestigationEvent[]> {
  return request<InvestigationEvent[]>(`/api/v1/triage/team-activity?limit=${limit}`);
}

export async function updateTicketStage(
  ticketId: string,
  workState: string,
  assignedTeam?: string,
  assignee?: string
): Promise<TriageTicket> {
  return request<TriageTicket>(`/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/stage`, {
    method: 'PATCH',
    body: {
      work_state: workState,
      assigned_team: assignedTeam,
      assignee: assignee,
    },
  });
}

export async function addTicketComment(
  ticketId: string,
  comment: string,
  isInternal = false
): Promise<TicketComment> {
  return request<TicketComment>(`/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/comments`, {
    method: 'POST',
    body: { comment, is_internal: isInternal },
  });
}

export async function fetchTicketComments(ticketId: string): Promise<TicketComment[]> {
  return request<TicketComment[]>(`/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/comments`);
}

export async function submitCalibrationFeedback(
  ticketKey: string,
  rating: 'UP' | 'DOWN',
  tags: string[],
  comment: string
): Promise<CalibrationFeedback> {
  return request<CalibrationFeedback>('/api/v1/triage/feedback', {
    method: 'POST',
    body: { ticket_key: ticketKey, rating, tags, comment },
  });
}

export async function fetchCalibrationFeedback(limit = 50): Promise<CalibrationFeedback[]> {
  return request<CalibrationFeedback[]>(`/api/v1/triage/feedback?limit=${limit}`);
}

export async function fetchTicketRca(ticketId: string): Promise<RcaMethodologyData> {
  return request<RcaMethodologyData>(`/api/v1/triage/tickets/${encodeURIComponent(ticketId)}/rca`);
}

