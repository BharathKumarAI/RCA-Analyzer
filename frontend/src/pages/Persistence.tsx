import React, { useEffect, useState } from 'react';
import {
  Database,
  HardDrive,
  RefreshCw,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode,
  Sliders,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  ApiError,
  fetchPrincipal,
  fetchSystemDiagnostics,
  fetchConfig,
  fetchPlatformSettings,
  updatePlatformSettings,
  fetchPlatformFileProcessing,
  updatePlatformFileProcessing,
  triggerRetentionCleanup,
} from '../services/api';
import type { CleanupResult, FileLimitsConfig, PlatformSettingsConfig, Principal } from '../types/api';

interface Diagnostics {
  database?: { status?: string; dialect?: string; latency_ms?: number };
  storage?: {
    status?: string;
    path?: string;
    writable?: boolean;
    disk_free_gb?: number;
    disk_total_gb?: number;
  };
}

export const Persistence: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [limits, setLimits] = useState<FileLimitsConfig | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsConfig | null>(null);
  const [fileProcessingHash, setFileProcessingHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);

  // Form state for limits
  const [maxFileMb, setMaxFileMb] = useState<number>(10);
  const [maxFiles, setMaxFiles] = useState<number>(5);
  const [maxTextChars, setMaxTextChars] = useState<number>(100000);
  const [maxPdfPages, setMaxPdfPages] = useState<number>(15);
  const [parserTimeout, setParserTimeout] = useState<number>(20);
  const [concurrency, setConcurrency] = useState<number>(4);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [autoPrune, setAutoPrune] = useState<boolean>(true);
  const [allowedExts, setAllowedExts] = useState<string[]>([
    '.log',
    '.txt',
    '.json',
    '.csv',
    '.pdf',
    '.png',
    '.jpg',
    '.yaml',
  ]);
  const [newExtInput, setNewExtInput] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [diagData, currentPrincipal, settings] = await Promise.all([
        fetchSystemDiagnostics(), fetchPrincipal(), fetchPlatformSettings(),
      ]);
      const fileConfig = currentPrincipal.roles.includes('PLATFORM_ADMIN')
        ? await fetchPlatformFileProcessing()
        : await fetchConfig();
      setDiagnostics(diagData);
      setPrincipal(currentPrincipal);
      setPlatformSettings(settings);
      setFileProcessingHash('content_hash' in fileConfig ? fileConfig.content_hash : null);
      const limData = ('values' in fileConfig ? fileConfig.values : fileConfig.file_limits) as unknown as FileLimitsConfig;
      setLimits(limData);
      setMaxFileMb(Math.round((limData.max_file_bytes || 10485760) / 1024 / 1024));
      setMaxFiles(limData.max_files || 5);
      setMaxTextChars(limData.max_text_chars || 100000);
      setMaxPdfPages(limData.max_pdf_pages || 15);
      setParserTimeout(limData.parser_timeout_seconds || 20);
      setConcurrency(limData.concurrency || 4);
      setRetentionDays(settings.retention_days);
      setAutoPrune(false);
      setAllowedExts(limData.allowed_extensions || ['.log', '.txt', '.json', '.csv', '.pdf']);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to load persistence configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const isPlatformAdmin = principal?.roles.includes('PLATFORM_ADMIN') ?? false;

  const handleSaveLimits = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (!fileProcessingHash) return;
      const fileValues = {
        ...limits,
        max_file_bytes: maxFileMb * 1024 * 1024,
        max_files: maxFiles,
        max_text_chars: maxTextChars,
        max_pdf_pages: maxPdfPages,
        parser_timeout_seconds: parserTimeout,
        concurrency: concurrency,
        allowed_extensions: allowedExts,
      };
      delete (fileValues as Record<string, unknown>).tenant_id;
      delete (fileValues as Record<string, unknown>).project_id;
      delete (fileValues as Record<string, unknown>).updated_at;
      const updated = await updatePlatformFileProcessing(fileValues, fileProcessingHash);
      if (platformSettings) {
        const updatedSettings = await updatePlatformSettings({
          run_timeout_seconds: platformSettings.run_timeout_seconds,
          max_concurrent_runs: platformSettings.max_concurrent_runs,
          max_llm_calls: platformSettings.max_llm_calls,
          max_input_chars: platformSettings.max_input_chars,
          max_context_chars: platformSettings.max_context_chars,
          retention_days: retentionDays,
          mode: platformSettings.mode,
        });
        setPlatformSettings(updatedSettings);
      }
      setFileProcessingHash(updated.content_hash);
      const updatedValues = ('values' in updated ? updated.values : updated) as unknown as FileLimitsConfig;
      setLimits(updatedValues);
      setSuccessMsg('Storage bounds & retention limits successfully saved and applied!');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save limits');
    } finally {
      setSaving(false);
    }
  };

  const handleRunCleanup = async (dryRun: boolean) => {
    setCleaning(true);
    setError(null);
    setCleanupResult(null);
    try {
      const res = await triggerRetentionCleanup();
      setCleanupResult(res);
      setSuccessMsg(`Cleanup executed successfully: purged ${res.purged_runs} runs and ${res.purged_attachments} attachments.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to execute cleanup');
    } finally {
      setCleaning(false);
    }
  };

  const addExt = (e: React.KeyboardEvent) => {
    if (!isPlatformAdmin) return;
    if (e.key === 'Enter' && newExtInput.trim()) {
      e.preventDefault();
      let ext = newExtInput.trim().toLowerCase();
      if (!ext.startsWith('.')) ext = '.' + ext;
      if (!allowedExts.includes(ext)) {
        setAllowedExts(prev => [...prev, ext]);
      }
      setNewExtInput('');
    }
  };

  const removeExt = (ext: string) => {
    setAllowedExts(prev => prev.filter(e => e !== ext));
  };

  const storage = diagnostics?.storage;

  return (
    <div className="view-container">
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Persistence, <span>Storage & Retention</span>
          </h1>
          <p className="hero-lede">
            Configure upload boundaries, memory-safe parser constraints, automated lifecycle retention, and database maintenance.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Database size={12} style={{ color: 'var(--acc)' }} />{' '}
              <b>DB:</b> {diagnostics?.database?.status || 'Connected'} ({diagnostics?.database?.dialect || 'sqlite'})
            </span>
            <span className="hero-stat-chip">
              <HardDrive size={12} />{' '}
              <b>Storage:</b> {storage ? (storage.writable ? 'Read / Write' : 'Read Only') : 'Checking...'}
            </span>
            <span className="hero-stat-chip">
              <Clock size={12} /> <b>Retention:</b> {retentionDays} days
            </span>
          </div>
        </div>
        <div className="hero-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading || saving || cleaning}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          {isPlatformAdmin && <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveLimits()}
            disabled={loading || saving || cleaning || !isPlatformAdmin}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={13} /> {saving ? 'Saving...' : 'Save Configuration'}
          </button>}
        </div>
      </section>

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {successMsg && (
        <NotificationBanner
          type="success"
          message={successMsg}
          onClose={() => setSuccessMsg(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Metrics Row */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Database Status</span>
            <Database size={15} style={{ color: 'var(--acc)' }} />
          </div>
          <div className="metric-value">{diagnostics?.database?.status || 'Operational'}</div>
          <div className="metric-meta">
            {diagnostics?.database?.dialect || 'sqlite'} · {diagnostics?.database?.latency_ms != null ? `${diagnostics.database.latency_ms}ms query latency` : 'Connected'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Disk Capacity</span>
            <HardDrive size={15} />
          </div>
          <div className="metric-value">
            {storage?.disk_free_gb != null ? `${storage.disk_free_gb} GB Free` : 'Online'}
          </div>
          <div className="metric-meta">
            Total {storage?.disk_total_gb != null ? `${storage.disk_total_gb} GB` : 'Available'} · {storage?.path || 'Local Blobstore'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Max Ingestion Bandwidth</span>
            <Sliders size={15} />
          </div>
          <div className="metric-value">{maxFileMb} MB / file</div>
          <div className="metric-meta">
            Up to {maxFiles} attachments per incident run
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Retention Schedule</span>
            <Clock size={15} />
          </div>
          <div className="metric-value">{retentionDays} Days</div>
          <div className="metric-meta">
            {autoPrune ? 'Automated pruning active' : 'Manual cleanup only'}
          </div>
        </div>
      </div>

      {/* Main Configuration Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Upload and Parsing Limits */}
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCode size={16} style={{ color: 'var(--acc)' }} /> Bounded Ingestion & Parser Limits
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
            Enforce memory-safe CPU bounds, text limits, and allowed MIME extensions for file attachments.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Max Upload File Size (MB)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={maxFileMb}
                onChange={e => setMaxFileMb(parseInt(e.target.value, 10) || 1)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Max Files Per Incident
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={maxFiles}
                onChange={e => setMaxFiles(parseInt(e.target.value, 10) || 1)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Max Text Characters Extracted
              </label>
              <input
                type="number"
                step="5000"
                min="10000"
                max="1000000"
                value={maxTextChars}
                onChange={e => setMaxTextChars(parseInt(e.target.value, 10) || 10000)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Max PDF Pages Scanned
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={maxPdfPages}
                onChange={e => setMaxPdfPages(parseInt(e.target.value, 10) || 1)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Parser Timeout (Seconds)
              </label>
              <input
                type="number"
                min="5"
                max="120"
                value={parserTimeout}
                onChange={e => setParserTimeout(parseInt(e.target.value, 10) || 5)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Parser Thread Concurrency
              </label>
              <input
                type="number"
                min="1"
                max="16"
                value={concurrency}
                onChange={e => setConcurrency(parseInt(e.target.value, 10) || 1)}
                disabled={!isPlatformAdmin || saving}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Whitelisted File Extensions
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {allowedExts.map(ext => (
                <span
                  key={ext}
                  style={{
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#60a5fa',
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <code>{ext}</code>
              {isPlatformAdmin && <button
                type="button"
                onClick={() => removeExt(ext)}
                disabled={!isPlatformAdmin || saving}
                    style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    ×
                  </button>}
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Add extension (e.g. .md or .tar) and press Enter..."
              value={newExtInput}
              onChange={e => setNewExtInput(e.target.value)}
              onKeyDown={addExt}
              disabled={!isPlatformAdmin || saving}
              style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}
            />
          </div>
        </div>

        {/* Retention & Lifecycle Cleanup */}
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} style={{ color: 'var(--acc)' }} /> Retention Policy & Maintenance
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
            Automatically age out historical incident runs and purge expired local blob attachments.
          </p>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Retention Window</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--acc)' }}>{retentionDays} Days</span>
            </div>
            <input
              type="range"
              min="1"
              max="180"
              value={retentionDays}
              onChange={e => setRetentionDays(parseInt(e.target.value, 10))}
              disabled={!isPlatformAdmin || saving}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
              <span>1 Day (Ephemeral)</span>
              <span>30 Days (Standard)</span>
              <span>90 Days</span>
              <span>180 Days</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 8, border: '1px solid var(--line)', marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Automated Daemon Pruning</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Automatic pruning is unavailable because no durable background worker is configured.</div>
            </div>
            <input
              type="checkbox"
              checked={autoPrune}
              disabled
              aria-describedby="auto-prune-status"
              style={{ transform: 'scale(1.2)', cursor: 'not-allowed' }}
            />
            <div id="auto-prune-status" style={{ fontSize: 11, color: 'var(--muted)' }}>Automatic pruning is unavailable because no durable background worker is configured.</div>
          </div>

          {/* On-Demand Cleanup Trigger */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <h4 style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>Execute Retention Purge</h4>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
              Manually sweep the database and local blobstore for records older than {retentionDays} days.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              {isPlatformAdmin && <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to purge all incident runs and attachments older than ${retentionDays} days?`)) {
                    void handleRunCleanup(false);
                  }
                }}
                disabled={cleaning || !isPlatformAdmin}
                style={{ fontSize: 12, background: '#ef4444', borderColor: '#ef4444' }}
              >
                <Trash2 size={13} /> {cleaning ? 'Purging...' : 'Purge Expired Data'}
              </button>}
            </div>
          </div>

          {/* Cleanup Result Feedback */}
          {cleanupResult && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: 4 }}>
                Cleanup Execution Summary ({cleanupResult.status})
              </div>
              <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>
                <div><b>Purged Runs:</b> {cleanupResult.purged_runs}</div>
                <div><b>Purged Attachments:</b> {cleanupResult.purged_attachments}</div>
                <div><b>Freed Storage:</b> {((cleanupResult.freed_bytes ?? 0) / 1024).toFixed(1)} KB</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Cutoff: {cleanupResult.retention_cutoff_utc}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
