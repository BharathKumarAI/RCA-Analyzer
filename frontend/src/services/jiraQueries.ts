import { request } from './api';

export interface JiraFilter { field: string; operator: string; value?: string | number | (string | number)[] | null; }
export interface JiraGroup { match: 'all' | 'any'; filters: JiraFilter[]; groups: JiraGroup[]; }
export type JiraProjectRole = 'PROJECT_OWNER' | 'PROJECT_MANAGER' | 'PROJECT_ANALYST' | 'PROJECT_VIEWER';
export interface JiraQuery extends JiraGroup {
  order_by: { field: string; direction: 'ASC' | 'DESC' }[];
  assignees?: { member_ids: string[]; role_ids: JiraProjectRole[] } | null;
}
export interface JiraQueryField { id: string; name: string; value_type: string; operators: string[]; sortable: boolean; }
export interface JiraQueryMetadata {
  instance_id: string; instance_revision: number;
  query_fields: JiraQueryField[];
  members: { subject: string; name: string; roles: string[]; jira_account_id: string | null }[];
  jql?: string; validation?: 'jira_strict';
}
export interface JiraQueryMatches {
  instance_id: string; instance_revision: number; environment_id: string | null; jql: string;
  issues: { key: string; summary: string; status: string | null; priority: string | null }[];
  returned_count: number; possibly_truncated: boolean; tested_at: number; validation: 'jira_strict'; read_only: true;
}
const base = (project: string, instance: string, path: string, environment?: string) =>
  `/api/v1/projects/${encodeURIComponent(project)}/connectors/${encodeURIComponent(instance)}/${path}${environment ? `?environment_id=${encodeURIComponent(environment)}` : ''}`;
export const discoverJiraQueryFields = (project: string, instance: string, environment?: string, signal?: AbortSignal) => request<JiraQueryMetadata>(
  `${base(project, instance, 'fields', environment)}${environment ? '&' : '?'}include_schema=true`, { signal });
export const previewJiraQuery = (project: string, instance: string, query: JiraQuery, environment?: string, signal?: AbortSignal) => request<JiraQueryMetadata>(
  base(project, instance, 'jql/preview', environment), { method: 'POST', body: query, signal });
export const testJiraQuery = (project: string, instance: string, input: { query: JiraQuery } | { custom_jql: string }, maxResults: number, environment?: string, signal?: AbortSignal) => request<JiraQueryMatches>(
  base(project, instance, 'jql/test', environment), { method: 'POST', body: { ...input, max_results: maxResults }, signal });
export const emptyJiraQuery = (): JiraQuery => ({ match: 'all', filters: [], groups: [], order_by: [] });
export const jiraConditionCount = (group: JiraGroup): number => group.filters.length + group.groups.reduce((sum, child) => sum + 1 + jiraConditionCount(child), 0);
