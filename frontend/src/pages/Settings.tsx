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
  FileCode,
  Save,
  RotateCcw,
  Trash2,
  FileCheck,
} from 'lucide-react';
import {
  fetchConfig,
  fetchSystemDiagnostics,
  testSystemConnection,
  fetchPlatformSettings,
  updatePlatformSettings,
  fetchFileProcessingConfig,
  updateFileProcessingConfig,
  triggerRetentionCleanup,
} from '../services/api';
import type {
  Principal,
  SystemDiagnostics,
  SystemHealth,
  ConnectionTestTargetResult,
  PlatformSettingsConfig,
  UiSettingsConfig,
  RuntimeConfig,
  PlatformConfigurationSnapshot,
  CleanupResult,
} from '../types/api';
import { ConfigurationEditor } from '../components/ConfigurationEditor';
import { ParameterSettingsPanel } from '../components/ParameterSettingsPanel';
import { WorkspacePresentationSettings } from '../components/WorkspacePresentationSettings';
import '../styles/settings.css';

interface SettingsProps {
  principal: Principal;
  health: SystemHealth;
  onUiSettingsChanged?: (settings: UiSettingsConfig) => void;
}

const tabs = [
  'Platform Execution & Boundaries',
  'File Processing & Formats',
  'Connection Diagnostics',
  'Storage & Retention Purge',
  'Deployment Export (.env)',
  'Platform vs Project Matrix',
  'Workspace Presentation',
] as const;

type TabName = (typeof tabs)[number];

