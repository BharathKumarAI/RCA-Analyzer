import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  Cpu,
  Database,
  FolderGit2,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  PlayCircle,
  Plus,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { isActivePage, type ActivePage } from '../components/Sidebar';
import {
  fetchAgents,
  fetchAlerts,
  fetchAuthProviders,
  fetchCapabilities,
  fetchConnectorsHealth,
  fetchHealth,
  fetchKnowledge,
  fetchProjectConnectors,
  fetchProjectEditor,
  fetchProjectSetup,
  fetchRuns,
  fetchSkills,
  fetchSsoConfigurations,
  fetchSystemDiagnostics,
} from '../services/api';
import { fetchProjects } from '../services/projects';
import type { ProjectEditorDraft } from '../services/api';
import type { ProjectDirectory, ProjectWorkspace } from '../services/projects';
import type {
  AgentConfiguration,
  AlertItem,
  AlertsResponse,
  AuthProviders,
  CapabilityItem,
  ConnectorsHealthResponse,
  KnowledgeItem,
  Principal,
  ProjectConnectorInstanceItem,
  ProjectSetupResponse,
  Run,
  SkillItem,
  SsoConfiguration,
  SystemDiagnostics,
  SystemHealth,
  UiSettingsConfig,
} from '../types/api';
import '../styles/overview.css';

interface OverviewProps {
  principal: Principal;
  settings: UiSettingsConfig;
  health: SystemHealth;
  agents: AgentConfiguration[];
  runs: Run[];
  projects?: ProjectDirectory | null;
  onSelectProject?: (projectId: string) => void;
  onNavigate: (page: ActivePage, search?: string) => void;
  onNewInvestigation?: () => void;
  onOpenRun?: (id: string) => void;
  onCreateProject?: () => void;
  onRefresh?: () => void;
  projectWorkspace?: boolean;
}

interface OverviewData {
  project: ProjectSetupResponse;
  editor: ProjectEditorDraft;
  capabilities: CapabilityItem[];
  connections: ProjectConnectorInstanceItem[];
  connectorsHealth: ConnectorsHealthResponse;
  diagnostics: SystemDiagnostics;
  knowledge: KnowledgeItem[];
  skills: SkillItem[];
  agents: AgentConfiguration[];
  signin: AuthProviders;
  signinReviews: { active: SsoConfiguration | null; drafts: SsoConfiguration[] };
  alerts: AlertsResponse;
  health: SystemHealth;
  runs: Run[];
  projects: ProjectDirectory;
}

type Source = keyof OverviewData;

const sourceLabels: Record<Source, string> = {
  project: 'Project configuration',
  editor: 'Project details',
  capabilities: 'Investigations',
  connections: 'Project connections',
  connectorsHealth: 'Connectors telemetry',
  diagnostics: 'System diagnostics',
  knowledge: 'Project knowledge',
  skills: 'Skills',
  agents: 'Agents',
  signin: 'Company sign-in',
  signinReviews: 'Sign-in reviews',
  alerts: 'Operational alerts',
  health: 'Platform health',
  runs: 'Investigation runs',
  projects: 'Projects directory',
};

