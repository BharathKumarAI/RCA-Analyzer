import { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  HardDrive,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  Zap,
  Copy,
  Check,
  Server,
  Sparkles,
  Play,
  FolderGit2,
  ShieldAlert,
  ArrowRight,
  SlidersHorizontal,
  FileCode
} from 'lucide-react';
import { fetchConfig, fetchSystemDiagnostics, testSystemConnection } from '../services/api';
import type {
  Principal,
  SystemDiagnostics,
  SystemHealth,
  ConnectionTestTargetResult
} from '../types/api';

interface SettingsProps {
  principal: Principal;
  health: SystemHealth;
}

interface EffectiveConfig {
  configuration_hash: string;
  execution: {
    run_timeout_seconds: number;
    max_concurrent_runs: number;
    retention_days: number;
    max_llm_calls: number;
    max_context_chars: number;
  };
  workflow: Record<string, boolean>;
  file_limits: { allowed_extensions: string[] };
}

const tabs = [
  'Platform Deployment (.env)',
  'Connection Diagnostics',
  'MLflow Platform Tracking',
  'Database Persistence',
  'Storage & Blob CAS',
  'Platform vs Project Matrix'
] as const;

type TabName = typeof tabs[number];

export function Settings({ principal, health }: SettingsProps) {
  const [tab, setTab] = useState<TabName>('Platform Deployment (.env)');
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestTargetResult>>({});
  const [copiedEnv, setCopiedEnv] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextDiagnostics, nextConfig] = await Promise.all([
        fetchSystemDiagnostics(),
        fetchConfig()
      ]);
      setDiagnostics(nextDiagnostics);
      setConfig(nextConfig);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [principal.subject]);

  async function handleRunTest(target: 'all' | 'database' | 'memory' | 'storage' | 'mlflow' | 'connectors') {
    setError(null);
    setTestRunning(prev => ({ ...prev, [target]: true }));
    try {
      const resp = await testSystemConnection(target);
      if (resp && resp.results) {
        setTestResults(prev => ({ ...prev, ...resp.results }));
      }
      const nextDiagnostics = await fetchSystemDiagnostics();
      setDiagnostics(nextDiagnostics);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      setError(msg);
      setTestResults(prev => ({
        ...prev,
        [target]: {
          target: target === 'all' ? 'database' : target,
          status: 'error',
          latency_ms: 0,
          message: msg
        }
      }));
    } finally {
      setTestRunning(prev => ({ ...prev, [target]: false }));
    }
  }

  function handleCopyEnv() {
    const envTemplate = `# ==============================================================================
# RCA Analyzer - Platform Deployment Configuration (.env)
# ==============================================================================
# Platform scope applies server-wide across all tenants and projects.

# 1. Platform Execution Mode
RCA_MODE=live
RCA_TENANT_ID=${principal.tenant_id || 'engineering'}
RCA_PROJECT_ID=${principal.project_id || 'core-services'}

# 2. RS256 Authentication Setup (Server-side verification)
RCA_AUTH_ISSUER=https://auth.internal.example.com
RCA_AUTH_AUDIENCE=rca-analyzer-internal
RCA_AUTH_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"
RCA_PRINCIPALS_JSON='{"admin-1":{"roles":["administrator"],"tenant_id":"engineering","project_id":"core-services"}}'

# 3. Database Persistence Engine
RCA_DATABASE_URL=postgresql+asyncpg://rca_user:secret@localhost:5432/rca_db
RCA_SESSION_DATABASE_URL=sqlite+aiosqlite:///./data/sessions.db
RCA_DATABASE_CONFIGURATION=false

# 4. Storage & Content CAS Root
RCA_CONTENT_ROOT=./blob_local/platform
RCA_CONFIG_BLOB_URI=gs://my-bucket/rca/configs
RCA_PROJECTS_BLOB_URI=gs://my-bucket/rca/projects

# 5. MLflow Tracking & Optimization Store
RCA_OPTIMIZATION_TRACKING_URI=sqlite:///./data/optimization-mlflow.db
RCA_OPTIMIZATION_BLOB_URI=gs://my-bucket/rca/optimizations
MLFLOW_EXPERIMENT_NAME=rca-optimization-eval

# 6. Global Platform Execution Bounds
RCA_RUN_TIMEOUT_SECONDS=120
RCA_MAX_CONCURRENT_RUNS=4
RCA_MAX_LLM_CALLS=12
RCA_MAX_INPUT_CHARS=16000
RCA_MAX_CONTEXT_CHARS=64000
RCA_RETENTION_DAYS=90

# 7. Connector Integrations & Security
RCA_INTEGRATION_ALLOWED_HOSTS=jira.internal.example.com,splunk.internal.example.com
RCA_INTEGRATION_SECRET_REFERENCES=env://JIRA_API_TOKEN,env://SPLUNK_API_TOKEN
`;
    navigator.clipboard.writeText(envTemplate).then(() => {
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2500);
    }).catch(() => setError('Unable to copy the deployment template. Check clipboard permissions and try again.'));
  }

  const rows = (values: Array<[string, string | number]>) => (
    <dl className="settings-values">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="view-container">
      {/* Page Header */}
      <header className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h1 style={{ margin: 0 }}>Platform <span>Settings</span></h1>
            <span className="badge badge-active" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Deployment Scope
            </span>
          </div>
          <p className="page-subtitle">
            Server-wide infrastructure, persistence engines, MLflow tracking store, and hardware diagnostics. Managed by platform administrators.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <a
            className="btn btn-secondary"
            href="#project-setup"
            title="Configure project-specific overrides, stage prompts, and capabilities"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <FolderGit2 size={15} /> Project Settings →
          </a>
          <button
            className="btn btn-secondary"
            onClick={() => void handleRunTest('all')}
            disabled={loading || testRunning['all']}
            title="Run diagnostics test on Database, Memory, Storage, MLflow, and Connectors"
          >
            <Play size={15} /> {testRunning['all'] ? 'Testing all…' : 'Test All Connections'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Scope Clarification Alert */}
      <div
        style={{
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '8px',
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldAlert size={20} style={{ color: 'var(--primary, #3b82f6)', flexShrink: 0 }} />
          <div style={{ fontSize: '13px' }}>
            <strong style={{ color: 'var(--tx, #f8fafc)' }}>Platform Settings vs. Project Settings Architecture</strong>
            <div style={{ color: 'var(--muted, #cbd5e1)', marginTop: '3px' }}>
              <strong>Platform Settings</strong> (this view) manage process-wide deployment infrastructure (PostgreSQL, CAS disk root, MLflow server, RS256 Auth).
              <strong> Project Settings</strong> (scoped to <code>{principal.tenant_id || 'tenant'} / {principal.project_id || 'project'}</code>) configure capability delegations, stage prompts, and disabled connectors.
            </div>
          </div>
        </div>
        <a
          className="btn btn-secondary"
          href="#project-setup"
          style={{ fontSize: '12px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          Open Project Settings <ArrowRight size={13} />
        </a>
      </div>

      {error && (
        <div className="notice-banner" role="alert" style={{ borderColor: 'var(--amber, #f59e0b)' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Metric Quick-View Cards */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Database Engine</span>
            <Database size={15} />
          </div>
          <div className="metric-value">
            {diagnostics?.database.status === 'healthy' ? (
              <span style={{ color: 'var(--green, #10b981)' }}>Healthy</span>
            ) : diagnostics ? (
              <span style={{ color: 'var(--amber, #f59e0b)' }}>{diagnostics.database.status}</span>
            ) : '—'}
          </div>
          <p className="metric-meta">
            {diagnostics ? `${diagnostics.database.dialect} · ${diagnostics.database.latency_ms} ms probe` : 'Waiting for diagnostics'}
          </p>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Process Memory &amp; Tasks</span>
            <Cpu size={15} />
          </div>
          <div className="metric-value">
            {diagnostics ? `${diagnostics.memory.rss_mb} MB` : '—'}
          </div>
          <p className="metric-meta">
            {diagnostics ? `${diagnostics.memory.active_tasks} active async tasks · ${diagnostics.memory.status}` : 'Waiting for diagnostics'}
          </p>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Server CAS Storage</span>
            <HardDrive size={15} />
          </div>
          <div className="metric-value">
            {diagnostics ? `${diagnostics.storage.disk_free_gb} GB` : '—'}
          </div>
          <p className="metric-meta">
            {diagnostics ? `${diagnostics.storage.writable ? 'Writable' : 'Read-only'} · ${diagnostics.storage.cas_layout}` : 'Waiting for diagnostics'}
          </p>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>MLflow Tracking Server</span>
            <Sparkles size={15} />
          </div>
          <div className="metric-value">
            {diagnostics?.mlflow.status === 'configured' || diagnostics?.mlflow.status === 'connected' ? (
              <span style={{ color: 'var(--green, #10b981)' }}>Configured</span>
            ) : (
              <span style={{ color: 'var(--dim, #94a3b8)' }}>Unconfigured</span>
            )}
          </div>
          <p className="metric-meta">
            {diagnostics ? `${diagnostics.mlflow.offline_eval_contracts.length} eval contracts active` : 'Waiting for diagnostics'}
          </p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" style={{ flexWrap: 'wrap' }}>
        {tabs.map(name => (
          <button
            type="button"
            key={name}
            id={`settings-tab-${name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
            data-tab={name}
            role="tab"
            aria-selected={tab === name}
            className={`btn ${tab === name ? 'btn-primary' : 'btn-secondary'}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTab(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Main Settings Panel */}
      <section
        id="settings-panel"
        role="tabpanel"
        className="notice-banner"
        style={{ background: 'var(--card, #111a2e)', border: '1px solid var(--line, #22314d)', padding: '24px', borderRadius: '8px' }}
      >
        {loading && !config && !diagnostics ? (
          <p role="status">Loading deployment settings…</p>
        ) : !config || !diagnostics ? (
          <p>Connect an authenticated session to inspect this deployment.</p>
        ) : (
          <>
            {/* TAB 1: Platform Deployment (.env) */}
            {tab === 'Platform Deployment (.env)' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Server size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                      Platform Deployment Setup (.env &amp; Server Scope)
                    </h3>
                    <p className="page-subtitle" style={{ margin: 0 }}>
                      Deployment-wide parameters and infrastructure secrets configured strictly via server environment.
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={handleCopyEnv}
                    title="Copy full server .env template to clipboard"
                  >
                    {copiedEnv ? <Check size={15} style={{ color: 'var(--green, #10b981)' }} /> : <Copy size={15} />}
                    {copiedEnv ? 'Copied Server .env!' : 'Copy Platform .env Template'}
                  </button>
                </div>

                {/* Platform Readiness Checklist */}
                <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '6px', padding: '16px', marginBottom: '24px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted, #cbd5e1)' }}>
                    Platform Deployment Readiness Checklist
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      <div>
                        <strong>Platform Scope:</strong> {principal.tenant_id} / {principal.project_id}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      <div>
                        <strong>RS256 Server Auth:</strong> {principal.subject ? `Subject: ${principal.subject}` : 'Demo token'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {diagnostics.database.status === 'healthy' ? (
                        <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      ) : (
                        <AlertTriangle size={16} style={{ color: 'var(--amber, #f59e0b)', flexShrink: 0 }} />
                      )}
                      <div>
                        <strong>SQLAlchemy Async DB:</strong> {diagnostics.database.dialect} ({diagnostics.database.status})
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {diagnostics.storage.writable ? (
                        <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      ) : (
                        <AlertTriangle size={16} style={{ color: 'var(--amber, #f59e0b)', flexShrink: 0 }} />
                      )}
                      <div>
                        <strong>Server CAS Storage:</strong> {diagnostics.storage.writable ? 'Writable' : 'Read-only'} ({diagnostics.storage.disk_free_gb} GB free)
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      <div>
                        <strong>MLflow Tracking Server:</strong> {diagnostics.mlflow.status}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CheckCircle2 size={16} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
                      <div>
                        <strong>Global Run Bounds:</strong> {config.execution.run_timeout_seconds}s timeout / {config.execution.max_concurrent_runs} concurrent
                      </div>
                    </div>
                  </div>
                </div>

                <h4 style={{ margin: '20px 0 10px 0' }}>1. Platform Server Parameters</h4>
                {rows([
                  ['Deployment Mode (RCA_MODE)', health.mode],
                  ['Configuration Hash', config.configuration_hash],
                  ['Server Projects Root', diagnostics.storage.path],
                  ['Server CAS Layout', diagnostics.storage.cas_layout]
                ])}

                <h4 style={{ margin: '20px 0 10px 0' }}>2. Platform Authentication &amp; JWT Verification</h4>
                <p className="metric-meta" style={{ marginBottom: '12px' }}>
                  RS256 token verification requires server-side <code>RCA_AUTH_ISSUER</code>, <code>RCA_AUTH_AUDIENCE</code>, <code>RCA_AUTH_PUBLIC_KEY</code>, and <code>RCA_PRINCIPALS_JSON</code>.
                </p>
                <div style={{ background: 'var(--surface, #0c1425)', padding: '12px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', border: '1px solid var(--line, #22314d)', marginBottom: '16px' }}>
                  python -m scripts.issue_dev_token admin --expires-in 604800
                </div>

                <h4 style={{ margin: '20px 0 10px 0' }}>3. Platform Data &amp; Retention Rules</h4>
                {rows([
                  ['CAS Storage Path', diagnostics.storage.path],
                  ['Retention Period', `${config.execution.retention_days} days (cleanup via python -m scripts.cleanup)`],
                  ['Accepted Attachment Types', config.file_limits.allowed_extensions.join(', ')]
                ])}
              </div>
            )}

            {/* TAB 2: Connection Diagnostics */}
            {tab === 'Connection Diagnostics' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <ShieldCheck size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                      Live Platform Connection Probes &amp; Diagnostics
                    </h3>
                    <p className="page-subtitle" style={{ margin: 0 }}>
                      Execute active connection tests against Database, Process Memory, CAS Storage, MLflow server, and External Connectors.
                    </p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => void handleRunTest('all')}
                    disabled={testRunning['all']}
                  >
                    <Play size={15} /> {testRunning['all'] ? 'Probing all services…' : 'Run All Connection Tests'}
                  </button>
                </div>

                {/* Connection Test Cards Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  
                  {/* Database Test Card */}
                  <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <Database size={16} style={{ color: 'var(--primary, #3b82f6)' }} /> Database Engine Probe
                      </div>
                      <span className={`badge ${diagnostics.database.status === 'healthy' ? 'badge-active' : 'badge-neutral'}`}>
                        {diagnostics.database.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                      Dialect: <strong>{diagnostics.database.dialect}</strong> · Latency: <strong>{diagnostics.database.latency_ms} ms</strong>
                    </p>
                    {testResults['database'] && (
                      <div style={{ fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                        {testResults['database'].message} ({testResults['database'].latency_ms} ms)
                      </div>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => void handleRunTest('database')}
                      disabled={testRunning['database']}
                    >
                      <RefreshCw size={13} className={testRunning['database'] ? 'spin' : ''} />
                      {testRunning['database'] ? 'Testing Ping…' : 'Ping Database'}
                    </button>
                  </div>

                  {/* Memory Probe Card */}
                  <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <Cpu size={16} style={{ color: 'var(--primary, #3b82f6)' }} /> Memory &amp; Event Loop
                      </div>
                      <span className={`badge ${diagnostics.memory.status === 'healthy' ? 'badge-active' : 'badge-neutral'}`}>
                        {diagnostics.memory.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                      Process RSS: <strong>{diagnostics.memory.rss_mb} MB</strong> · Active Tasks: <strong>{diagnostics.memory.active_tasks}</strong>
                    </p>
                    {testResults['memory'] && (
                      <div style={{ fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                        {testResults['memory'].message}
                      </div>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => void handleRunTest('memory')}
                      disabled={testRunning['memory']}
                    >
                      <RefreshCw size={13} className={testRunning['memory'] ? 'spin' : ''} />
                      {testRunning['memory'] ? 'Sampling…' : 'Sample Memory Usage'}
                    </button>
                  </div>

                  {/* Storage & CAS Card */}
                  <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <HardDrive size={16} style={{ color: 'var(--primary, #3b82f6)' }} /> Storage CAS Write Probe
                      </div>
                      <span className={`badge ${diagnostics.storage.writable ? 'badge-active' : 'badge-neutral'}`}>
                        {diagnostics.storage.writable ? 'Writable' : 'Read-only'}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                      Disk Free: <strong>{diagnostics.storage.disk_free_gb} GB</strong> / {diagnostics.storage.disk_total_gb} GB
                    </p>
                    {testResults['storage'] && (
                      <div style={{ fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                        {testResults['storage'].message} ({testResults['storage'].latency_ms} ms)
                      </div>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => void handleRunTest('storage')}
                      disabled={testRunning['storage']}
                    >
                      <RefreshCw size={13} className={testRunning['storage'] ? 'spin' : ''} />
                      {testRunning['storage'] ? 'Testing Write…' : 'Test Write/Read Cycle'}
                    </button>
                  </div>

                  {/* MLflow Tracking Test Card */}
                  <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <Sparkles size={16} style={{ color: 'var(--primary, #3b82f6)' }} /> MLflow Tracking Store
                      </div>
                      <span className={`badge ${diagnostics.mlflow.status === 'configured' || diagnostics.mlflow.status === 'connected' ? 'badge-active' : 'badge-neutral'}`}>
                        {diagnostics.mlflow.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                      Store: <strong>{diagnostics.mlflow.experiment_store}</strong> · Contracts: <strong>{diagnostics.mlflow.offline_eval_contracts.length}</strong>
                    </p>
                    {testResults['mlflow'] && (
                      <div style={{ fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                        {testResults['mlflow'].message}
                      </div>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => void handleRunTest('mlflow')}
                      disabled={testRunning['mlflow']}
                    >
                      <RefreshCw size={13} className={testRunning['mlflow'] ? 'spin' : ''} />
                      {testRunning['mlflow'] ? 'Connecting…' : 'Test MLflow Connection'}
                    </button>
                  </div>

                  {/* Connectors Probe Card */}
                  <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <Zap size={16} style={{ color: 'var(--primary, #3b82f6)' }} /> Platform Connectors
                      </div>
                      <span className="badge badge-neutral">
                        {health.mode}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                      Live Probes: <strong>{Object.keys(diagnostics.connectors.results || {}).join(', ') || 'jira, splunk'}</strong>
                    </p>
                    {testResults['connectors'] && (
                      <div style={{ fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                        {testResults['connectors'].message}
                      </div>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => void handleRunTest('connectors')}
                      disabled={testRunning['connectors']}
                    >
                      <RefreshCw size={13} className={testRunning['connectors'] ? 'spin' : ''} />
                      {testRunning['connectors'] ? 'Probing…' : 'Test Connectors Health'}
                    </button>
                  </div>

                </div>

                <h4 style={{ margin: '20px 0 10px 0' }}>Observed Diagnostic Details</h4>
                {rows([
                  ['Database Ping Latency', `${diagnostics.database.latency_ms} ms`],
                  ['Database Dialect', diagnostics.database.dialect],
                  ['Peak Process RSS Memory', `${diagnostics.memory.rss_mb} MB`],
                  ['Active Asyncio Event Loop Tasks', diagnostics.memory.active_tasks],
                  ['Diagnostics Probe Timestamp', new Date(diagnostics.timestamp * 1000).toLocaleString()]
                ])}
              </div>
            )}

            {/* TAB 3: MLflow Platform Tracking */}
            {tab === 'MLflow Platform Tracking' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                      MLflow Platform Tracking &amp; GenAI Architecture
                    </h3>
                    <p className="page-subtitle" style={{ margin: 0 }}>
                      Platform-wide tracking store for prompt optimization, reflection replay, and offline evaluation fixtures.
                    </p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => void handleRunTest('mlflow')}
                    disabled={testRunning['mlflow']}
                  >
                    <RefreshCw size={15} className={testRunning['mlflow'] ? 'spin' : ''} />
                    {testRunning['mlflow'] ? 'Testing MLflow…' : 'Test MLflow Connection'}
                  </button>
                </div>

                <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <strong>MLflow Tracking Server Status</strong>
                    <span className={`badge ${diagnostics.mlflow.status === 'configured' || diagnostics.mlflow.status === 'connected' ? 'badge-active' : 'badge-neutral'}`}>
                      {diagnostics.mlflow.status}
                    </span>
                  </div>
                  {testResults['mlflow'] && (
                    <div style={{ fontSize: '13px', color: 'var(--green, #10b981)', marginBottom: '12px' }}>
                      ✓ {testResults['mlflow'].message} ({testResults['mlflow'].latency_ms} ms)
                    </div>
                  )}
                  {rows([
                    ['Tracking URI Status', diagnostics.mlflow.tracking_uri ? 'Configured on Platform Server' : 'Not Configured'],
                    ['Experiment Store', diagnostics.mlflow.experiment_store],
                    ['Tracking Credentials Security', 'Credentials remain server-side in deployment environment, never exposed over API'],
                    ['Optimization Artifact Root', 'blob_local/platform/artifacts/optimizations']
                  ])}
                </div>

                <h4 style={{ margin: '20px 0 10px 0' }}>Platform Offline Evaluation Contracts</h4>
                <div className="settings-tags" style={{ marginBottom: '20px' }}>
                  {diagnostics.mlflow.offline_eval_contracts.map(name => (
                    <span className="badge badge-neutral" key={name} style={{ padding: '6px 12px', fontSize: '13px' }}>
                      ✓ {name} Contract
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                  <a className="btn btn-secondary" href="#optimization">
                    <Layers size={15} /> Open Optimization Studio
                  </a>
                  <a className="btn btn-secondary" href="#runs">
                    <Activity size={15} /> Inspect Replay Runs
                  </a>
                </div>
              </div>
            )}

            {/* TAB 4: Database Persistence */}
            {tab === 'Database Persistence' && (
              <div>
                <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Database size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                  Database Engine &amp; Persistence Architecture
                </h3>
                <p className="page-subtitle" style={{ marginBottom: '20px' }}>
                  SQLAlchemy async persistence for platform runs, investigations, and agent artifacts.
                </p>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void handleRunTest('database')}
                    disabled={testRunning['database']}
                  >
                    <RefreshCw size={14} className={testRunning['database'] ? 'spin' : ''} />
                    {testRunning['database'] ? 'Probing…' : 'Ping Database'}
                  </button>
                </div>

                {testResults['database'] && (
                  <div style={{ fontSize: '13px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px', borderRadius: '6px', marginBottom: '16px' }}>
                    {testResults['database'].message}
                  </div>
                )}

                {rows([
                  ['Engine Status', diagnostics.database.status],
                  ['Dialect', diagnostics.database.dialect],
                  ['Last Measured Latency', `${diagnostics.database.latency_ms} ms`],
                  ['Session Database URL', 'Configured via RCA_SESSION_DATABASE_URL'],
                  ['Schema Migration Contract', 'Zero-downtime forward migrations via SQLAlchemy async'],
                  ['Retention Period', `${config.execution.retention_days} days`]
                ])}
              </div>
            )}

            {/* TAB 5: Storage & Blob CAS */}
            {tab === 'Storage & Blob CAS' && (
              <div>
                <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <HardDrive size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                  Storage &amp; Content-Addressable Storage (CAS)
                </h3>
                <p className="page-subtitle" style={{ marginBottom: '20px' }}>
                  Local bounded artifact extraction and SHA-256 deduplicated blob storage.
                </p>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void handleRunTest('storage')}
                    disabled={testRunning['storage']}
                  >
                    <RefreshCw size={14} className={testRunning['storage'] ? 'spin' : ''} />
                    {testRunning['storage'] ? 'Testing Write/Read…' : 'Run Storage Write/Read Probe'}
                  </button>
                </div>

                {testResults['storage'] && (
                  <div style={{ fontSize: '13px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px', borderRadius: '6px', marginBottom: '16px' }}>
                    {testResults['storage'].message}
                  </div>
                )}

                {rows([
                  ['Projects Root Path', diagnostics.storage.path],
                  ['Disk Free Space', `${diagnostics.storage.disk_free_gb} GB free of ${diagnostics.storage.disk_total_gb} GB`],
                  ['Writable Status', diagnostics.storage.writable ? 'Writable' : 'Read-only'],
                  ['Deduplication Layout', diagnostics.storage.cas_layout],
                  ['Retention Duration', `${config.execution.retention_days} days`]
                ])}

                <h4 style={{ margin: '20px 0 10px 0' }}>Accepted Attachment Extensions</h4>
                <div className="settings-tags">
                  {config.file_limits.allowed_extensions.map(ext => (
                    <span className="badge badge-neutral" key={ext}>{ext}</span>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 6: Platform vs Project Matrix */}
            {tab === 'Platform vs Project Matrix' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Layers size={19} style={{ color: 'var(--primary, #3b82f6)' }} />
                      Platform Settings vs. Project Settings Hierarchy
                    </h3>
                    <p className="page-subtitle" style={{ margin: 0 }}>
                      How configuration cascades from Platform Policy to Project Layers and User Preferences.
                    </p>
                  </div>
                  <a className="btn btn-primary" href="#project-setup">
                    <FolderGit2 size={15} /> Configure Project Settings
                  </a>
                </div>

                {/* Side-by-side Scope Architecture Table */}
                <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--line, #22314d)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px', color: 'var(--tx, #f8fafc)' }}>Setting Dimension</th>
                        <th style={{ padding: '10px 14px', color: 'var(--primary, #3b82f6)' }}>Platform Settings (Deployment Scope)</th>
                        <th style={{ padding: '10px 14px', color: 'var(--green, #10b981)' }}>Project Settings (Tenant &amp; Project Scope)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Governing Entity</td>
                        <td style={{ padding: '12px 14px' }}>Platform Administrators &amp; Operations</td>
                        <td style={{ padding: '12px 14px' }}>Project Owners &amp; Lead Investigators</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Source of Truth</td>
                        <td style={{ padding: '12px 14px' }}>
                          <code>.env</code>, <code>platform.yaml</code>, deployment secrets
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code>projects/&#123;tenant&#125;_&#123;project&#125;.yaml</code> (Project Layer)
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Database &amp; Persistence</td>
                        <td style={{ padding: '12px 14px' }}>
                          Shared PostgreSQL engine, connection pooling, SQLAlchemy async store
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          Rows isolated by <code>tenant_id</code> and <code>project_id</code>
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>MLflow Tracking</td>
                        <td style={{ padding: '12px 14px' }}>
                          Process-wide tracking URI &amp; experiment repository server
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          Project experiment runs &amp; prompt optimization replay holdouts
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Capabilities &amp; Skills</td>
                        <td style={{ padding: '12px 14px' }}>
                          Master catalog of registered capabilities, available models, platform rules
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          Project overrides, custom skill instructions, enabled/disabled capabilities
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Connectors</td>
                        <td style={{ padding: '12px 14px' }}>
                          Registered connectors (Jira, Splunk, Platform tools), credentials, host allowlist
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <code>disabled_connectors</code> (project can disable specific connectors)
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--line, #22314d)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Execution Limits</td>
                        <td style={{ padding: '12px 14px' }}>
                          Hard server ceilings (120s timeout, max 100 LLM calls, 256k chars context)
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          Project-specific limits (can further restrict, cannot exceed platform ceiling)
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>Prompts &amp; Preferences</td>
                        <td style={{ padding: '12px 14px' }}>
                          Baseline stage prompt templates, default presentation format
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          Custom stage prompts (incident_triage, etc.), presentation format, detail level
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Active Project Scope Summary Box */}
                <div style={{ background: 'var(--surface, #0c1425)', border: '1px solid var(--line, #22314d)', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                      <FolderGit2 size={16} style={{ color: 'var(--green, #10b981)' }} />
                      Active Project Scope: <code>{principal.tenant_id} / {principal.project_id}</code>
                    </div>
                    <a className="btn btn-secondary" href="#project-setup" style={{ fontSize: '12px', padding: '4px 10px' }}>
                      Edit in Project Settings
                    </a>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--muted, #cbd5e1)', margin: '0 0 12px 0' }}>
                    Configuration changes made to this project apply strictly within this tenant/project namespace and do not modify the server platform deployment.
                  </p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <a className="btn btn-secondary" href="#capabilities">View Project Capabilities</a>
                    <a className="btn btn-secondary" href="#skills">View Project Skills</a>
                    <a className="btn btn-secondary" href="#project-setup">Open Project Setup Console</a>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
