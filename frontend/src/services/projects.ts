import { request } from './api';
import type { Principal } from '../types/api';

export interface ProjectWorkspace {
  project_id: string;
  name: string;
  description: string;
  status: string;
  roles: string[];
  last_accessed_at: number | null;
}
export interface ProjectDirectory {
  items: ProjectWorkspace[];
  current_project_id: string;
  can_create: boolean;
}
export interface CreateProjectInput { project_id: string; name: string; description: string; timezone: string; }
export const fetchProjects = () => request<ProjectDirectory>('/api/v1/projects');
export const createProject = (input: CreateProjectInput) => request<ProjectWorkspace>('/api/v1/projects', { method: 'POST', body: input });
export const selectProject = (id: string) => request<{ principal: Principal; project: ProjectWorkspace }>(`/api/v1/projects/${encodeURIComponent(id)}/select`, { method: 'POST' });

export type ProjectLifecycleAction = 'deactivate' | 'activate' | 'archive' | 'restore';
export interface ManagedProject extends Pick<ProjectWorkspace, 'project_id' | 'name' | 'description'> {
  status: 'active' | 'inactive' | 'archived'; timezone: string; updated_at: number;
  content_hash: string; actions: ProjectLifecycleAction[];
}
export const fetchManagedProjects = (signal?: AbortSignal) => request<{ items: ManagedProject[] }>('/api/v1/projects/management', { signal });
export const changeProjectLifecycle = (project: ManagedProject, action: ProjectLifecycleAction, reason: string) => request<ManagedProject>(
  `/api/v1/projects/${encodeURIComponent(project.project_id)}/lifecycle`,
  { method: 'POST', body: { action, expected_hash: project.content_hash, reason } });
