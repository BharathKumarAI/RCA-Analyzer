import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, RefreshCw, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { fetchConfig, fetchSystemDiagnostics } from '../services/api';
import type { Principal, SystemDiagnostics, SystemHealth } from '../types/api';

interface SettingsProps { principal: Principal; health: SystemHealth }
interface EffectiveConfig {
  configuration_hash: string;
  execution: { run_timeout_seconds: number; max_concurrent_runs: number; retention_days: number; max_llm_calls: number; max_context_chars: number };
  workflow: Record<string, boolean>;
  file_limits: { allowed_extensions: string[] };
}
const tabs = ['Deployment', 'Diagnostics', 'Storage', 'Evaluation'] as const;

export function Settings({ principal, health }: SettingsProps) {
  const [tab, setTab] = useState<typeof tabs[number]>('Deployment');
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextDiagnostics, nextConfig] = await Promise.all([fetchSystemDiagnostics(), fetchConfig()]);
      setDiagnostics(nextDiagnostics);
      setConfig(nextConfig);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load settings');
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [principal.subject]);

  const rows = (values: Array<[string, string | number]>) => (
    <dl className="settings-values">
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );

  return (
    <div className="view-container">
      <header className="page-header">
        <div><h1>System <span>Settings</span></h1><p className="page-subtitle">Deployment configuration and measured service diagnostics.</p></div>
        <button className="btn btn-primary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh status'}</button>
      </header>
      {error && <div className="notice-banner" role="alert">{error}{diagnostics && ' Previously loaded values are shown below.'}</div>}
      <div className="metric-grid">
        <div className="metric-card"><div className="metric-label-row">Execution mode <Activity size={15} /></div><div className="metric-value">{principal.subject ? health.mode : '—'}</div><p className="metric-meta">{health.mode === 'demo' ? 'Demo investigations use simulated evidence.' : 'Live mode requires configured providers.'}</p></div>
        <div className="metric-card"><div className="metric-label-row">Database <Database size={15} /></div><div className="metric-value">{diagnostics?.database.status ?? '—'}</div><p className="metric-meta">{diagnostics ? `${diagnostics.database.dialect} · ${diagnostics.database.latency_ms} ms probe` : 'Waiting for diagnostics'}</p></div>
        <div className="metric-card"><div className="metric-label-row">Local storage <HardDrive size={15} /></div><div className="metric-value">{diagnostics ? `${diagnostics.storage.disk_free_gb} GB` : '—'}</div><p className="metric-meta">{diagnostics ? `Free space · ${diagnostics.storage.writable ? 'writable' : 'not writable'}` : 'Waiting for diagnostics'}</p></div>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map(name => <button key={name} id={`settings-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="settings-panel" className={`btn ${tab === name ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      <section id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="notice-banner">
        {loading && !config ? <p role="status">Loading deployment settings…</p> : !config || !diagnostics ? <p>Connect an authenticated session to inspect this deployment.</p> : <>
          {tab === 'Deployment' && <>
            <h3><SettingsIcon size={17} /> Effective configuration</h3>
            {rows([['Tenant', principal.tenant_id], ['Project', principal.project_id], ['Run deadline', `${config.execution.run_timeout_seconds} seconds`], ['Concurrent investigations', config.execution.max_concurrent_runs], ['Maximum model calls', config.execution.max_llm_calls], ['Context limit', `${config.execution.max_context_chars.toLocaleString()} characters`]])}
            <p className="metric-meta">Configuration is managed by the deployment. Supported overrides are available in <a href="#parameters">Parameter Studio</a>.</p>
            <h3>Workflow stages</h3><div className="settings-tags">{Object.entries(config.workflow).map(([name, enabled]) => <span className={`badge ${enabled ? 'badge-active' : 'badge-neutral'}`} key={name}>{name.replaceAll('_', ' ')} · {enabled ? 'enabled' : 'disabled'}</span>)}</div>
            <p className="metric-meta settings-hash">Configuration hash: {config.configuration_hash}</p>
          </>}
          {tab === 'Diagnostics' && <>
            <h3><ShieldCheck size={17} /> Latest service observations</h3>
            {rows([['Database probe', diagnostics.database.status], ['Database latency', `${diagnostics.database.latency_ms} ms`], ['Process peak memory', `${diagnostics.memory.rss_mb} MB`], ['Active async tasks', diagnostics.memory.active_tasks], ['Observed at', new Date(diagnostics.timestamp * 1000).toLocaleString()]])}
            <p className="metric-meta">Connector probes are available in <a href="#tools">Tools &amp; Connectors</a>. A configured service is not proof of a successful connection.</p>
          </>}
          {tab === 'Storage' && <>
            <h3><HardDrive size={17} /> Deployment storage</h3>
            {rows([['Local projects path', diagnostics.storage.path], ['Free / total disk', `${diagnostics.storage.disk_free_gb} / ${diagnostics.storage.disk_total_gb} GB`], ['Writable', diagnostics.storage.writable ? 'Yes' : 'No'], ['Retention', `${config.execution.retention_days} days`], ['Object layout', diagnostics.storage.cas_layout]])}
            <p className="metric-meta">Retention cleanup is an explicit maintenance operation. It is not scheduled by this interface.</p>
            <h3>Accepted attachment types</h3><div className="settings-tags">{config.file_limits.allowed_extensions.map(extension => <span className="badge badge-neutral" key={extension}>{extension}</span>)}</div>
          </>}
          {tab === 'Evaluation' && <>
            <h3>MLflow evaluation tracking</h3>
            {rows([['Tracking configuration', diagnostics.mlflow.status], ['Experiment store', diagnostics.mlflow.experiment_store]])}
            <p>The deployment keeps tracking credentials on the server. Offline fixture contracts validate behavior; they do not measure live root-cause accuracy.</p>
            <div className="settings-tags">{diagnostics.mlflow.offline_eval_contracts.map(name => <span className="badge badge-neutral" key={name}>{name}</span>)}</div>
            <a className="btn btn-secondary" href="#optimization">Open optimization records</a>
          </>}
        </>}
      </section>
    </div>
  );
}
