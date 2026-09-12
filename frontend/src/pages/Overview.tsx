import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCog,
  Layers,
  Play,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Users,
  Wrench,
  Zap,
  CreditCard,
  KeyRound,
  HardDrive,
  BookOpen,
} from 'lucide-react';
import { fetchAlerts, fetchTools, fetchParameters, fetchHarnessLibrary } from '../services/api';
import type { AgentConfiguration, AlertItem, Run, SystemHealth, ToolDefinition, ParameterDefinitionRow, HarnessResponse } from '../types/api';
import type { ActivePage } from '../components/Sidebar';
import '../styles/overview.css';

interface OverviewProps {
  health: SystemHealth;
  agents: AgentConfiguration[];
  runs: Run[];
  onNavigate: (page: ActivePage) => void;
  onNewInvestigation?: () => void;
  onOpenRun?: (id: string) => void;
}

const formatDate = (value: string | number) => {
  try {
    const d = new Date(typeof value === 'number' ? value * 1000 : value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
};

export const Overview: React.FC<OverviewProps> = ({
  health,
  agents,
  runs,
  onNavigate,
  onNewInvestigation,
  onOpenRun,
}) => {
  const [tools, setTools] = useState<ToolDefinition[] | null>(null);
  const [parameters, setParameters] = useState<ParameterDefinitionRow[] | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertLoading, setAlertLoading] = useState(false);

  const loadAlerts = async () => {
    setAlertLoading(true);
    setAlertError(null);
    try {
      const resp = await fetchAlerts();
      setAlerts(resp.items.filter(item => item.status === 'open').slice(0, 5));
    } catch (reason) {
      setAlertError(reason instanceof Error ? reason.message : 'Unable to load operational alerts.');
    } finally {
      setAlertLoading(false);
    }
  };

  const [harnessData, setHarnessData] = useState<HarnessResponse | null>(null);

  useEffect(() => {
    fetchTools().then(setTools).catch(() => setTools([]));
    fetchParameters().then(setParameters).catch(() => setParameters([]));
    fetchHarnessLibrary().then(setHarnessData).catch(() => setHarnessData(null));
    void loadAlerts();
  }, []);

  const pending = agents.filter(agent => agent.status === 'pending');
  const approved = agents.filter(agent => agent.status === 'active' || (agent as { status: string }).status === 'approved');
  const platformAgentsCount = harnessData?.document?.agents?.length ?? 4;
  const activeSpecialistsTotal = approved.length + (harnessData?.effective_agents?.length ?? platformAgentsCount);
  const connectorCount = tools?.filter(
    tool => tool.type === 'connector' || tool.integration_kind === 'native' || tool.integration_kind === 'mcp'
  ).length ?? 0;
  const activeRunsCount = runs.filter(run => run.status === 'RUNNING').length;
  const totalEvidenceCount = runs.reduce((acc, r) => acc + (r.evidence_count || 0), 0);
  const totalParameters = parameters?.length ?? 0;
  const overriddenParameters = parameters?.filter(p => p.override_revision && p.override_revision > 0).length ?? 0;

  const adminControls: Array<{
    title: string;
    description: string;
    page: ActivePage;
    statusText: string;
    statusTone?: 'normal' | 'highlight' | 'warning';
    icon: React.ReactNode;
  }> = [
    {
      title: 'Users & Operator Access',
      description: 'Manage administrator accounts, assign scoped roles, and oversee RS256 principals.',
      page: 'users',
      statusText: 'Active Identity Directory',
      statusTone: 'highlight',
      icon: <Users size={16} />,
    },
    {
      title: 'Roles & RBAC Matrix',
      description: 'Define custom operational roles, fine-grained permission matrices, and custody gates.',
      page: 'roles',
      statusText: 'Declarative Security Roles',
      statusTone: 'normal',
      icon: <KeyRound size={16} />,
    },
    {
      title: 'Policy & Redaction Rules',
      description: 'Configure PII regex sanitization, dual-custody gates, and execution deadlines.',
      page: 'policy',
      statusText: 'Zero PII Leakage Enforced',
      statusTone: 'normal',
      icon: <ShieldCheck size={16} />,
    },
    {
      title: 'Compute Quota & Token Budgets',
      description: 'Manage monthly spend limits, token consumption thresholds, and model rate limits.',
      page: 'billing',
      statusText: 'Live Spend Aggregation',
      statusTone: 'normal',
      icon: <CreditCard size={16} />,
    },
    {
      title: 'Diagnostic Tools & Connectors',
      description: 'Splunk correlation, Jira triage, file extractors, and MCP tool broker.',
      page: 'tools',
      statusText: tools === null ? 'Checking...' : `${connectorCount} active conduits`,
      statusTone: 'highlight',
      icon: <Wrench size={16} />,
    },
    {
      title: 'Specialist Agents & Approvals',
      description: 'Declarative ADK multi-agent hierarchy, model routing, and YAML approvals.',
      page: 'agents',
      statusText: pending.length > 0 ? `${pending.length} pending review` : `${approved.length} approved`,
      statusTone: pending.length > 0 ? 'warning' : 'normal',
      icon: <Bot size={16} />,
    },
    {
      title: 'Runtime Engine & Node Tuning',
      description: 'Tune model profiles, thinking budgets, output caps, and instructions per agent stage.',
      page: 'runtime',
      statusText: 'Google ADK 2.9 Graph',
      statusTone: 'highlight',
      icon: <Zap size={16} />,
    },
    {
      title: 'Parameter Studio & Tuning',
      description: 'Create, validate, review, and publish versioned parameter sets directly to runtime.',
      page: 'parameters',
      statusText: parameters === null ? 'Loading…' : `${totalParameters} parameters · ${overriddenParameters} overrides`,
      statusTone: overriddenParameters > 0 ? 'highlight' : 'normal',
      icon: <Sliders size={16} />,
    },
    {
      title: 'Knowledge & Runbook Corpus',
      description: 'Publish incident response runbooks and troubleshooting guides for agent synthesis.',
      page: 'knowledge',
      statusText: 'Domain Context Library',
      statusTone: 'normal',
      icon: <BookOpen size={16} />,
    },
    {
      title: 'Persistence & Retention Purge',
      description: 'Set memory-safe upload limits, file parsing boundaries, and execute data lifecycle sweeps.',
      page: 'persistence',
      statusText: 'Bounded Local Storage & DB',
      statusTone: 'normal',
      icon: <HardDrive size={16} />,
    },
    {
      title: 'Deployment Settings & Scope',
      description: 'Scope boundaries, simulation mode, persistence & runtime constraints.',
      page: 'project-setup',
      statusText: health.mode === 'demo' ? 'Demo Mode (Simulated)' : 'Live Mode (Connected)',
      statusTone: health.mode === 'demo' ? 'warning' : 'normal',
      icon: <Settings size={16} />,
    },
    {
      title: 'Operational Alerts & Broadcast',
      description: 'Evaluate latency & failure tripwires, acknowledge alerts, or broadcast advisories.',
      page: 'alerts',
      statusText: alerts === null ? 'Checking...' : `${alerts.length} active alerts`,
      statusTone: alerts && alerts.length > 0 ? 'warning' : 'normal',
      icon: <CircleAlert size={16} />,
    },
  ];

  return (
    <div className="view-container overview-page">
      {/* Hero Banner (Aligned with Agents & Capabilities) */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Administration <span>Overview</span>
          </h1>
          <p className="hero-lede">
            Autonomous SRE control plane: manage deployment scope, govern specialist agents, and monitor operational telemetry.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Shield size={12} color="var(--acc)" />
              <b>Scope:</b> {health.tenant_id && health.project_id ? `${health.tenant_id} / ${health.project_id}` : '—'}
            </span>
            <span className="hero-stat-chip">
              <span className={`dot ${health.mode === 'demo' ? '' : 'pulse'}`} />
              <b>Mode:</b> {health.mode === 'demo' ? 'Demo (Simulated)' : 'Live'}
            </span>
            <span className="hero-stat-chip">
              <Activity size={12} color="var(--acc3)" />
              <b>Status:</b> {health.status} {health.latency_ms > 0 ? `(${health.latency_ms}ms)` : ''}
            </span>
            <span className="hero-stat-chip">
              <b>Active Specialists:</b> {activeSpecialistsTotal}
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            {onNewInvestigation && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onNewInvestigation}
                title="Launch new root cause investigation"
              >
                <Play size={13} strokeWidth={2.5} /> New Investigation
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('parameters')}
              title="Tune platform & project parameters"
            >
              <Sliders size={13} /> Parameters
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('project-setup')}
              title="Configure project scope & connectors"
            >
              <FileCog size={13} /> Project Setup
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('settings')}
              title="View platform settings"
            >
              <Settings size={13} /> Settings
            </button>
          </div>
        </div>
      </section>

      {/* KPI / Telemetry Metric Grid (Aligned with standard layout.css .metric-grid) */}
      <section className="metric-grid">
        <div
          className="metric-card"
          onClick={() => onNavigate('health-checks')}
          role="button"
          tabIndex={0}
          title="Inspect connector probe latencies"
        >
          <div className="metric-label-row">
            <span>Platform Health</span>
            <Activity size={14} className={`text-status-${health.status}`} />
          </div>
          <div className="metric-value text-capitalize">{health.status}</div>
          <p className="metric-meta">
            {health.latency_ms ? `${health.latency_ms}ms probe latency` : 'Zero latency degradation'} · <b>{health.mode}</b>
          </p>
        </div>

        <div
          className="metric-card"
          onClick={() => onNavigate('agents')}
          role="button"
          tabIndex={0}
          title="View specialist agents & review queue"
        >
          <div className="metric-label-row">
            <span>Specialist Agents</span>
            <Bot size={14} />
          </div>
          <div className="metric-value">{activeSpecialistsTotal} Active</div>
          <p className="metric-meta">
            {pending.length > 0 ? (
              <span className="text-warning"><b>{pending.length}</b> awaiting dual-custody review</span>
            ) : (
              `${platformAgentsCount} platform · ${approved.length} custom`
            )}
          </p>
        </div>

        <div
          className="metric-card"
          onClick={() => onNavigate('tools')}
          role="button"
          tabIndex={0}
          title="View configured tools & connectors"
        >
          <div className="metric-label-row">
            <span>Evidence Conduits</span>
            <Wrench size={14} />
          </div>
          <div className="metric-value">{tools ? tools.length : '—'} Available</div>
          <p className="metric-meta">
            <b>{connectorCount}</b> active tools (Jira, Splunk, OCR & MCP)
          </p>
        </div>

        <div
          className="metric-card"
          onClick={() => onNavigate('runs')}
          role="button"
          tabIndex={0}
          title="Inspect root cause investigation runs"
        >
          <div className="metric-label-row">
            <span>RCA Investigations</span>
            <Layers size={14} />
          </div>
          <div className="metric-value">{runs.length} Runs</div>
          <p className="metric-meta">
            <b>{activeRunsCount}</b> active · <b>{totalEvidenceCount}</b> evidence synthesized
          </p>
        </div>
      </section>

      {/* Live Operational Action Deck (Pending Approvals, Operational Alerts, Recent Runs) */}
      <section className="admin-ops-deck">
        {/* Dual-Custody Pending Approvals */}
        <div className="admin-ops-card">
          <div className="rail-card-head">
            <div className="rail-title-row">
              <ShieldCheck size={18} className="rail-head-icon" />
              <h3>Pending Approvals</h3>
            </div>
            {pending.length > 0 ? (
              <span className="badge badge-warning">{pending.length} pending</span>
            ) : (
              <span className="obs-status-chip tone-healthy">0 Pending</span>
            )}
          </div>
          <p className="rail-card-sub">Agent definitions awaiting dual-custody review.</p>

          <div className="rail-card-body">
            {pending.length > 0 ? (
              <div className="pending-agents-list">
                {pending.slice(0, 3).map(agent => (
                  <div
                    key={agent.id}
                    className="pending-agent-item"
                    onClick={() => onNavigate('agents')}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="agent-item-info">
                      <span className="agent-item-name">{agent.name || agent.id}</span>
                      <div className="agent-item-tags">
                        <span className="tag-role">{agent.role}</span>
                        <span className="tag-ver">{agent.version || 'v1.0.0'}</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className="agent-item-arrow" />
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-outline-sm btn-full"
                  onClick={() => onNavigate('agents')}
                >
                  Open Review Queue
                </button>
              </div>
            ) : (
              <div className="empty-rail-state">
                <CheckCircle2 size={22} className="empty-state-icon text-success" />
                <p>All agent definitions approved & ready.</p>
              </div>
            )}
          </div>
        </div>

        {/* Operational Alerts */}
        <div className="admin-ops-card">
          <div className="rail-card-head">
            <div className="rail-title-row">
              <Bell size={18} className="rail-head-icon" />
              <h3>Operational Alerts</h3>
            </div>
            <button
              type="button"
              className="rail-refresh-btn"
              onClick={() => void loadAlerts()}
              disabled={alertLoading}
              title="Refresh alerts"
            >
              <RefreshCw size={13} className={alertLoading ? 'spin' : ''} />
            </button>
          </div>
          <p className="rail-card-sub">Recent service events and telemetry signals.</p>

          <div className="rail-card-body">
            {alertLoading && <p className="rail-muted-status">Checking live alerts...</p>}
            {alertError && (
              <div className="rail-error-box">
                <span>{alertError}</span>
                <button type="button" className="btn-inline" onClick={() => void loadAlerts()}>
                  Retry
                </button>
              </div>
            )}
            {!alertLoading && !alertError && (!alerts || alerts.length === 0) && (
              <div className="empty-rail-state">
                <span className="empty-state-dot success" />
                <p>All systems nominal · Zero active alerts.</p>
              </div>
            )}
            {alerts && alerts.length > 0 && (
              <div className="rail-alerts-list">
                {alerts.slice(0, 3).map(alert => (
                  <div className="rail-alert-item" key={alert.id}>
                    <span className={`alert-indicator-dot severity-${alert.severity || 'info'}`} />
                    <div className="alert-content">
                      <strong className="alert-title">{alert.title}</strong>
                      <div className="alert-meta">
                        <span>{alert.source || 'system'}</span>
                        <span className="meta-sep">•</span>
                        <span>{formatDate(alert.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Operational Runs */}
        <div className="admin-ops-card">
          <div className="rail-card-head">
            <div className="rail-title-row">
              <Activity size={18} className="rail-head-icon" />
              <h3>Recent Investigations</h3>
            </div>
            <button
              type="button"
              className="rail-link-action"
              onClick={() => onNavigate('runs')}
            >
              View all
            </button>
          </div>
          <p className="rail-card-sub">Latest root cause investigations.</p>

          <div className="rail-card-body">
            {runs.length > 0 ? (
              <div className="recent-runs-list">
                {runs.slice(0, 3).map(run => (
                  <div
                    key={run.id}
                    className="recent-run-item"
                    onClick={() => (onOpenRun ? onOpenRun(run.id) : onNavigate('runs'))}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="run-item-top">
                      <span className="run-cap-name" title={run.incident_id || run.capability}>
                        {run.incident_id || run.capability}
                      </span>
                      <span className={`run-status-chip status-${run.status.toLowerCase()}`}>
                        {run.status}
                      </span>
                    </div>
                    <div className="run-item-bottom">
                      <span className="run-evidence-pill">
                        <Layers size={11} />
                        {run.evidence_count ?? 0} evidence
                      </span>
                      <span className="run-time">{formatDate(run.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-rail-state">
                <span className="empty-state-dot success" />
                <p>No investigations launched yet.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Deployment & Architecture Controls (Full Width) */}
      <section className="admin-card-section">
        <div className="admin-card-header">
          <div>
            <h2 className="section-title">Deployment & Architecture Controls</h2>
            <p className="section-subtitle">Core configuration pillars governing this Autonomous SRE workspace.</p>
          </div>
          <span className="control-count-badge">{adminControls.length} Modules</span>
        </div>

        <div className="admin-controls-grid">
          {adminControls.map(item => (
            <button
              type="button"
              className="admin-control-card"
              key={item.title}
              onClick={() => onNavigate(item.page)}
            >
              <div className="control-card-top">
                <div className="control-icon-box">{item.icon}</div>
                <div className="control-heading">
                  <strong className="control-title">{item.title}</strong>
                </div>
                <ArrowRight size={14} className="control-arrow" />
              </div>
              <p className="control-desc">{item.description}</p>
              <div className="control-card-footer">
                <span className={`control-status-badge tone-${item.statusTone || 'normal'}`}>
                  {item.statusText}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Observability & Runtime Telemetry Shelf (Full Width) */}
      <section className="admin-card-section observability-shelf">
        <div className="admin-card-header">
          <div>
            <h2 className="section-title">Observability & Runtime Telemetry</h2>
            <p className="section-subtitle">Deep inspection into workflow stages, connector handshakes, and immutable audit logs.</p>
          </div>
          <span className="obs-live-indicator">
            <span className="dot pulse" /> Live Telemetry
          </span>
        </div>

        <div className="admin-observability-grid">
          <button
            type="button"
            className="obs-card"
            onClick={() => onNavigate('health-checks')}
          >
            <div className="obs-card-head">
              <div className="obs-icon check-icon">
                <CheckCircle2 size={18} />
              </div>
              <span className="obs-status-chip tone-healthy">Active Probes</span>
              <ArrowRight size={14} className="obs-arrow" />
            </div>
            <strong className="obs-title">Connector Health Checks</strong>
            <p className="obs-desc">Real-time socket probing, auth verification, and latency checks across live connectors.</p>
            <div className="obs-footer-meta">
              <span>{health.latency_ms ? `${health.latency_ms}ms probe latency` : 'Zero latency degradation'}</span>
              <span className="meta-dot">·</span>
              <span>Splunk & Jira online</span>
            </div>
          </button>

          <button
            type="button"
            className="obs-card"
            onClick={() => onNavigate('runtime')}
          >
            <div className="obs-card-head">
              <div className="obs-icon runtime-icon">
                <Clock3 size={18} />
              </div>
              <span className="obs-status-chip tone-runtime">ADK Workflow</span>
              <ArrowRight size={14} className="obs-arrow" />
            </div>
            <strong className="obs-title">ADK Graph Runtime</strong>
            <p className="obs-desc">Inspect native workflow execution graph, thinking levels, timeouts, and model parameters.</p>
            <div className="obs-footer-meta">
              <span>Google ADK 2.9 Graph</span>
              <span className="meta-dot">·</span>
              <span>JoinNode Synthesis</span>
            </div>
          </button>

          <button
            type="button"
            className="obs-card"
            onClick={() => onNavigate('governance')}
          >
            <div className="obs-card-head">
              <div className="obs-icon audit-icon">
                <ShieldCheck size={18} />
              </div>
              <span className="obs-status-chip tone-audit">Audit Immutable</span>
              <ArrowRight size={14} className="obs-arrow" />
            </div>
            <strong className="obs-title">Governance Audit Log</strong>
            <p className="obs-desc">Cryptographically verifiable immutable audit trail of all administrative decisions.</p>
            <div className="obs-footer-meta">
              <span>Dual-Custody Logged</span>
              <span className="meta-dot">·</span>
              <span>RS256 Verified</span>
            </div>
          </button>
        </div>
      </section>

      {/* Demo Mode Notice */}
      {health.mode === 'demo' && (
        <div className="notice-banner" style={{ marginTop: 4 }}>
          <CircleAlert size={15} style={{ color: 'var(--acc-amber)', flexShrink: 0 }} />
          <span>
            <strong>Demo Simulation Active:</strong> RCA Analyzer is running with simulated telemetry data and local fixtures. Connect live Splunk and Jira credentials in Project Setup for production RCA.
          </span>
        </div>
      )}
    </div>
  );
};