const readable = (value: string) => value.replace(/[_-]/g, ' ');
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const formatDate = (value: string | number | undefined | null) => {
  if (value === undefined || value === null) return 'Time unavailable';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// Configuration availability only: a model call and its answer still need to be checked in Chat.
export function overviewCapabilityState(capabilities: CapabilityItem[], project: ProjectSetupResponse | undefined) {
  const enabled = capabilities.filter(
    item =>
      item.enabled === true &&
      item.project_enabled !== false &&
      item.is_authorized === true &&
      item.runtime_supported === true
  );
  const available = enabled.filter(item =>
    (item.required_connectors ?? item.requires?.connectors ?? []).every(
      id => project?.connector_health[id]?.overall === 'HEALTHY'
    )
  );
  return { enabled, available };
}

export function Overview({
  principal,
  settings: _settings,
  health: initialHealth,
  runs: initialRuns,
  agents: initialAgents,
  projects: initialProjects,
  onSelectProject,
  onNavigate,
  onNewInvestigation,
  onOpenRun,
  onCreateProject,
  onRefresh,
  projectWorkspace = false,
}: OverviewProps) {
  const [data, setData] = useState<Partial<OverviewData>>({});
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({});
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [lastObservedAt, setLastObservedAt] = useState<Date | null>(null);
  const [runFilter, setRunFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all');
  const [readinessOpen, setReadinessOpen] = useState(false);

  const canAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const canManage = canAdmin || principal.roles.includes('PROJECT_OWNER');

  const executeReload = useCallback(() => {
    setAttempt(v => v + 1);
    if (onRefresh) {
      try {
        onRefresh();
      } catch {
        /* Ignore external refresh error */
      }
    }
  }, [onRefresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const sources = {
      project: fetchProjectSetup(),
      editor: fetchProjectEditor(),
      capabilities: fetchCapabilities(true),
      connections: fetchProjectConnectors(principal.project_id),
      connectorsHealth: fetchConnectorsHealth(),
      diagnostics: fetchSystemDiagnostics(),
      knowledge: fetchKnowledge(),
      skills: fetchSkills(),
      agents: fetchAgents(),
      signin: fetchAuthProviders(),
      alerts: fetchAlerts(),
      health: fetchHealth(),
      runs: fetchRuns(),
      projects: fetchProjects(),
      ...(canAdmin ? { signinReviews: fetchSsoConfigurations() } : {}),
    };
    const entries = Object.entries(sources) as Array<[Source, Promise<OverviewData[Source]>]>;
    void Promise.allSettled(entries.map(([, promise]) => promise)).then(results => {
      if (cancelled) return;
      const values: Partial<OverviewData> = {};
      const failures: Partial<Record<Source, string>> = {};
      results.forEach((result, index) => {
        const name = entries[index][0];
        if (result.status === 'fulfilled') {
          Object.assign(values, { [name]: result.value });
        } else {
          failures[name] = result.reason instanceof Error ? result.reason.message : 'Check unavailable.';
        }
      });
      setData(values);
      setErrors(failures);
      setLoading(false);
      setLastObservedAt(new Date());
    });
    return () => {
      cancelled = true;
    };
  }, [principal.project_id, principal.tenant_id, principal.subject, canAdmin, attempt]);

  const effectiveHealth = data.health ?? initialHealth;
  const effectiveRuns = data.runs ?? initialRuns;
  const effectiveAgents = data.agents ?? initialAgents;
  const effectiveProjects = data.projects ?? initialProjects;
  const projectList: ProjectWorkspace[] = effectiveProjects?.items ?? [];

  const projectName =
    typeof data.editor?.document.metadata === 'object' &&
    data.editor.document.metadata !== null &&
    'name' in data.editor.document.metadata &&
    typeof data.editor.document.metadata.name === 'string'
      ? data.editor.document.metadata.name.trim() || principal.project_id
      : principal.project_id;

  const applied = Boolean(data.project?.project_layer);
  const mode = data.project?.scope.mode ?? effectiveHealth.mode;
  const availability = data.capabilities ? overviewCapabilityState(data.capabilities, data.project) : null;
  const enabledConnections = data.connections?.filter(item => item.enabled && item.status === 'enabled') ?? [];
  const unfinishedConnections = data.connections?.filter(item => item.status === 'draft') ?? [];
  const approvedKnowledge = data.knowledge?.filter(item => item.status === 'approved') ?? [];
  const pendingKnowledge = data.knowledge?.filter(item => item.status === 'pending') ?? [];
  const pendingSkills = data.skills?.filter(item => item.status === 'PENDING') ?? [];
  const pendingAgents = effectiveAgents.filter(item => item.status === 'pending');
  const activeAgents = effectiveAgents.filter(item => item.status === 'active');
  const pendingSignin = data.signinReviews?.drafts.filter(item => item.status === 'PENDING') ?? [];

  // Honest Review Queue items showing exact authorship without assuming the signed-in user can approve
  const reviews: Array<{
    key: string;
    title: string;
    kind: string;
    page: ActivePage;
    search?: string;
    own: boolean;
    author: string;
  }> = [
    ...pendingKnowledge.map(item => ({
      key: `knowledge-${item.id}`,
      title: item.title,
      kind: 'Document',
      page: 'knowledge' as ActivePage,
      own: item.author_subject === principal.subject,
      author: item.author_subject || 'unknown author',
    })),
    ...pendingSkills.map(item => ({
      key: `skill-${item.id}`,
      title: item.name || readable(item.id),
      kind: 'Skill',
      page: 'skills' as ActivePage,
      search: `skill=${encodeURIComponent(item.id)}`,
      own: item.author_subject === principal.subject,
      author: item.author_subject || 'unknown author',
    })),
    ...pendingAgents.map(item => ({
      key: `agent-${item.id}`,
      title: item.name || readable(item.id),
      kind: 'Agent',
      page: 'agents' as ActivePage,
      own: item.author === principal.subject,
      author: item.author || 'unknown author',
    })),
    ...pendingSignin.map(item => ({
      key: `signin-${item.draft_id}`,
      title: item.definition.display_name,
      kind: 'Company sign-in',
      page: 'settings' as ActivePage,
      search: 'section=company-sign-in',
      own: item.author_subject === principal.subject,
      author: item.author_subject || 'unknown author',
    })),
  ];

  const reviewSources: Source[] = ['knowledge', 'skills', 'agents', ...(canAdmin ? (['signinReviews'] as Source[]) : [])];
  const reviewUnknown = reviewSources.some(key => !data[key] && !errors[key]);

  // Operational alert tallies
  const openAlerts = useMemo(() => data.alerts?.items?.filter(item => item.status === 'open') ?? [], [data.alerts]);
  const criticalAlertsCount = openAlerts.filter(a => a.severity === 'critical').length;
  const warningAlertsCount = openAlerts.filter(a => a.severity === 'warning').length;
  const infoAlertsCount = openAlerts.filter(a => a.severity === 'info').length;

  // Run filters
  const filteredRuns = useMemo(() => {
    if (runFilter === 'completed') return effectiveRuns.filter(r => r.status === 'COMPLETED');
    if (runFilter === 'running') return effectiveRuns.filter(r => r.status === 'RUNNING');
    if (runFilter === 'failed') return effectiveRuns.filter(r => ['FAILED', 'BLOCKED'].includes(r.status));
    return effectiveRuns;
  }, [effectiveRuns, runFilter]);

  const runningRunsCount = effectiveRuns.filter(r => r.status === 'RUNNING').length;
  const completedRunsCount = effectiveRuns.filter(r => r.status === 'COMPLETED').length;
  const failedRunsCount = effectiveRuns.filter(r => ['FAILED', 'BLOCKED'].includes(r.status)).length;

  // Connector telemetry map
  const connectorRecords = data.connectorsHealth?.connectors ?? {};
  const connectorKeys = Object.keys(connectorRecords);

  const status = (key: Source, label: string) => (loading ? 'Checking…' : errors[key] ? 'Check unavailable' : label);
  const steps = [
    {
      key: 'project',
      title: 'Set up project parameters',
      label: status('project', applied ? 'Settings applied' : 'Using platform defaults'),
      complete: applied,
      description: 'Confirm project metadata, environment tiers and access roles in project setup.',
      action: applied ? 'Review project setup' : 'Set up project',
      page: 'project-setup' as ActivePage,
    },
    {
      key: 'capabilities',
      title: 'Configure investigation types',
      label: status('capabilities', availability ? plural(availability.enabled.length, 'investigation enabled') : 'Check unavailable'),
      complete: Boolean(availability?.enabled.length),
      description: availability?.enabled.length
        ? `${plural(availability.available.length, 'investigation')} ${availability.available.length === 1 ? 'has' : 'have'} required source checks available.`
        : 'Enable an investigation type for your team.',
      action: 'Review investigations',
      page: 'capabilities' as ActivePage,
    },
    {
      key: 'connections',
      title: 'Connect sources (Jira, Splunk)',
      label: status('connections', enabledConnections.length ? plural(enabledConnections.length, 'connection enabled') : 'No connections enabled'),
      complete: enabledConnections.length > 0,
      description: `Configure Jira or Splunk connectors for ticket and log evidence.${unfinishedConnections.length ? ` ${plural(unfinishedConnections.length, 'connection draft')} still need attention.` : ''}`,
      action: unfinishedConnections.length ? 'Finish connections' : 'Manage connections',
      page: 'project-setup' as ActivePage,
      search: 'step=connectors-tools',
    },
    {
      key: 'knowledge',
      title: 'Add trusted team knowledge',
      label: status('knowledge', approvedKnowledge.length ? plural(approvedKnowledge.length, 'document approved') : 'No approved documents'),
      complete: approvedKnowledge.length > 0,
      description: 'Upload runbooks or reference architecture, verify extracted content, then request peer approval.',
      action: 'Open knowledge',
      page: 'knowledge' as ActivePage,
    },
    {
      key: 'signin',
      title: 'Manage team authentication',
      label: status('signin', data.signin?.configured ? 'Company sign-in configured' : 'Company sign-in not configured'),
      complete: data.signin?.configured === true,
      description: data.signin?.configured
        ? `Team members authenticate via ${data.signin.name || 'configured identity provider'}.`
        : 'Platform administrator configures the identity provider. A second administrator approves.',
      action: canAdmin ? 'Configure company sign-in' : 'Review team access',
      page: (canAdmin ? 'settings' : 'users') as ActivePage,
      search: canAdmin ? 'section=company-sign-in' : undefined,
    },
  ];

  return (
    <div className="view-container overview-page command-center-root">
      {/* Command Center Executive Hero (Multi-Project & Fleet Aware) */}
      <header className="command-center-hero">
        <div className="command-hero-left">
          <div className="command-hero-icon-box" aria-hidden="true">
            <LayoutDashboard size={28} />
          </div>
          <div className="command-hero-meta">
            <div className="command-hero-badges">
              <span className="command-scope-tag">Operations Command Center</span>
              <span className="command-scope-divider" aria-hidden="true">·</span>
              <span className="command-tenant-badge">
                Tenant: <strong>{principal.tenant_id}</strong>
              </span>
              <span className="command-scope-divider" aria-hidden="true">·</span>
              <span className="command-fleet-badge">
                <Boxes size={12} aria-hidden="true" />
                Fleet: <strong>{projectList.length} {projectList.length === 1 ? 'Project' : 'Projects'}</strong>
              </span>
              <span className="command-scope-divider" aria-hidden="true">·</span>
              {projectWorkspace ? (
                <div className="command-scope-pill">
                  <span className="command-scope-dot" aria-hidden="true" />
                  <span className="command-scope-label">Current Scope:</span>
                  <strong className="command-scope-project-val">{projectName || principal.project_id}</strong>
                </div>
              ) : (
                <>
                  <div className="command-scope-pill command-scope-pill-admin">
                    <Shield size={12} aria-hidden="true" />
                    <span className="command-scope-label">Platform Scope:</span>
                    <strong className="command-scope-project-val">All Projects (Collated Fleet)</strong>
                  </div>
                  {projectList.length > 0 && onSelectProject && (
                    <button
                      type="button"
                      className="command-hero-jump-project-btn"
                      onClick={() => onSelectProject(principal.project_id || projectList[0].project_id)}
                      title={`Open project workspace pane for ${principal.project_id || projectList[0].project_id}`}
                    >
                      <span>Open Project Pane</span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                  )}
                </>
              )}

              {/* Status pill */}
              <span className={`command-hud-pill pill-${effectiveHealth.status}`}>
                <span className="hud-pulse-dot" aria-hidden="true" />
                {errors.health ? 'PROBE UNAVAILABLE' : `SYSTEM ${effectiveHealth.status.toUpperCase()}`}
              </span>

              {/* Mode badge */}
              <span className={`command-hud-pill pill-mode pill-mode-${mode}`}>
                {mode === 'live' ? 'LIVE RUNTIME' : 'DEMO MODE (SIMULATED)'}
              </span>
            </div>

            <h1 className="command-hero-title">
              {projectWorkspace ? `${projectName} Operations Console` : 'Platform Operations Command Center'}
            </h1>

            <p className="command-hero-desc">
              Fleet operations console covering <strong>{projectList.length} registered {projectList.length === 1 ? 'project' : 'projects'}</strong> in tenant <strong>{principal.tenant_id}</strong>. Point-in-time snapshot for incident triage, agent fleet health, diagnostics, and review queues.
              {lastObservedAt && (
                <span className="snapshot-timestamp">
                  {' '}· Snapshot captured at {lastObservedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="command-hero-actions">
          <button
            type="button"
            className="btn btn-secondary command-refresh-btn"
            disabled={loading}
            onClick={executeReload}
            title="Reload health, runs, diagnostics, and connector observations across projects"
          >
            <RefreshCw size={15} className={loading ? 'icon-spin' : ''} aria-hidden="true" />
            <span>{loading ? 'Refreshing…' : 'Refresh Snapshot'}</span>
          </button>
          {(canAdmin || effectiveProjects?.can_create) && onCreateProject && (
            <button type="button" className="btn btn-secondary command-create-project-btn" onClick={onCreateProject}>
              <Plus size={15} aria-hidden="true" />
              <span>New Project</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary command-investigate-btn"
            onClick={() => (onNewInvestigation ? onNewInvestigation() : onNavigate('chat'))}
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>New Investigation</span>
          </button>
        </div>
      </header>

      {/* Global probe error notice if any endpoint failed */}
      {Object.keys(errors).length > 0 && (
        <section className="overview-check-errors" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <h2>Some point-in-time checks could not load</h2>
            <p>Unreachable endpoints are marked &ldquo;Unavailable&rdquo; below. Other operational sections remain functional.</p>
            <details>
              <summary>Show probe failure details ({Object.keys(errors).length})</summary>
              <ul>
                {Object.entries(errors).map(([key, value]) => (
                  <li key={key}>
                    <strong>{sourceLabels[key as Source] || key}:</strong> {value}
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 32, fontSize: 13 }}
            onClick={executeReload}
          >
            Retry failed checks
          </button>
        </section>
      )}

      {/* Full-Width Executive KPI Strip: Fluid Responsive Real Estate */}
      <section className="command-kpi-grid" aria-label="Operational status indicators across platform and projects">
        {/* KPI 1: Platform Runtime Health */}
        <div
          className="command-kpi-card"
          onClick={() => onNavigate('health-checks')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNavigate('health-checks')}
        >
          <div className="kpi-card-header">
            <span className="kpi-card-label">Platform Health</span>
            <span className="kpi-scope-tag">Deployment Scope</span>
          </div>
          <div className="kpi-card-value">
            {errors.health ? (
              <span className="val-unavailable">Unavailable</span>
            ) : effectiveHealth.status === 'healthy' ? (
              'Healthy'
            ) : (
              'Degraded'
            )}
          </div>
          <div className="kpi-card-footer">
            <Activity size={13} aria-hidden="true" />
            <span>
              {errors.diagnostics ? (
                'Database latency: Unavailable'
              ) : data.diagnostics?.database?.latency_ms !== undefined ? (
                `${data.diagnostics.database.latency_ms}ms DB (${data.diagnostics.database.dialect || 'unknown'})`
              ) : (
                `${effectiveHealth.latency_ms}ms health probe`
              )}
            </span>
          </div>
        </div>

        {/* KPI 2: Tenant Project Fleet */}
        <div
          className="command-kpi-card"
          onClick={() => {
            const el = document.getElementById('project-fleet-heading');
            el?.scrollIntoView({ behavior: 'smooth' });
          }}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && document.getElementById('project-fleet-heading')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <div className="kpi-card-header">
            <span className="kpi-card-label">Tenant Project Fleet</span>
            <span className="kpi-scope-tag">Tenant Scope</span>
          </div>
          <div className="kpi-card-value">
            {errors.projects ? (
              <span className="val-unavailable">Unavailable</span>
            ) : (
              <>
                {projectList.length}
                <span className="kpi-unit">{projectList.length === 1 ? 'project' : 'projects'}</span>
              </>
            )}
          </div>
          <div className="kpi-card-footer">
            <Boxes size={13} aria-hidden="true" />
            <span>{projectWorkspace ? `Active context: ${principal.project_id}` : `Collated fleet: ${projectList.length} registered ${projectList.length === 1 ? 'project' : 'projects'}`}</span>
          </div>
        </div>

        {/* KPI 3: Recorded Investigations */}
        <div
          className="command-kpi-card"
          onClick={() => onNavigate('runs')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNavigate('runs')}
        >
          <div className="kpi-card-header">
            <span className="kpi-card-label">Investigation Runs</span>
            <span className="kpi-scope-tag">{projectWorkspace ? `Project Scope: ${principal.project_id}` : 'Platform Fleet (All Projects)'}</span>
          </div>
          <div className="kpi-card-value">
            {errors.runs ? (
              <span className="val-unavailable">Unavailable</span>
            ) : (
              <>
                {effectiveRuns.length}
                <span className="kpi-unit">recorded</span>
              </>
            )}
          </div>
          <div className="kpi-card-footer">
            <PlayCircle size={13} aria-hidden="true" />
            <span>
              {errors.runs
                ? 'Run counts unavailable'
                : `${completedRunsCount} completed · ${runningRunsCount} running · ${failedRunsCount} failed`}
            </span>
          </div>
        </div>

        {/* KPI 4: Configured Custom Agents */}
        <div
          className="command-kpi-card"
          onClick={() => onNavigate('agents')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNavigate('agents')}
        >
          <div className="kpi-card-header">
            <span className="kpi-card-label">Custom Agents</span>
            <span className="kpi-scope-tag">{projectWorkspace ? `Project Scope: ${principal.project_id}` : 'Platform Fleet (All Projects)'}</span>
          </div>
          <div className="kpi-card-value">
            {errors.agents ? (
              <span className="val-unavailable">Unavailable</span>
            ) : (
              <>
                {effectiveAgents.length}
                <span className="kpi-unit">specialists</span>
              </>
            )}
          </div>
          <div className="kpi-card-footer">
            <Bot size={13} aria-hidden="true" />
            <span>
              {errors.agents
                ? 'Agent counts unavailable'
                : `${activeAgents.length} active · ${pendingAgents.length} pending review`}
            </span>
          </div>
        </div>

        {/* KPI 5: Operational Alerts */}
        <div
          className="command-kpi-card"
          onClick={() => onNavigate('alerts')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNavigate('alerts')}
        >
          <div className="kpi-card-header">
            <span className="kpi-card-label">Active Alerts</span>
            <span className="kpi-scope-tag">Deployment Scope</span>
          </div>
          <div className="kpi-card-value">
            {errors.alerts ? (
              <span className="val-unavailable">Unavailable</span>
            ) : (
              <>
                {openAlerts.length}
                <span className="kpi-unit">open</span>
              </>
            )}
          </div>
          <div className="kpi-card-footer">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>
              {errors.alerts
                ? 'Alert feed unavailable'
                : `${criticalAlertsCount} critical · ${warningAlertsCount} warning · ${infoAlertsCount} info`}
            </span>
          </div>
        </div>
      </section>

      {/* Dedicated Section: Tenant Projects Fleet Roster */}
      <section className="command-card project-fleet-section" aria-labelledby="project-fleet-heading">
        <div className="command-card-header">
          <div>
            <h2 id="project-fleet-heading" className="command-card-title">
              Tenant Projects Fleet ({projectList.length})
            </h2>
            <p className="command-card-sub">
              All projects registered under tenant <strong>{principal.tenant_id}</strong>. Select a project to switch workspace context or review scoped settings.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(canAdmin || effectiveProjects?.can_create) && onCreateProject && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12.5, minHeight: 32 }}
                onClick={onCreateProject}
              >
                <Plus size={14} aria-hidden="true" />
                <span>Create Project</span>
              </button>
            )}
          </div>
        </div>

        {errors.projects ? (
          <div className="section-inline-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>Failed to load project directory: {errors.projects}</span>
            <button type="button" className="btn btn-secondary btn-xs" onClick={executeReload}>
              Retry projects
            </button>
          </div>
        ) : projectList.length > 0 ? (
          <div className="project-fleet-grid">
            {projectList.map(proj => {
              const isCurrent = proj.project_id === principal.project_id;
              return (
                <div
                  key={proj.project_id}
                  className={`project-fleet-card ${isCurrent ? 'is-current-project' : ''}`}
                >
                  <div className="fleet-card-header">
                    <div className="fleet-card-id-row">
                      <FolderGit2 size={16} className="fleet-folder-icon" />
                      <strong className="fleet-project-name">{proj.name || proj.project_id}</strong>
                    </div>
                    {isCurrent ? (
                      <span className="fleet-current-pill">
                        <Check size={11} aria-hidden="true" />
                        ACTIVE
                      </span>
                    ) : (
                      <span className="fleet-status-pill">{proj.status.toUpperCase()}</span>
                    )}
                  </div>

                  <div className="fleet-card-body">
                    <div className="fleet-key-line">
                      <code>{proj.project_id}</code>
                      {proj.last_accessed_at ? (
                        <span className="fleet-tz">Accessed {formatDate(proj.last_accessed_at)}</span>
                      ) : null}
                    </div>
                    {proj.description ? (
                      <p className="fleet-desc">{proj.description}</p>
                    ) : (
                      <p className="fleet-desc-empty">No project description</p>
                    )}
                    <div className="fleet-roles-bar">
                      <span className="fleet-role-label">Your Roles:</span>
                      {proj.roles.length > 0 ? (
                        proj.roles.map(r => (
                          <span key={r} className="fleet-role-pill">
                            {r.replace(/_/g, ' ').toLowerCase()}
                          </span>
                        ))
                      ) : (
                        <span className="fleet-role-pill">viewer</span>
                      )}
                    </div>
                  </div>

                  <div className="fleet-card-actions">
                    {!isCurrent && onSelectProject && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => onSelectProject(proj.project_id)}
                      >
                        Switch to this project
                      </button>
                    )}
                    {isCurrent && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => onNavigate('chat')}
                      >
                        Open Workspace Chat
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => onNavigate('project-setup')}
                    >
                      Project Setup
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="command-empty-card">
            <p>No projects found in this tenant directory.</p>
            {onCreateProject && (
              <button type="button" className="btn btn-secondary" onClick={onCreateProject}>
                <Plus size={14} aria-hidden="true" />
                Create First Project
              </button>
            )}
          </div>
        )}
      </section>

      {/* Main Operations Grid: Full-Width 2-Column Responsive Layout */}
      <div className="command-center-body-grid">
        {/* Left Column: Recent Investigations & Telemetry Diagnostics */}
        <div className="command-main-column">
          {/* Section: Recent Investigations */}
          <section className="command-card" aria-labelledby="triage-stream-heading">
            <div className="command-card-header">
              <div>
                <h2 id="triage-stream-heading" className="command-card-title">
                  Recent Investigations
                </h2>
                <p className="command-card-sub">
                  {projectWorkspace
                    ? <>Latest recorded runs in current project scope <strong>{principal.project_id}</strong> (up to 50 runs).</>
                    : <>Latest recorded runs across tenant fleet (up to 50 runs).</>}
                </p>
              </div>

              {/* Accessible Filter Tabs */}
              <div className="triage-filter-pills" role="tablist" aria-label="Investigation status filters">
                <button
                  type="button"
                  role="tab"
                  aria-selected={runFilter === 'all'}
                  className={`triage-pill ${runFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setRunFilter('all')}
                >
                  All ({effectiveRuns.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={runFilter === 'completed'}
                  className={`triage-pill ${runFilter === 'completed' ? 'is-active' : ''}`}
                  onClick={() => setRunFilter('completed')}
                >
                  Completed ({completedRunsCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={runFilter === 'running'}
                  className={`triage-pill ${runFilter === 'running' ? 'is-active' : ''}`}
                  onClick={() => setRunFilter('running')}
                >
                  Running ({runningRunsCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={runFilter === 'failed'}
                  className={`triage-pill ${runFilter === 'failed' ? 'is-active' : ''}`}
                  onClick={() => setRunFilter('failed')}
                >
                  Failed ({failedRunsCount})
                </button>
              </div>
            </div>

            {errors.runs ? (
              <div className="section-inline-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" />
                <span>Failed to load investigation runs: {errors.runs}</span>
                <button type="button" className="btn btn-secondary btn-xs" onClick={executeReload}>
                  Retry runs
                </button>
              </div>
            ) : filteredRuns.length > 0 ? (
              <div className="triage-stream-list">
                {filteredRuns.slice(0, 8).map(run => {
                  const isRunCompleted = run.status === 'COMPLETED';
                  const isRunRunning = run.status === 'RUNNING';
                  const isRunFailed = ['FAILED', 'BLOCKED'].includes(run.status);
                  const statusCls = isRunCompleted
                    ? 'status-completed'
                    : isRunRunning
                    ? 'status-running'
                    : isRunFailed
                    ? 'status-failed'
                    : 'status-neutral';

                  return (
                    <div key={run.id} className="triage-stream-row">
                      <div className="triage-status-col">
                        <span className={`triage-status-dot ${statusCls}`} aria-hidden="true" />
                        <span className={`triage-status-badge ${statusCls}`}>
                          {readable(run.status).toUpperCase()}
                        </span>
                      </div>

                      <div className="triage-detail-col">
                        <div className="triage-headline">
                          <button
                            type="button"
                            className="triage-title-btn"
                            onClick={() => (onOpenRun ? onOpenRun(run.id) : onNavigate('runs'))}
                            title={`Inspect run: ${run.id}`}
                          >
                            {run.prompt || readable(run.capability)}
                          </button>
                          <span className="triage-run-id" title="Investigation Run ID">
                            {run.id}
                          </span>
                          {run.incident_id && (
                            <span className="triage-incident-tag" title="Associated Incident ID">
                              {run.incident_id}
                            </span>
                          )}
                        </div>
                        <div className="triage-meta-bar">
                          <span className="triage-cap-badge">{readable(run.capability)}</span>
                          <span className="triage-time">
                            <Clock size={12} aria-hidden="true" />
                            {formatDate(run.created_at)}
                          </span>
                          {run.evidence_count !== undefined && (
                            <span className="triage-evidence-count">
                              {plural(run.evidence_count, 'evidence item')}
                            </span>
                          )}
                          {run.duration_seconds !== undefined ? (
                            <span className="triage-duration">
                              Duration: {run.duration_seconds.toFixed(1)}s
                            </span>
                          ) : (
                            <span className="triage-duration-unavailable">Duration: unrecorded</span>
                          )}
                          <span className="triage-mode-tag">
                            Mode: {run.mode === 'live' ? 'Live' : 'Demo'}
                          </span>
                        </div>
                      </div>

                      <div className="triage-action-col">
                        <button
                          type="button"
                          className="btn btn-secondary triage-open-btn"
                          onClick={() => (onOpenRun ? onOpenRun(run.id) : onNavigate('runs'))}
                          aria-label={`Inspect run ${run.id}`}
                        >
                          <span>Inspect</span>
                          <ArrowRight size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="command-empty-card">
                <p>No investigations match the selected filter in project {principal.project_id}.</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => (onNewInvestigation ? onNewInvestigation() : onNavigate('chat'))}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  Launch New Investigation
                </button>
              </div>
            )}

            <div className="command-card-footer">
              <button
                type="button"
                className="overview-text-action"
                onClick={() => onNavigate('runs')}
              >
                <span>Open full investigation history in Runs</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </section>

          {/* Section: Platform Diagnostics & Probes */}
          <section className="command-card" aria-labelledby="connectors-matrix-heading">
            <div className="command-card-header">
              <div>
                <h2 id="connectors-matrix-heading" className="command-card-title">
                  Telemetry Diagnostics & Probes
                </h2>
                <p className="command-card-sub">
                  Point-in-time observations for storage, persistence, and connector socket handshakes.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, minHeight: 32 }}
                onClick={() => onNavigate('health-checks')}
              >
                Health Check Details
              </button>
            </div>

            <div className="connector-matrix-grid">
              {/* Relational Database Probe */}
              <div className="connector-tile">
                <div className="connector-tile-header">
                  <div className="connector-tile-id">
                    <Database size={16} className="connector-tile-icon" />
                    <strong>Relational Persistence</strong>
                  </div>
                  <span
                    className={`connector-status-badge ${
                      errors.diagnostics
                        ? 'badge-unavailable'
                        : `badge-${data.diagnostics?.database?.status || 'degraded'}`
                    }`}
                  >
                    {errors.diagnostics
                      ? 'UNAVAILABLE'
                      : (data.diagnostics?.database?.status || 'UNREPORTED').toUpperCase()}
                  </span>
                </div>
                <div className="connector-tile-stats">
                  <span>
                    Latency:{' '}
                    {errors.diagnostics || data.diagnostics?.database?.latency_ms === undefined
                      ? 'Unavailable'
                      : `${data.diagnostics.database.latency_ms}ms`}
                  </span>
                  <span>
                    Dialect:{' '}
                    {errors.diagnostics || !data.diagnostics?.database?.dialect
                      ? 'Unavailable'
                      : data.diagnostics.database.dialect}
                  </span>
                </div>
              </div>

              {/* Local Storage Probe */}
              <div className="connector-tile">
                <div className="connector-tile-header">
                  <div className="connector-tile-id">
                    <HardDrive size={16} className="connector-tile-icon" />
                    <strong>Artifact Storage (CAS)</strong>
                  </div>
                  <span
                    className={`connector-status-badge ${
                      errors.diagnostics
                        ? 'badge-unavailable'
                        : `badge-${data.diagnostics?.storage?.status || 'degraded'}`
                    }`}
                  >
                    {errors.diagnostics
                      ? 'UNAVAILABLE'
                      : (data.diagnostics?.storage?.status || 'UNREPORTED').toUpperCase()}
                  </span>
                </div>
                <div className="connector-tile-stats">
                  <span>
                    Free Space:{' '}
                    {errors.diagnostics || data.diagnostics?.storage?.disk_free_gb === undefined
                      ? 'Unavailable'
                      : `${data.diagnostics.storage.disk_free_gb} GB`}
                  </span>
                  <span>
                    Writable:{' '}
                    {errors.diagnostics || data.diagnostics?.storage?.writable === undefined
                      ? 'Unavailable'
                      : data.diagnostics.storage.writable
                      ? 'Yes'
                      : 'Read-only'}
                  </span>
                </div>
              </div>

              {/* Memory / Agent Task Engine */}
              <div className="connector-tile">
                <div className="connector-tile-header">
                  <div className="connector-tile-id">
                    <Server size={16} className="connector-tile-icon" />
                    <strong>Agent Process Engine</strong>
                  </div>
                  <span
                    className={`connector-status-badge ${
                      errors.diagnostics
                        ? 'badge-unavailable'
                        : `badge-${data.diagnostics?.memory?.status || 'degraded'}`
                    }`}
                  >
                    {errors.diagnostics
                      ? 'UNAVAILABLE'
                      : (data.diagnostics?.memory?.status || 'UNREPORTED').toUpperCase()}
                  </span>
                </div>
                <div className="connector-tile-stats">
                  <span>
                    Memory RSS:{' '}
                    {errors.diagnostics || data.diagnostics?.memory?.rss_mb === undefined
                      ? 'Unavailable'
                      : `${data.diagnostics.memory.rss_mb} MB`}
                  </span>
                  <span>
                    Active Tasks:{' '}
                    {errors.diagnostics || data.diagnostics?.memory?.active_tasks === undefined
                      ? 'Unavailable'
                      : data.diagnostics.memory.active_tasks}
                  </span>
                </div>
              </div>

              {/* Observed Connector Health Probes */}
              {errors.connectorsHealth ? (
                <div className="connector-tile connector-tile-error">
                  <div className="connector-tile-header">
                    <div className="connector-tile-id">
                      <Cpu size={16} className="connector-tile-icon" />
                      <strong>Datasource Connectors</strong>
                    </div>
                    <span className="connector-status-badge badge-unavailable">UNAVAILABLE</span>
                  </div>
                  <div className="connector-tile-stats">
                    <span>Probe failure: {errors.connectorsHealth}</span>
                  </div>
                </div>
              ) : connectorKeys.length > 0 ? (
                connectorKeys.map(key => {
                  const record = connectorRecords[key];
                  const isHealthy = record?.overall === 'HEALTHY';
                  const isDegraded = record?.overall === 'DEGRADED';
                  return (
                    <div key={key} className="connector-tile">
                      <div className="connector-tile-header">
                        <div className="connector-tile-id">
                          <Cpu size={16} className="connector-tile-icon" />
                          <strong>{readable(key).toUpperCase()}</strong>
                        </div>
                        <span
                          className={`connector-status-badge ${
                            isHealthy ? 'badge-healthy' : isDegraded ? 'badge-degraded' : 'badge-neutral'
                          }`}
                        >
                          {record?.overall || 'UNKNOWN'}
                        </span>
                      </div>
                      <div className="connector-tile-stats">
                        <span>
                          Latency: {record?.latency_ms !== undefined ? `${record.latency_ms}ms` : 'Unavailable'}
                        </span>
                        <span>
                          Last probed:{' '}
                          {record?.last_probed_at ? formatDate(record.last_probed_at) : 'Time unrecorded'}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="connector-tile">
                  <div className="connector-tile-header">
                    <div className="connector-tile-id">
                      <Wrench size={16} className="connector-tile-icon" />
                      <strong>Project Conduits</strong>
                    </div>
                    <span className="connector-status-badge badge-neutral">
                      {enabledConnections.length} CONFIGURED
                    </span>
                  </div>
                  <div className="connector-tile-stats">
                    <span>
                      Enabled: {enabledConnections.map(c => c.system_name || c.instance_id).join(', ') || 'None'}
                    </span>
                    <span>Drafts: {unfinishedConnections.length}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Governance Reviews, Active Alerts & Readiness */}
        <div className="command-sidebar-column">
          {/* Section: Governance & Review Queue */}
          <section className="command-card" aria-labelledby="overview-review-title">
            <div className="command-card-header">
              <div>
                <h2 id="overview-review-title" className="command-card-title">
                  Needs a review
                </h2>
                <p className="command-card-sub">
                  Proposals awaiting review across skills, documents, and agent configurations.
                </p>
              </div>
              <span className={`command-count-pill ${reviews.length ? 'pill-alert' : 'pill-neutral'}`}>
                {reviews.length}
              </span>
            </div>

            {loading ? (
              <p role="status" className="command-empty-loading">Checking review queues…</p>
            ) : reviews.length > 0 ? (
              <ul className="overview-review-list">
                {reviews.slice(0, 6).map(item => (
                  <li key={item.key} className="overview-review-item">
                    <button
                      type="button"
                      className="overview-review-btn"
                      onClick={() => onNavigate(item.page, item.search)}
                    >
                      <div className="review-btn-header">
                        <span className="overview-review-kind">{item.kind}</span>
                        <span className="overview-review-scope">
                          {item.own
                            ? 'Authored by you · Requires peer review'
                            : `Authored by ${item.author}`}
                        </span>
                      </div>
                      <strong className="overview-review-name">{item.title}</strong>
                      <span className="review-route-hint">Open in {readable(item.page)}</span>
                      <ArrowRight size={14} className="overview-review-arrow" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="overview-empty">
                {reviewUnknown
                  ? 'Some review queues are unavailable. Open a component page to check its status.'
                  : 'No pending reviews in these queues.'}
              </p>
            )}

            <div className="overview-review-links">
              <button type="button" className="overview-text-action" onClick={() => onNavigate('skills')}>
                <span>Manage skills</span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
              <button type="button" className="overview-text-action" onClick={() => onNavigate('knowledge')}>
                <span>Review knowledge</span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
              {canAdmin && (
                <button type="button" className="overview-text-action" onClick={() => onNavigate('agents')}>
                  <span>Review agents</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>

          {/* Section: Operational Alerts Hub */}
          <section className="command-card" aria-labelledby="alerts-hub-title">
            <div className="command-card-header">
              <div>
                <h2 id="alerts-hub-title" className="command-card-title">
                  Operational Alerts
                </h2>
                <p className="command-card-sub">
                  Active alerts reported for deployment scope.
                </p>
              </div>
              <span className={`command-count-pill ${openAlerts.length ? 'pill-alert' : 'pill-neutral'}`}>
                {openAlerts.length}
              </span>
            </div>

            {errors.alerts ? (
              <div className="section-inline-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" />
                <span>Alerts feed unavailable: {errors.alerts}</span>
              </div>
            ) : loading ? (
              <p role="status" className="command-empty-loading">Loading alerts…</p>
            ) : openAlerts.length > 0 ? (
              <div className="command-alerts-list">
                {openAlerts.slice(0, 4).map(alert => (
                  <div
                    key={alert.id}
                    className="command-alert-item"
                    onClick={() => onNavigate('alerts')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && onNavigate('alerts')}
                  >
                    <div className="alert-item-header">
                      <span className={`alert-severity-pill sev-${alert.severity}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="alert-comp-tag">
                        {alert.source ? `${alert.source}: ` : ''}{alert.component}
                      </span>
                    </div>
                    <strong className="alert-title-text">{alert.title}</strong>
                    <p className="alert-msg-text">{alert.message || alert.summary}</p>
                    <span className="alert-created-time">
                      <Clock size={11} aria-hidden="true" />
                      Created: {formatDate(alert.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="command-empty-card">
                <CheckCircle2 size={24} className="empty-check-icon" aria-hidden="true" />
                <p>No open operational alerts reported for this scope.</p>
              </div>
            )}

            <div className="command-card-footer">
              <button
                type="button"
                className="overview-text-action"
                onClick={() => onNavigate('alerts')}
              >
                <span>View all alerts in Alerts</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </section>

          {/* Section: Setup & Capability Readiness */}
          <section className="command-card" aria-labelledby="readiness-title">
            <div
              className="command-card-header clickable-header"
              onClick={() => setReadinessOpen(v => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setReadinessOpen(v => !v)}
              aria-expanded={readinessOpen}
            >
              <div>
                <h2 id="readiness-title" className="command-card-title">
                  Setup & Capability Readiness
                </h2>
                <p className="command-card-sub">
                  {steps.filter(s => s.complete).length} of 5 capability dimensions configured.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, minHeight: 28 }}
                tabIndex={-1}
                aria-hidden="true"
              >
                {readinessOpen ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {readinessOpen && (
              <ol className="readiness-checklist">
                {steps.map((step, index) => (
                  <li key={step.key} className="readiness-item">
                    <span
                      className={`readiness-marker ${
                        step.complete && !loading && !errors[step.key as Source] ? 'is-complete' : ''
                      }`}
                      aria-hidden="true"
                    >
                      {step.complete && !loading && !errors[step.key as Source] ? (
                        <Check size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div className="readiness-content">
                      <div className="readiness-heading">
                        <strong>{step.title}</strong>
                        <span>{step.label}</span>
                      </div>
                      <p>{step.description}</p>
                      <button
                        type="button"
                        className="overview-text-action"
                        onClick={() => onNavigate(step.page, step.search)}
                      >
                        <span>{step.action}</span>
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {/* Subsystem Quick Launchpad: Spans Full Available Width */}
      <section className="command-launchpad-section" aria-labelledby="launchpad-heading">
        <h2 id="launchpad-heading" className="launchpad-heading">
          Platform Subsystems & Administrative Consoles
        </h2>
        <div className="launchpad-grid">
          <div
            className="launchpad-card"
            onClick={() => onNavigate('agents')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('agents')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <Bot size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Autonomous Agents</strong>
            <p>Configure custom agent topologies, YAML definitions, and specialist prompts.</p>
          </div>

          <div
            className="launchpad-card"
            onClick={() => onNavigate('health-checks')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('health-checks')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <HeartPulse size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Health & Socket Probes</strong>
            <p>Point-in-time latency benchmarks, socket handshakes, and datasource diagnostics.</p>
          </div>

          <div
            className="launchpad-card"
            onClick={() => onNavigate('skills')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('skills')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <Sparkles size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Skills & SRE Playbooks</strong>
            <p>Domain guidance, automated triage instructions, and playbook reviews.</p>
          </div>

          <div
            className="launchpad-card"
            onClick={() => onNavigate('parameters')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('parameters')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <Terminal size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Parameter Studio</strong>
            <p>Hierarchical configuration overrides across project, environment, and platform.</p>
          </div>

          <div
            className="launchpad-card"
            onClick={() => onNavigate('policy')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('policy')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <ShieldAlert size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Security & Redaction</strong>
            <p>PII redaction guardrails, credential masking, and compliance validation.</p>
          </div>

          <div
            className="launchpad-card"
            onClick={() => onNavigate('governance')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate('governance')}
          >
            <div className="launchpad-card-header">
              <div className="launchpad-icon-box">
                <ShieldCheck size={20} />
              </div>
              <ArrowUpRight size={16} className="launchpad-arrow" />
            </div>
            <strong>Governance & Audit</strong>
            <p>Immutable audit trail, reviewer authorizations, and change lineage.</p>
          </div>
        </div>
      </section>

      {!canManage && (
        <p className="overview-access-note">
          Your account has read-only access to this Command Center. Configuration changes require a Project Owner or Platform Admin role.
        </p>
      )}
    </div>
  );
}