export function Settings({ principal, health, onUiSettingsChanged }: SettingsProps) {
  const [tab, setTab] = useState<TabName>('Platform Execution & Boundaries');
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedEnv, setCopiedEnv] = useState(false);

  // Diagnostic probes
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestTargetResult>>({});

  // Execution settings form state
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsConfig | null>(null);
  const [executionForm, setExecutionForm] = useState({
    run_timeout_seconds: 120,
    max_concurrent_runs: 4,
    max_llm_calls: 12,
    max_input_chars: 16000,
    max_context_chars: 64000,
    retention_days: 90,
  });
  const [executionDirty, setExecutionDirty] = useState(false);
  const [savingExecution, setSavingExecution] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionSuccess, setExecutionSuccess] = useState<string | null>(null);

  // File processing settings form state (authoritative /platform/configuration/file-processing)
  const [fileConfig, setFileConfig] = useState<PlatformConfigurationSnapshot | null>(null);
  const [fileForm, setFileForm] = useState<{
    max_file_mb: number;
    max_files: number;
    max_text_chars: number;
    parser_timeout_seconds: number;
    concurrency: number;
    allowed_extensions: string[];
  }>({
    max_file_mb: 8,
    max_files: 20,
    max_text_chars: 40000,
    parser_timeout_seconds: 20,
    concurrency: 4,
    allowed_extensions: ['.txt', '.log', '.json', '.csv', '.pdf'],
  });
  const [extraFileValues, setExtraFileValues] = useState<Record<string, number>>({});
  const [fileDirty, setFileDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSuccess, setFileSuccess] = useState<string | null>(null);

  // Retention cleanup state
  const [cleaningRetention, setCleaningRetention] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextDiagnostics, nextConfig, nextSettings, nextFileConfig] = await Promise.all([
        fetchSystemDiagnostics(),
        fetchConfig(),
        fetchPlatformSettings(),
        fetchFileProcessingConfig(),
      ]);
      setDiagnostics(nextDiagnostics);
      setConfig(nextConfig);
      setPlatformSettings(nextSettings);
      setExecutionForm({
        run_timeout_seconds: nextSettings.run_timeout_seconds ?? 120,
        max_concurrent_runs: nextSettings.max_concurrent_runs ?? 4,
        max_llm_calls: nextSettings.max_llm_calls ?? 12,
        max_input_chars: nextSettings.max_input_chars ?? 16000,
        max_context_chars: nextSettings.max_context_chars ?? 64000,
        retention_days: nextSettings.retention_days ?? 90,
      });
      setExecutionDirty(false);

      setFileConfig(nextFileConfig);
      setExtraFileValues({});
      const fVals = nextFileConfig.values;
      setFileForm({
        max_file_mb: Math.round((fVals.max_file_bytes || 8388608) / (1024 * 1024)),
        max_files: fVals.max_files || 20,
        max_text_chars: fVals.max_text_chars || 40000,
        parser_timeout_seconds: fVals.parser_timeout_seconds || 20,
        concurrency: fVals.concurrency || 4,
        allowed_extensions: Array.isArray(fVals.allowed_extensions)
          ? [...fVals.allowed_extensions]
          : ['.txt', '.log', '.json', '.csv', '.pdf'],
      });
      setFileDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load platform settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [principal.subject]);

  // Handle execution settings save
  async function handleSaveExecution(e: React.FormEvent) {
    e.preventDefault();
    setSavingExecution(true);
    setExecutionError(null);
    setExecutionSuccess(null);
    try {
      const updated = await updatePlatformSettings({
        run_timeout_seconds: executionForm.run_timeout_seconds,
        max_concurrent_runs: executionForm.max_concurrent_runs,
        max_llm_calls: executionForm.max_llm_calls,
        max_input_chars: executionForm.max_input_chars,
        max_context_chars: executionForm.max_context_chars,
        retention_days: executionForm.retention_days,
        mode: health.mode,
      });
      setPlatformSettings(updated);
      setExecutionDirty(false);
      setExecutionSuccess('Platform execution settings saved and applied to active runtime.');
      setTimeout(() => setExecutionSuccess(null), 4000);
    } catch (cause) {
      // Preserve draft on failure and display inline error
      setExecutionError(
        cause instanceof Error
          ? cause.message
          : 'Failed to update platform settings. Check constraints and try again.'
      );
    } finally {
      setSavingExecution(false);
    }
  }

  function handleDiscardExecution() {
    if (!platformSettings) return;
    setExecutionForm({
      run_timeout_seconds: platformSettings.run_timeout_seconds ?? 120,
      max_concurrent_runs: platformSettings.max_concurrent_runs ?? 4,
      max_llm_calls: platformSettings.max_llm_calls ?? 12,
      max_input_chars: platformSettings.max_input_chars ?? 16000,
      max_context_chars: platformSettings.max_context_chars ?? 64000,
      retention_days: platformSettings.retention_days ?? 90,
    });
    setExecutionDirty(false);
    setExecutionError(null);
  }

  // Handle file processing settings save
  async function handleSaveFileConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!fileConfig) return;
    setSavingFile(true);
    setFileError(null);
    setFileSuccess(null);
    try {
      const payloadValues = {
        ...fileConfig.values,
        ...extraFileValues,
        max_file_bytes: fileForm.max_file_mb * 1024 * 1024,
        max_files: fileForm.max_files,
        max_text_chars: fileForm.max_text_chars,
        parser_timeout_seconds: fileForm.parser_timeout_seconds,
        concurrency: fileForm.concurrency,
        allowed_extensions: fileForm.allowed_extensions,
      };
      const updated = await updateFileProcessingConfig({
        values: payloadValues,
        expected_hash: fileConfig.content_hash,
      });
      setFileConfig(updated);
      setExtraFileValues({});
      setFileDirty(false);
      setFileSuccess('File processing configuration saved. Applied immediately to subsequent uploads.');
      setTimeout(() => setFileSuccess(null), 4000);
    } catch (cause) {
      setFileError(
        cause instanceof Error
          ? cause.message
          : 'Failed to update file processing configuration.'
      );
    } finally {
      setSavingFile(false);
    }
  }

  function handleDiscardFileConfig() {
    if (!fileConfig) return;
    setExtraFileValues({});
    const fVals = fileConfig.values;
    setFileForm({
      max_file_mb: Math.round((fVals.max_file_bytes || 8388608) / (1024 * 1024)),
      max_files: fVals.max_files || 20,
      max_text_chars: fVals.max_text_chars || 40000,
      parser_timeout_seconds: fVals.parser_timeout_seconds || 20,
      concurrency: fVals.concurrency || 4,
      allowed_extensions: Array.isArray(fVals.allowed_extensions)
        ? [...fVals.allowed_extensions]
        : ['.txt', '.log', '.json', '.csv', '.pdf'],
    });
    setFileDirty(false);
    setFileError(null);
  }

  function toggleExtension(ext: string) {
    setFileForm(prev => {
      const exists = prev.allowed_extensions.includes(ext);
      const nextExts = exists
        ? prev.allowed_extensions.filter(e => e !== ext)
        : [...prev.allowed_extensions, ext];
      // Keep at least 1 extension
      if (nextExts.length === 0) return prev;
      return { ...prev, allowed_extensions: nextExts.sort() };
    });
    setFileDirty(true);
    setFileSuccess(null);
  }

  // Handle connection diagnostics probe
  async function handleRunTest(
    target: 'all' | 'database' | 'memory' | 'storage' | 'mlflow' | 'connectors'
  ) {
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
      const msg = err instanceof Error ? err.message : 'Diagnostic test probe failed';
      setError(msg);
      setTestResults(prev => ({
        ...prev,
        [target]: {
          target: target === 'all' ? 'database' : target,
          status: 'error',
          latency_ms: 0,
          message: msg,
        },
      }));
    } finally {
      setTestRunning(prev => ({ ...prev, [target]: false }));
    }
  }

  // Handle retention cleanup
  async function handleRetentionCleanup() {
    if (!window.confirm('Execute retention purge now? This permanently deletes expired records, attachments, and raw CAS artifacts beyond the configured retention period.')) {
      return;
    }
    setCleaningRetention(true);
    setCleanupError(null);
    setCleanupResult(null);
    try {
      const result = await triggerRetentionCleanup();
      setCleanupResult(result);
      void refresh();
    } catch (cause) {
      setCleanupError(
        cause instanceof Error ? cause.message : 'Retention cleanup execution failed.'
      );
    } finally {
      setCleaningRetention(false);
    }
  }

  // Generate Truthful Deployment Configuration Export (Partial, Nonsecret)
  function generateDeploymentExport(): string {
    const extList = fileForm.allowed_extensions.join(',');
    return `# ==============================================================================
# RCA Analyzer - Platform Deployment Configuration Export
# Generated from live server runtime at ${new Date().toISOString()}
# Scope: ${principal.tenant_id} / ${principal.project_id}
# ==============================================================================

# 1. Platform Execution Mode (Deployment-owned)
RCA_MODE=${health.mode}
RCA_TENANT_ID=${principal.tenant_id || 'engineering'}
RCA_PROJECT_ID=${principal.project_id || 'core-services'}

# 2. Global Platform Execution Bounds
RCA_RUN_TIMEOUT_SECONDS=${executionForm.run_timeout_seconds}
RCA_MAX_CONCURRENT_RUNS=${executionForm.max_concurrent_runs}
RCA_MAX_LLM_CALLS=${executionForm.max_llm_calls}
RCA_MAX_INPUT_CHARS=${executionForm.max_input_chars}
RCA_MAX_CONTEXT_CHARS=${executionForm.max_context_chars}
RCA_RETENTION_DAYS=${executionForm.retention_days}

# 3. File Processing & Attachment Limits
RCA_MAX_FILE_BYTES=${fileForm.max_file_mb * 1024 * 1024}
RCA_MAX_FILES=${fileForm.max_files}
RCA_ALLOWED_EXTENSIONS=${extList}

# 4. Deployment-Owned Infrastructure (Credentials remain server-side)
# Database persistence: ${diagnostics?.database.dialect || 'postgresql'}
# RCA_DATABASE_URL=<configured-in-server-environment>
# RCA_SESSION_DATABASE_URL=<configured-in-server-environment>

# Storage & CAS Root:
# RCA_CONTENT_ROOT=${diagnostics?.storage.path || './blob_local/platform'}
# CAS Layout: ${diagnostics?.storage.cas_layout || 'sha256'}

# RS256 Authentication Setup:
# Subject: ${principal.subject || 'admin'}
# Roles: ${principal.roles.join(', ')}
# RSA public keys and token signatures are verified server-side.
`;
  }

  function handleCopyEnv() {
    const exportText = generateDeploymentExport();
    navigator.clipboard
      .writeText(exportText)
      .then(() => {
        setCopiedEnv(true);
        setTimeout(() => setCopiedEnv(false), 2500);
      })
      .catch(() => setError('Unable to copy to clipboard. Check clipboard permissions.'));
  }

  const rows = (values: Array<[string, string | number]>) => (
    <dl className="settings-dl">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="view-container settings-page">
      {/* Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Platform <span>Settings</span> &amp; Infrastructure
          </h1>
          <p className="hero-lede">
            Server-wide execution bounds, attachment processing constraints, persistent storage, and hardware diagnostics.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <b>Mode:</b> {health.mode.toUpperCase()}
            </span>
            <span className="hero-stat-chip">
              <b>Database:</b> {diagnostics?.database?.status || 'Unknown'}
            </span>
            <span className="hero-stat-chip">
              <b>Role:</b> {principal.roles.join(', ') || 'Unknown'}
            </span>
          </div>
        </div>
        <div className="hero-actions">
          <div className="hero-actions-row">
            <a
              className="btn btn-secondary"
              href="#project-setup"
              title="Configure project-specific overrides and prompt templates"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <FolderGit2 size={15} /> Project Setup →
            </a>
            <button
              className="btn btn-secondary"
              onClick={() => void handleRunTest('all')}
              disabled={loading || testRunning['all']}
              title="Run diagnostics on Database, Memory, Storage, MLflow, and Connectors"
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
        </div>
      </section>

      {/* Scope Clarification Alert */}
      <div
        style={{
          background: 'var(--card-subtle)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldAlert size={20} style={{ color: 'var(--acc)', flexShrink: 0 }} />
          <div style={{ fontSize: '13px' }}>
            <strong style={{ color: 'var(--tx)' }}>Platform Settings vs. Project Settings Architecture</strong>
            <div style={{ color: 'var(--muted)', marginTop: '3px' }}>
              <strong>Platform Settings</strong> (this view) manage process-wide deployment limits, storage CAS, MLflow, and file constraints.
              <strong> Project Settings</strong> (scoped to <code>{principal.tenant_id || 'tenant'} / {principal.project_id || 'project'}</code>) configure capability delegations, stage prompts, and connector disabling.
            </div>
          </div>
        </div>
        <a
          className="btn btn-secondary"
          href="#project-setup"
          style={{ fontSize: '12px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          Open Project Setup <ArrowRight size={13} />
        </a>
      </div>

      {error && (
        <div className="settings-alert settings-alert-error" role="alert">
          <AlertTriangle size={16} /> <span>{error}</span>
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
              <span style={{ color: 'var(--acc3)' }}>Healthy</span>
            ) : diagnostics ? (
              <span style={{ color: 'var(--acc-amber)' }}>{diagnostics.database.status}</span>
            ) : (
              '—'
            )}
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
              <span style={{ color: 'var(--acc3)' }}>Configured</span>
            ) : (
              <span style={{ color: 'var(--dim)' }}>Unconfigured</span>
            )}
          </div>
          <p className="metric-meta">
            {diagnostics ? `${diagnostics.mlflow.offline_eval_contracts.length} eval contracts active` : 'Waiting for diagnostics'}
          </p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" style={{ flexWrap: 'wrap', gap: '8px' }}>
        {tabs.map(name => (
          <button
            type="button"
            key={name}
            id={`settings-tab-${name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
            data-tab={name}
            role="tab"
            aria-selected={tab === name}
            className={`btn ${tab === name ? 'btn-primary' : 'btn-secondary'}`}
            onClick={e => {
              e.preventDefault();
              setTab(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* TAB 1: Platform Execution & Boundaries */}
      {tab === 'Platform Execution & Boundaries' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <SettingsIcon size={19} /> Platform Execution &amp; Concurrency Bounds
              </h3>
              <p className="settings-subtitle">
                Server ceilings for investigation timeouts, LLM call limits, token/character constraints, and retention windows.
              </p>
            </div>
          </div>

          {executionSuccess && (
            <div className="settings-alert settings-alert-success" role="status">
              <CheckCircle2 size={16} /> <span>{executionSuccess}</span>
            </div>
          )}

          {executionError && (
            <div className="settings-alert settings-alert-error" role="alert">
              <AlertTriangle size={16} /> <span>{executionError}</span>
            </div>
          )}

          {/* Readiness Checklist */}
          <div className="settings-readiness-container">
            <h4 className="settings-readiness-title">Platform Runtime Readiness</h4>
            <div className="settings-readiness-grid">
              <div className="settings-readiness-item">
                <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                <span><strong>Configured deployment:</strong> {principal.tenant_id} / {principal.project_id}</span>
              </div>
              <div className="settings-readiness-item">
                <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                <span><strong>RS256 Server Auth:</strong> {principal.subject ? `Subject: ${principal.subject}` : 'Demo token'}</span>
              </div>
              <div className="settings-readiness-item">
                {diagnostics?.database.status === 'healthy' ? (
                  <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: 'var(--acc-amber)', flexShrink: 0 }} />
                )}
                <span><strong>Database Engine:</strong> {diagnostics?.database.dialect || 'unknown'} ({diagnostics?.database.status || 'probe pending'})</span>
              </div>
              <div className="settings-readiness-item">
                {diagnostics?.storage.writable ? (
                  <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: 'var(--acc-amber)', flexShrink: 0 }} />
                )}
                <span><strong>Storage CAS:</strong> {diagnostics?.storage.writable ? 'Writable' : 'Read-only'} ({diagnostics?.storage.disk_free_gb || 0} GB free)</span>
              </div>
              <div className="settings-readiness-item">
                <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                <span><strong>MLflow Server:</strong> {diagnostics?.mlflow.status || 'configured'}</span>
              </div>
              <div className="settings-readiness-item">
                <CheckCircle2 size={16} style={{ color: 'var(--acc3)', flexShrink: 0 }} />
                <span><strong>Execution Mode:</strong> {health.mode.toUpperCase()} (deployment-owned)</span>
              </div>
            </div>
          </div>

          {/* Inline Execution Form */}
          <form onSubmit={handleSaveExecution}>
            <div className="settings-form-grid">
              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-run-timeout">
                  <span>Run Timeout</span>
                  <span className="settings-field-badge">Seconds</span>
                </label>
                <input
                  id="exec-run-timeout"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="900"
                  value={executionForm.run_timeout_seconds}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, run_timeout_seconds: Number(e.target.value) }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Maximum lifetime before an investigation times out (1s – 900s).</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-max-concurrency">
                  <span>Max Concurrent Runs</span>
                  <span className="settings-field-badge">Runs</span>
                </label>
                <input
                  id="exec-max-concurrency"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="64"
                  value={executionForm.max_concurrent_runs}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, max_concurrent_runs: parseInt(e.target.value, 10) || 1 }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Concurrency ceiling. Can only change when investigations are idle.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-max-llm-calls">
                  <span>Max LLM Calls / Run</span>
                  <span className="settings-field-badge">Calls</span>
                </label>
                <input
                  id="exec-max-llm-calls"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="100"
                  value={executionForm.max_llm_calls}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, max_llm_calls: parseInt(e.target.value, 10) || 1 }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Hard ceiling on LLM queries dispatched per investigation run.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-retention-days">
                  <span>Data Retention Window</span>
                  <span className="settings-field-badge">Days</span>
                </label>
                <input
                  id="exec-retention-days"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="2555"
                  value={executionForm.retention_days}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, retention_days: parseInt(e.target.value, 10) || 1 }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Days before runs and attachments are eligible for retention cleanup.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-max-input-chars">
                  <span>Max Input Characters</span>
                  <span className="settings-field-badge">Chars</span>
                </label>
                <input
                  id="exec-max-input-chars"
                  className="settings-input"
                  type="number"
                  step="1000"
                  min="1000"
                  max="16000"
                  value={executionForm.max_input_chars}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, max_input_chars: parseInt(e.target.value, 10) || 1000 }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Maximum character budget accepted in incident problem inputs.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="exec-max-context-chars">
                  <span>Max Context Characters</span>
                  <span className="settings-field-badge">Chars</span>
                </label>
                <input
                  id="exec-max-context-chars"
                  className="settings-input"
                  type="number"
                  step="1000"
                  min="1000"
                  max="256000"
                  value={executionForm.max_context_chars}
                  onChange={e => {
                    setExecutionForm(s => ({ ...s, max_context_chars: parseInt(e.target.value, 10) || 1000 }));
                    setExecutionDirty(true);
                  }}
                />
                <p className="settings-field-hint">Cumulative context budget fed into stage synthesis and joins.</p>
              </div>
            </div>

            <div className="settings-actions-bar">
              <div className="settings-actions-left">
                <span className="settings-field-hint">
                  {executionDirty ? '● Unsaved changes in execution bounds' : '✓ Execution limits in sync with runtime'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!platformSettings || !principal.roles.includes('PLATFORM_ADMIN') || !executionDirty || savingExecution}
                onClick={handleDiscardExecution}
              >
                <RotateCcw size={14} /> Discard Changes
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!platformSettings || !principal.roles.includes('PLATFORM_ADMIN') || !executionDirty || savingExecution}
              >
                <Save size={14} /> {savingExecution ? 'Saving…' : 'Save Execution Settings'}
              </button>
            </div>
          </form>
          {principal.roles.includes('PLATFORM_ADMIN') && <details style={{ marginTop: 20 }}><summary>Additional runtime parameters and scope</summary><p className="settings-subtitle">Manage remaining execution settings. Choose each parameter's scope in <a href="#parameters">Parameters</a>.</p><ParameterSettingsPanel principal={principal} scope="platform" tool="runtime" excludeNames={['run_timeout_seconds', 'max_concurrent_runs', 'max_llm_calls', 'max_input_chars', 'max_context_chars', 'retention_days']} /></details>}
          {principal.roles.includes('PLATFORM_ADMIN') && <details style={{ marginTop: 20 }}><summary>Optimization configuration</summary><ConfigurationEditor endpoint="/api/v1/platform/configuration/optimization" /></details>}
        </section>
      )}

      {/* TAB 2: File Processing & Formats */}
      {tab === 'File Processing & Formats' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <FileCheck size={19} /> File Processing &amp; Attachment Format Controls
              </h3>
              <p className="settings-subtitle">
                Authoritative backend controls for attachment file size limits, extraction timeouts, and enabled formats. Changes apply immediately to subsequent uploads.
              </p>
            </div>
          </div>

          {fileSuccess && (
            <div className="settings-alert settings-alert-success" role="status">
              <CheckCircle2 size={16} /> <span>{fileSuccess}</span>
            </div>
          )}

          {fileError && (
            <div className="settings-alert settings-alert-error" role="alert">
              <AlertTriangle size={16} /> <span>{fileError}</span>
            </div>
          )}

          <form onSubmit={handleSaveFileConfig}>
            <div className="settings-form-grid">
              <div className="settings-field">
                <label className="settings-field-label" htmlFor="file-max-mb">
                  <span>Max File Upload Size</span>
                  <span className="settings-field-badge">MB</span>
                </label>
                <input
                  id="file-max-mb"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="64"
                  value={fileForm.max_file_mb}
                  onChange={e => {
                    setFileForm(f => ({ ...f, max_file_mb: parseInt(e.target.value, 10) || 1 }));
                    setFileDirty(true);
                  }}
                />
                <p className="settings-field-hint">Maximum size per individual uploaded incident artifact (1 – 64 MB).</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="file-max-files">
                  <span>Max Files per Batch</span>
                  <span className="settings-field-badge">Files</span>
                </label>
                <input
                  id="file-max-files"
                  className="settings-input"
                  type="number"
                  min="1"
                  max="50"
                  value={fileForm.max_files}
                  onChange={e => {
                    setFileForm(f => ({ ...f, max_files: parseInt(e.target.value, 10) || 1 }));
                    setFileDirty(true);
                  }}
                />
                <p className="settings-field-hint">Batch upload ceiling per incident investigation.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="file-parser-timeout">
                  <span>Parser Timeout</span>
                  <span className="settings-field-badge">Seconds</span>
                </label>
                <input
                  id="file-parser-timeout"
                  className="settings-input"
                  type="number"
                  min="5"
                  max="60"
                  value={fileForm.parser_timeout_seconds}
                  onChange={e => {
                    setFileForm(f => ({ ...f, parser_timeout_seconds: parseInt(e.target.value, 10) || 5 }));
                    setFileDirty(true);
                  }}
                />
                <p className="settings-field-hint">Bounded execution timeout for text/OCR parsing subprocesses.</p>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="file-max-chars">
                  <span>Max Extracted Characters</span>
                  <span className="settings-field-badge">Chars</span>
                </label>
                <input
                  id="file-max-chars"
                  className="settings-input"
                  type="number"
                  step="5000"
                  min="5000"
                  max="200000"
                  value={fileForm.max_text_chars}
                  onChange={e => {
                    setFileForm(f => ({ ...f, max_text_chars: parseInt(e.target.value, 10) || 5000 }));
                    setFileDirty(true);
                  }}
                />
                <p className="settings-field-hint">Maximum text characters extracted per document before truncation.</p>
              </div>
            </div>

            {/* Allowed Extensions Selector */}
            <div className="settings-ext-selector" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="settings-field-label">
                  <span>Accepted Attachment Formats (Implemented Parsers Only)</span>
                </label>
                <span className="settings-field-hint">
                  {fileForm.allowed_extensions.length} active formats
                </span>
              </div>
              <p className="settings-field-hint" style={{ margin: '4px 0 10px' }}>
                Toggle formats accepted for extraction. Only formats with implemented, tested local parsers may be enabled.
              </p>
              <div className="settings-ext-grid">
                {((fileConfig?.fields.allowed_extensions as { options?: string[] } | undefined)?.options || []).map(ext => {
                  const isActive = fileForm.allowed_extensions.includes(ext);
                  return (
                    <button
                      type="button"
                      key={ext}
                      className={`settings-ext-chip ${isActive ? 'active' : ''}`}
                      onClick={() => toggleExtension(ext)}
                      title={isActive ? `Click to disable ${ext}` : `Click to enable ${ext}`}
                      aria-pressed={isActive}
                    >
                      {isActive ? '✓ ' : '+ '} {ext}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-form-grid">
              {['max_expanded_bytes', 'max_zip_members', 'max_pdf_pages', 'max_rows', 'max_cells', 'max_image_pixels'].map(name => <div className="settings-field" key={name}><label className="settings-field-label" htmlFor={`file-${name}`}>{name.replaceAll('_', ' ')}</label><input className="settings-input" id={`file-${name}`} type="number" min={1} step={1} required value={extraFileValues[name] ?? Number(fileConfig?.values[name] ?? '')} onChange={event => { setExtraFileValues(current => ({ ...current, [name]: Number(event.target.value) })); setFileDirty(true); }} /></div>)}
            </div>
            <div className="settings-actions-bar">
              <div className="settings-actions-left">
                <span className="settings-field-hint">
                  {fileDirty ? '● Unsaved changes in file processing' : '✓ File limits in sync with platform configuration'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!fileConfig || !principal.roles.includes('PLATFORM_ADMIN') || !fileDirty || savingFile}
                onClick={handleDiscardFileConfig}
              >
                <RotateCcw size={14} /> Discard Changes
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!fileConfig || !principal.roles.includes('PLATFORM_ADMIN') || !fileDirty || savingFile}
              >
                <Save size={14} /> {savingFile ? 'Saving…' : 'Save File Controls'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TAB 3: Connection Diagnostics */}
      {tab === 'Connection Diagnostics' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <ShieldCheck size={19} /> Live Connection Probes &amp; Diagnostics
              </h3>
              <p className="settings-subtitle">
                Active connection probes against Database Engine, Process Memory, CAS Storage, MLflow Server, and External Connectors.
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

          <div className="settings-probe-grid">
            {/* Database Card */}
            <div className="settings-probe-card">
              <div className="settings-probe-header">
                <div className="settings-probe-title">
                  <Database size={16} /> Database Engine Probe
                </div>
                <span className={`settings-badge ${diagnostics?.database.status === 'healthy' ? 'settings-badge-healthy' : 'settings-badge-warning'}`}>
                  {diagnostics?.database.status || 'unknown'}
                </span>
              </div>
              <p className="settings-probe-detail">
                Dialect: <strong>{diagnostics?.database.dialect || 'unknown'}</strong> · Latency: <strong>{diagnostics?.database.latency_ms ?? '—'} ms</strong>
              </p>
              {testResults['database'] && (
                <div className={`settings-probe-output ${testResults['database'].status === 'error' ? 'error' : ''}`}>
                  {testResults['database'].message} ({testResults['database'].latency_ms} ms)
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('database')}
                disabled={testRunning['database']}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <RefreshCw size={13} className={testRunning['database'] ? 'spin' : ''} />
                {testRunning['database'] ? 'Testing Ping…' : 'Ping Database'}
              </button>
            </div>

            {/* Memory Card */}
            <div className="settings-probe-card">
              <div className="settings-probe-header">
                <div className="settings-probe-title">
                  <Cpu size={16} /> Memory &amp; Event Loop
                </div>
                <span className={`settings-badge ${diagnostics?.memory.status === 'healthy' ? 'settings-badge-healthy' : 'settings-badge-warning'}`}>
                  {diagnostics?.memory.status || 'healthy'}
                </span>
              </div>
              <p className="settings-probe-detail">
                Process RSS: <strong>{diagnostics?.memory.rss_mb ?? '—'} MB</strong> · Active Async Tasks: <strong>{diagnostics?.memory.active_tasks ?? '—'}</strong>
              </p>
              {testResults['memory'] && (
                <div className={`settings-probe-output ${testResults['memory'].status === 'error' ? 'error' : ''}`}>
                  {testResults['memory'].message}
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('memory')}
                disabled={testRunning['memory']}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <RefreshCw size={13} className={testRunning['memory'] ? 'spin' : ''} />
                {testRunning['memory'] ? 'Sampling…' : 'Sample Memory Usage'}
              </button>
            </div>

            {/* Storage Card */}
            <div className="settings-probe-card">
              <div className="settings-probe-header">
                <div className="settings-probe-title">
                  <HardDrive size={16} /> Storage CAS Write Probe
                </div>
                <span className={`settings-badge ${diagnostics?.storage.writable ? 'settings-badge-healthy' : 'settings-badge-warning'}`}>
                  {diagnostics?.storage.writable ? 'Writable' : 'Read-only'}
                </span>
              </div>
              <p className="settings-probe-detail">
                Disk Free: <strong>{diagnostics?.storage.disk_free_gb ?? '—'} GB</strong> / {diagnostics?.storage.disk_total_gb ?? '—'} GB
              </p>
              {testResults['storage'] && (
                <div className={`settings-probe-output ${testResults['storage'].status === 'error' ? 'error' : ''}`}>
                  {testResults['storage'].message} ({testResults['storage'].latency_ms} ms)
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('storage')}
                disabled={testRunning['storage']}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <RefreshCw size={13} className={testRunning['storage'] ? 'spin' : ''} />
                {testRunning['storage'] ? 'Testing Write…' : 'Test Write/Read Cycle'}
              </button>
            </div>

            {/* MLflow Card */}
            <div className="settings-probe-card">
              <div className="settings-probe-header">
                <div className="settings-probe-title">
                  <Sparkles size={16} /> MLflow Tracking Store
                </div>
                <span className={`settings-badge ${diagnostics?.mlflow.status === 'configured' || diagnostics?.mlflow.status === 'connected' ? 'settings-badge-healthy' : 'settings-badge-neutral'}`}>
                  {diagnostics?.mlflow.status || 'unconfigured'}
                </span>
              </div>
              <p className="settings-probe-detail">
                Store: <strong>{diagnostics?.mlflow.experiment_store || 'local sqlite'}</strong> · Contracts: <strong>{diagnostics?.mlflow.offline_eval_contracts.length || 0}</strong>
              </p>
              {testResults['mlflow'] && (
                <div className={`settings-probe-output ${testResults['mlflow'].status === 'error' ? 'error' : ''}`}>
                  {testResults['mlflow'].message}
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('mlflow')}
                disabled={testRunning['mlflow']}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <RefreshCw size={13} className={testRunning['mlflow'] ? 'spin' : ''} />
                {testRunning['mlflow'] ? 'Connecting…' : 'Test MLflow Connection'}
              </button>
            </div>

            {/* Connectors Card */}
            <div className="settings-probe-card">
              <div className="settings-probe-header">
                <div className="settings-probe-title">
                  <Zap size={16} /> External Connectors
                </div>
                <span className="settings-badge settings-badge-neutral">
                  {health.mode}
                </span>
              </div>
              <p className="settings-probe-detail">
                Configured: <strong>{Object.keys(diagnostics?.connectors.results || {}).join(', ') || 'jira, splunk'}</strong>
              </p>
              {testResults['connectors'] && (
                <div className={`settings-probe-output ${testResults['connectors'].status === 'error' ? 'error' : ''}`}>
                  {testResults['connectors'].message}
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('connectors')}
                disabled={testRunning['connectors']}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <RefreshCw size={13} className={testRunning['connectors'] ? 'spin' : ''} />
                {testRunning['connectors'] ? 'Probing…' : 'Test Connectors Health'}
              </button>
            </div>
          </div>

          <h4 style={{ margin: '24px 0 12px 0', fontSize: '14px', color: 'var(--tx)' }}>Observed Diagnostic Details</h4>
          {diagnostics &&
            rows([
              ['Database Ping Latency', `${diagnostics.database.latency_ms} ms`],
              ['Database Dialect', diagnostics.database.dialect],
              ['Peak Process RSS Memory', `${diagnostics.memory.rss_mb} MB`],
              ['Active Asyncio Event Loop Tasks', diagnostics.memory.active_tasks],
              ['Diagnostics Probe Timestamp', new Date(diagnostics.timestamp * 1000).toLocaleString()],
            ])}
        </section>
      )}

      {/* TAB 4: Storage & Retention Purge */}
      {tab === 'Storage & Retention Purge' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <HardDrive size={19} /> Storage CAS &amp; Retention Purge
              </h3>
              <p className="settings-subtitle">
                Content-Addressable Storage (CAS) inspection and on-demand retention cleanup executing confirmed deletion of expired runs, attachments, and CAS blobs.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void handleRetentionCleanup()}
              disabled={cleaningRetention}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Trash2 size={15} />
              {cleaningRetention ? 'Executing purge…' : 'Run Retention Cleanup Now'}
            </button>
          </div>

          {cleanupSuccessOrResult()}

          {cleanupError && (
            <div className="settings-alert settings-alert-error" role="alert">
              <AlertTriangle size={16} /> <span>{cleanupError}</span>
            </div>
          )}

          <div className="settings-card-subtle">
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13.5px', color: 'var(--tx)' }}>CAS Storage Architecture</h4>
            {diagnostics &&
              rows([
                ['Storage Root Path', diagnostics.storage.path],
                ['Disk Capacity Free', `${diagnostics.storage.disk_free_gb} GB free of ${diagnostics.storage.disk_total_gb} GB`],
                ['CAS Layout Algorithm', diagnostics.storage.cas_layout],
                ['Writable Status', diagnostics.storage.writable ? 'Writable' : 'Read-only'],
                ['Active Retention Window', `${executionForm.retention_days} days (from Platform Execution Bounds)`],
              ])}
          </div>

          <div style={{ marginTop: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13.5px', color: 'var(--tx)' }}>Retention Deletion Policy</h4>
            <p className="settings-subtitle" style={{ marginBottom: '14px' }}>
              Retention purges only terminal runs (completed, failed, cancelled) and expired attachments older than <code>{executionForm.retention_days} days</code>. Active runs are strictly protected.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => void handleRunTest('storage')}
                disabled={testRunning['storage']}
              >
                <RefreshCw size={13} className={testRunning['storage'] ? 'spin' : ''} />
                {testRunning['storage'] ? 'Testing Write…' : 'Run Storage Write/Read Probe'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* TAB 5: Deployment Export (.env) */}
      {tab === 'Deployment Export (.env)' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <Server size={19} /> Deployment Configuration Export (.env)
              </h3>
              <p className="settings-subtitle">
                Non-secret configuration export generated directly from live server runtime parameters. Server-owned infrastructure secrets remain securely managed deployment-side.
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleCopyEnv}
              title="Copy deployment configuration to clipboard"
            >
              {copiedEnv ? <Check size={15} style={{ color: 'var(--acc3)' }} /> : <Copy size={15} />}
              {copiedEnv ? 'Copied Configuration!' : 'Copy Platform .env Export'}
            </button>
          </div>

          {principal.roles.includes('PLATFORM_ADMIN') && <ConfigurationEditor endpoint="/api/v1/deployment/settings" deployment />}
          <details style={{ marginTop: 20 }}><summary>Current non-secret configuration export</summary><div className="settings-code-block">{generateDeploymentExport()}</div></details>
        </section>
      )}

      {/* TAB 6: Platform vs Project Matrix */}
      {tab === 'Platform vs Project Matrix' && (
        <section className="settings-card">
          <div className="settings-header-row">
            <div>
              <h3 className="settings-title">
                <Layers size={19} /> Platform Settings vs. Project Settings Hierarchy
              </h3>
              <p className="settings-subtitle">
                How configuration cascades from Platform Policy to Project Overrides and User Preferences.
              </p>
            </div>
            <a className="btn btn-primary" href="#project-setup">
              <FolderGit2 size={15} /> Configure Project Setup
            </a>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', color: 'var(--tx)' }}>Setting Dimension</th>
                  <th style={{ padding: '10px 14px', color: 'var(--acc)' }}>Platform Settings (Deployment Scope)</th>
                  <th style={{ padding: '10px 14px', color: 'var(--acc3)' }}>Project Settings (Tenant &amp; Project Scope)</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>Governing Entity</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Platform Administrators &amp; SRE Leads</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Project Owners &amp; Lead Investigators</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>Source of Truth</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}><code>.env</code>, <code>platform.yaml</code>, deployment secrets</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}><code>projects/{'{tenant}'}_{'{project}'}.yaml</code></td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>Execution Limits</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Hard ceilings (120s timeout, max 100 LLM calls, 256k context)</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Project limits (can only narrow, cannot exceed platform ceiling)</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>File Attachments</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Allowed formats (.txt, .log, .pdf, etc.), max upload bytes</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Inherits platform file limits</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>Connectors</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Registered connectors (Jira, Splunk), host allowlists, credentials</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}><code>disabled_connectors</code> (can disable specific connectors)</td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--tx)' }}>Prompts &amp; Preferences</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Baseline stage prompt templates, default presentation format</td>
                  <td style={{ padding: '12px 14px', color: 'var(--muted)' }}>Custom stage prompts, presentation format, detail level</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="settings-card-subtle">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ color: 'var(--tx)', fontSize: '13.5px' }}>
                Configured deployment: <code>{principal.tenant_id} / {principal.project_id}</code>
              </strong>
              <a className="btn btn-secondary" href="#project-setup" style={{ fontSize: '12px', padding: '4px 10px' }}>
                Open Project Setup
              </a>
            </div>
            <p className="settings-subtitle">
              Configuration changes made in Project Settings apply strictly within this tenant/project namespace without modifying deployment-wide platform defaults.
            </p>
          </div>
        </section>
      )}

      {/* TAB 7: Workspace Presentation */}
      {tab === 'Workspace Presentation' && (
        <WorkspacePresentationSettings onUiSettingsChanged={onUiSettingsChanged} />
      )}
    </div>
  );

  function cleanupSuccessOrResult() {
    if (!cleanupResult) return null;
    return (
      <div className="settings-alert settings-alert-success" role="status">
        <CheckCircle2 size={16} />
        <div>
          <strong>Retention Cleanup Succeeded:</strong>
          <div style={{ marginTop: '4px' }}>
            Purged <strong>{cleanupResult.purged_runs}</strong> runs,{' '}
            <strong>{cleanupResult.purged_attachments}</strong> attachments, and{' '}
            <strong>{cleanupResult.purged_artifacts ?? 0}</strong> raw artifacts. Physical storage freed:{' '}
            <strong>{cleanupResult.freed_bytes == null ? 'Not measured' : formatBytes(cleanupResult.freed_bytes)}</strong>.
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '4px' }}>
            Cutoff timestamp: {cleanupResult.retention_cutoff_utc} · Executed at: {cleanupResult.timestamp}
          </div>
        </div>
      </div>
    );
  }

  function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }
}
