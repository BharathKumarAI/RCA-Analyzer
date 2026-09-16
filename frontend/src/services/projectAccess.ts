import { request } from './api';

export type RequestedProjectRole = 'PROJECT_VIEWER' | 'PROJECT_ANALYST' | 'PROJECT_MANAGER' | 'PROJECT_OWNER';
export interface ProjectAccessRequest {
  id: string;
  project_id: string;
  requested_role: RequestedProjectRole;
  requester_subject: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  content_hash: string;
  created_at: number;
  reviewer_subject: string | null;
  review_reason: string | null;
  reviewed_at: number | null;
  can_review: boolean;
}
export function fetchProjectAccessRequests(signal?: AbortSignal): Promise<ProjectAccessRequest[]> {
  return request('/api/v1/project-access-requests', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
}
export function createProjectAccessRequest(projectId: string, role: RequestedProjectRole, reason: string): Promise<ProjectAccessRequest> {
  return request('/api/v1/project-access-requests', { method: 'POST', body: { project_id: projectId, requested_role: role, reason }, signal: AbortSignal.timeout(15_000) });
}
export function reviewProjectAccessRequest(id: string, action: 'approve' | 'reject', expectedHash: string, reason: string): Promise<ProjectAccessRequest> {
  return request(`/api/v1/project-access-requests/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { expected_hash: expectedHash, reason }, signal: AbortSignal.timeout(15_000) });
}
