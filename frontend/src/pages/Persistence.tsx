import React, { useEffect, useState } from 'react';
import { Database, HardDrive, RefreshCw } from 'lucide-react';
import { ApiError, fetchConfig, fetchSystemDiagnostics } from '../services/api';

interface Diagnostics { database?: { status?: string; dialect?: string; latency_ms?: number }; storage?: { status?: string; path?: string; writable?: boolean; disk_free_gb?: number; disk_total_gb?: number }; }
interface FileLimits { max_file_bytes?: number; max_files?: number; max_text_chars?: number; max_pdf_pages?: number; max_rows?: number; max_cells?: number; parser_timeout_seconds?: number; concurrency?: number; allowed_extensions?: string[]; }
const formatBytes = (bytes?: number) => bytes == null ? 'Unavailable' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const Persistence: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { setError(null); try { const [resolved, health] = await Promise.all([fetchConfig(), fetchSystemDiagnostics()]); setConfig(resolved); setDiagnostics(health); } catch (reason: unknown) { setError(reason instanceof ApiError ? reason.message : 'Unable to load persistence configuration.'); } };
  useEffect(() => { void load(); }, []);
  const files: FileLimits | undefined = config?.file_limits;
  const storage = diagnostics?.storage;
  return <div className="view-container">
    <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Persistence & <span>Storage</span></h1><p className="hero-lede">Server reported database, storage, retention, and bounded file processing configuration.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><b>Configuration:</b> {config ? 'loaded' : 'loading'}</span><span className="hero-stat-chip"><b>Changes:</b> server managed</span></div></div></section>
    {error && <div className="card" style={{ color: 'var(--danger)' }}>{error} <button className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={13} /> Retry</button></div>}
    <div className="metric-grid"><div className="metric-card"><div className="metric-label-row"><span>Database</span><Database size={15} /></div><div className="metric-value">{diagnostics?.database?.status || 'Loading…'}</div><div className="metric-meta">{diagnostics?.database?.dialect || 'Dialect unavailable'}{diagnostics?.database?.latency_ms != null ? ` · ${diagnostics.database.latency_ms}ms` : ''}</div></div><div className="metric-card"><div className="metric-label-row"><span>Storage access</span><HardDrive size={15} /></div><div className="metric-value">{storage ? storage.writable ? 'Writable' : 'Read only' : 'Loading…'}</div><div className="metric-meta">{storage?.path || 'Path unavailable'}</div></div></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}><section className="card" style={{ height: 'auto' }}><h2>Storage capacity</h2><div className="card-meta-pills"><span className="meta-pill">Free: {storage?.disk_free_gb != null ? `${storage.disk_free_gb} GB` : 'Unavailable'}</span><span className="meta-pill">Total: {storage?.disk_total_gb != null ? `${storage.disk_total_gb} GB` : 'Unavailable'}</span></div><p style={{ color: 'var(--muted)', fontSize: 12 }}>Storage is managed by the deployment. This release does not expose cleanup controls.</p></section><section className="card" style={{ height: 'auto' }}><h2>File processing limits</h2>{files ? <div className="card-meta-pills"><span className="meta-pill">Max file: {formatBytes(files.max_file_bytes)}</span><span className="meta-pill">Files per request: {files.max_files ?? 'Unavailable'}</span><span className="meta-pill">Text: {files.max_text_chars ?? 'Unavailable'} chars</span><span className="meta-pill">PDF pages: {files.max_pdf_pages ?? 'Unavailable'}</span><span className="meta-pill">Parser concurrency: {files.concurrency ?? 'Unavailable'}</span></div> : <p>Loading file limits…</p>}</section></div>
    <section className="card" style={{ height: 'auto' }}><h2>Retention</h2><p style={{ color: 'var(--muted)' }}>{config?.execution?.retention_days != null ? `${config.execution.retention_days} days configured by the server.` : 'Retention policy is unavailable.'} Cleanup is a manual deployment operation.</p></section>
  </div>;
};
