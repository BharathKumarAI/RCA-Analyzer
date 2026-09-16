import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  Search,
  PlayCircle,
  WifiOff,
  Timer,
  AlertTriangle,
  Database,
  HardDrive,
  Cpu,
  Layers,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowUpDown,
  Check,
  X,
  ChevronRight,
  Info,
  Radio,
  Copy,
  Server,
  Zap,
  RotateCw,
  Boxes,
  Terminal,
  Key,
  Globe,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  fetchConnectorsHealth,
  fetchConnectorHealthCheck,
  fetchSystemDiagnostics,
  testSystemConnection,
  fetchTools,
  fetchProjectSetup,
} from '../services/api';
import type {
  ConnectorsHealthResponse,
  ConnectorHealthRecord,
  ConnectorCheckStatus,
  SystemDiagnostics,
  ConnectionTestResponse,
  ToolDefinition,
  ProjectSetupResponse,
} from '../types/api';
import '../styles/health-checks.css';

type FilterTab = 'all' | 'configured' | 'healthy' | 'degraded' | 'critical' | 'unconfigured';
type SortField = 'name' | 'latency' | 'last_probed';
type SortOrder = 'asc' | 'desc';
type AutoRefreshInterval = 0 | 15 | 30 | 60;

export const HealthChecks: React.FC = () => {
  // Main data states directly from backend
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ConnectorsHealthResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [tools, setTools] = useState<ToolDefinition[] | null>(null);
  const [projectSetup, setProjectSetup] = useState<ProjectSetupResponse | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  // Probing states
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [recheckErrors, setRecheckErrors] = useState<Record<string, string>>({});
  const [reprobeAllProgress, setReprobeAllProgress] = useState<{ current: number; total: number } | null>(null);

  // Subsystem test states
  const [subsystemTesting, setSubsystemTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<ConnectionTestResponse | null>(null);

  // Filter & Search states
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Auto-refresh state
  const [autoRefreshSecs, setAutoRefreshSecs] = useState<AutoRefreshInterval>(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());

  // Drawer / Inspection state
  const [inspectedConnectorId, setInspectedConnectorId] = useState<string | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);

  // Auto-refresh timer ref
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load all authentic backend data
  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [healthRes, diagRes, toolsRes, projectRes] = await Promise.allSettled([
        fetchConnectorsHealth(),
        fetchSystemDiagnostics(),
        fetchTools(),
        fetchProjectSetup(),
      ]);

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
      } else {
        throw healthRes.reason;
      }

      if (diagRes.status === 'fulfilled') {
        setDiagnostics(diagRes.value);
      }

      if (toolsRes.status === 'fulfilled') {
        setTools(toolsRes.value);
      }

      if (projectRes.status === 'fulfilled') {
        setProjectSetup(projectRes.value);
      }

      setLastRefreshedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load platform health telemetry.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Handle auto-refresh interval
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoRefreshSecs > 0) {
      timerRef.current = setInterval(() => {
        void loadData(true);
      }, autoRefreshSecs * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefreshSecs, loadData]);

  // Map tool definitions by system_name or connector id
  const toolsMap = useMemo(() => {
    const map = new Map<string, ToolDefinition>();
    if (!tools) return map;
    for (const tool of tools) {
      if (tool.system_name) {
        map.set(tool.system_name, tool);
      }
      const parts = tool.id.split('.');
      if (parts[0]) {
        map.set(parts[0], tool);
      }
    }
    return map;
  }, [tools]);

  // Single connector reprobe against backend
  const runSingleProbe = async (connector: string) => {
    setPendingIds(current => {
      const next = new Set(current);
      next.add(connector);
      return next;
    });
    setRecheckErrors(prev => {
      const next = { ...prev };
      delete next[connector];
      return next;
    });

    try {
      const next = await fetchConnectorHealthCheck(connector);
      setHealth(current => {
        if (!current) return current;
        return {
          ...current,
          connectors: {
            ...current.connectors,
            [connector]: next,
          },
        };
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : `Unable to probe ${connector}.`;
      setRecheckErrors(prev => ({
        ...prev,
        [connector]: msg,
      }));
    } finally {
      setPendingIds(current => {
        const next = new Set(current);
        next.delete(connector);
        return next;
      });
    }
  };

  // Reprobe all connectors sequentially
  const handleReprobeAll = async () => {
    if (!health) return;
    const connectorsToProbe = Object.keys(health.connectors);
    if (connectorsToProbe.length === 0) return;

    setReprobeAllProgress({ current: 0, total: connectorsToProbe.length });
    for (let i = 0; i < connectorsToProbe.length; i++) {
      const id = connectorsToProbe[i];
      setReprobeAllProgress({ current: i + 1, total: connectorsToProbe.length });
      await runSingleProbe(id);
    }
    setReprobeAllProgress(null);
  };

  // Test single or all system subsystems
  const runSystemTargetTest = async (target: 'all' | 'database' | 'memory' | 'storage' | 'mlflow' | 'connectors') => {
    setSubsystemTesting(target);
    try {
      const res = await testSystemConnection(target);
      setTestResults(res);
      // Refresh system diagnostics
      setDiagLoading(true);
      const diagRes = await fetchSystemDiagnostics();
      setDiagnostics(diagRes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `System test for ${target} failed.`);
    } finally {
      setSubsystemTesting(null);
      setDiagLoading(false);
    }
  };

  const allItems = useMemo(() => (health ? Object.values(health.connectors) : []), [health]);
  const unconfiguredSet = useMemo(() => new Set(health?.unconfigured || []), [health]);
  const disabledSet = useMemo(() => new Set(health?.disabled || []), [health]);

  // Counts for KPIs
  const criticalCount = useMemo(
    () =>
      allItems.filter(
        item =>
          item.overall === 'UNHEALTHY' ||
          item.overall === 'AUTHENTICATION_ERROR' ||
          item.overall === 'AUTHORIZATION_ERROR' ||
          item.overall === 'SCHEMA_MISMATCH',
      ).length,
    [allItems],
  );

  const degradedCount = useMemo(
    () => allItems.filter(item => item.overall === 'DEGRADED' || item.overall === 'RATE_LIMITED').length,
    [allItems],
  );

  const healthyCount = useMemo(
    () => allItems.filter(item => item.overall === 'HEALTHY').length,
    [allItems],
  );

  const configuredCount = useMemo(
    () => allItems.filter(item => !unconfiguredSet.has(item.connector_id)).length,
    [allItems, unconfiguredSet],
  );

  // Filter & Search
  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      // Tab filter
      if (filterTab === 'configured' && unconfiguredSet.has(item.connector_id)) return false;
      if (filterTab === 'healthy' && item.overall !== 'HEALTHY') return false;
      if (
        filterTab === 'degraded' &&
        item.overall !== 'DEGRADED' &&
        item.overall !== 'RATE_LIMITED'
      ) {
        return false;
      }
      if (
        filterTab === 'critical' &&
        item.overall !== 'UNHEALTHY' &&
        item.overall !== 'AUTHENTICATION_ERROR' &&
        item.overall !== 'AUTHORIZATION_ERROR' &&
        item.overall !== 'SCHEMA_MISMATCH'
      ) {
        return false;
      }
      if (filterTab === 'unconfigured' && !unconfiguredSet.has(item.connector_id)) {
        return false;
      }

      // Search filter
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const tool = toolsMap.get(item.connector_id);
        const matches =
          item.connector_id.toLowerCase().includes(q) ||
          item.overall.toLowerCase().includes(q) ||
          (tool?.name && tool.name.toLowerCase().includes(q)) ||
          (tool?.category && tool.category.toLowerCase().includes(q)) ||
          (tool?.endpoint && tool.endpoint.toLowerCase().includes(q)) ||
          (item.message && item.message.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [allItems, filterTab, search, unconfiguredSet, toolsMap]);

  // Sort
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.connector_id.localeCompare(b.connector_id);
      } else if (sortField === 'latency') {
        cmp = a.latency_ms - b.latency_ms;
      } else if (sortField === 'last_probed') {
        cmp = (a.last_probed_at || 0) - (b.last_probed_at || 0);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [filteredItems, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(current => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const formatUtc = (valueSeconds: number | null | undefined) => {
    if (!valueSeconds) return 'Never';
    return new Date(valueSeconds * 1000).toLocaleString('en-US', {
      timeZone: 'UTC',
      hour12: false,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatTimeAgo = (valueSeconds: number | null | undefined) => {
    if (!valueSeconds) return 'Never probed';
    const diff = Math.floor(Date.now() / 1000 - valueSeconds);
    if (diff < 0) return 'Just now';
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const getStatusBadge = (status: ConnectorCheckStatus) => {
    switch (status) {
      case 'HEALTHY':
        return { label: 'HEALTHY', cls: 'badge-healthy', icon: <CheckCircle2 size={11} /> };
      case 'DEGRADED':
      case 'RATE_LIMITED':
        return { label: status, cls: 'badge-pending', icon: <AlertTriangle size={11} /> };
      case 'AUTHENTICATION_ERROR':
      case 'AUTHORIZATION_ERROR':
      case 'SCHEMA_MISMATCH':
      case 'UNHEALTHY':
        return { label: status, cls: 'badge-failed', icon: <WifiOff size={11} /> };
      default:
        return { label: status, cls: 'badge-neutral', icon: <Activity size={11} /> };
    }
  };

  const getVectorClass = (status: ConnectorCheckStatus) => {
    if (status === 'HEALTHY') return 'ok';
    if (status === 'DEGRADED' || status === 'RATE_LIMITED') return 'warning';
    return 'error';
  };

  const getConnectorIcon = (name: string) => {
    const key = name.toLowerCase();
    if (key.includes('confluence') || key.includes('doc')) return <Boxes size={16} />;
    if (key.includes('git')) return <Radio size={16} />;
    if (key.includes('jira') || key.includes('itsm')) return <ShieldCheck size={16} />;
    if (key.includes('kafka')) return <Zap size={16} />;
    if (key.includes('k8s') || key.includes('kube')) return <Server size={16} />;
    if (key.includes('log') || key.includes('splunk')) return <Terminal size={16} />;
    if (key.includes('oracle') || key.includes('db') || key.includes('sql')) return <Database size={16} />;
    if (key.includes('signal') || key.includes('metric')) return <Activity size={16} />;
    return <Cpu size={16} />;
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  // Currently inspected connector
  const inspectedHealthRecord = useMemo(() => {
    if (!inspectedConnectorId || !health) return null;
    return health.connectors[inspectedConnectorId] || null;
  }, [inspectedConnectorId, health]);

  const inspectedTool = useMemo(() => {
    if (!inspectedConnectorId) return null;
    return toolsMap.get(inspectedConnectorId) || null;
  }, [inspectedConnectorId, toolsMap]);

  return (
    <div className="view-container health-page">
      {/* Top Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={13} />
            <span>Operational SRE Observability</span>
          </div>
          <h1 className="hero-title">
            Platform Health & <span>Connector Diagnostics</span>
          </h1>
          <p className="hero-lede">
            Live telemetry, backend transport latency, credential verification, and host infrastructure configuration across platform conduits.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{allItems.length}</b> Monitored Conduits
            </span>
            <span className="hero-stat-chip">
              <CheckCircle2 size={12} color="var(--acc3)" />
              <b>{healthyCount}</b> Healthy
            </span>
            {degradedCount > 0 && (
              <span className="hero-stat-chip">
                <AlertTriangle size={12} color="var(--acc-amber)" />
                <b>{degradedCount}</b> Degraded
              </span>
            )}
            {criticalCount > 0 && (
              <span className="hero-stat-chip">
                <WifiOff size={12} color="var(--acc-rose)" />
                <b>{criticalCount}</b> Critical
              </span>
            )}
            <span className="hero-stat-chip">
              <b>Platform Mode:</b> {health?.mode?.toUpperCase() || 'DEMO'}
            </span>
            <span className="hero-stat-chip">
              <Clock size={12} />
              <b>Last sync:</b> {formatTimeAgo(Math.floor(lastRefreshedAt / 1000))}
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            {/* Auto-refresh interval dropdown */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Auto-sync:</span>
              <select
                className="env-dropdown"
                value={autoRefreshSecs}
                onChange={e => setAutoRefreshSecs(Number(e.target.value) as AutoRefreshInterval)}
              >
                <option value={0}>Manual (Off)</option>
                <option value={15}>Every 15s</option>
                <option value={30}>Every 30s</option>
                <option value={60}>Every 60s</option>
              </select>
            </div>

            <button
              className="btn btn-secondary"
              onClick={() => void runSystemTargetTest('all')}
              disabled={subsystemTesting !== null}
              title="Execute live diagnostics ping across Database, Memory, Storage, MLflow and Conduits"
            >
              <Zap size={14} className={subsystemTesting ? 'spin' : ''} />
              {subsystemTesting === 'all' ? 'Probing Subsystems…' : 'Probe Subsystems'}
            </button>

            <button
              className="btn btn-primary"
              onClick={() => void loadData()}
              disabled={loading || pendingIds.size > 0 || reprobeAllProgress !== null}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              {loading ? 'Refreshing…' : 'Refresh All'}
            </button>
          </div>

          {reprobeAllProgress && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              Probing connectors ({reprobeAllProgress.current} / {reprobeAllProgress.total})…
            </div>
          )}
        </div>
      </section>

      {/* Actual Backend Runtime Setup Strip */}
      <section className="backend-setup-strip">
        <div className="backend-setup-top">
          <div className="backend-setup-title">
            <Server size={14} color="var(--acc)" />
            <span>Active Deployment Scope & Backend Environment</span>
          </div>
          <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
            Policy Enforcement: Strict RS256 Scope
          </span>
        </div>

        <div className="backend-setup-grid">
          <div className="backend-setup-item">
            <span className="backend-setup-label">Tenant ID</span>
            <span className="backend-setup-val">{projectSetup?.scope.tenant_id || '—'}</span>
          </div>
          <div className="backend-setup-item">
            <span className="backend-setup-label">Project ID</span>
            <span className="backend-setup-val">{projectSetup?.scope.project_id || '—'}</span>
          </div>
          <div className="backend-setup-item">
            <span className="backend-setup-label">Platform Execution Mode</span>
            <span className="backend-setup-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`badge ${health?.mode === 'live' ? 'badge-healthy' : 'badge-pending'}`}>
                {health?.mode?.toUpperCase() || 'DEMO'}
              </span>
            </span>
          </div>
          <div className="backend-setup-item">
            <span className="backend-setup-label">Database Persistence</span>
            <span className="backend-setup-val">
              {diagnostics?.database.dialect.toUpperCase() || '—'}
            </span>
          </div>
        </div>

        {health?.mode === 'demo' && (
          <div className="backend-notice-callout">
            <Info size={16} color="var(--acc-amber)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <b>Demo Mode Operational Contract:</b> Deployment is operating in offline simulation (<code>RCA_MODE=demo</code>). In accordance with security architecture, external network socket probing and live credential resolution are inactive. Runs are recorded as simulated without model execution, connector evidence, or diagnostic findings. Source systems remain read only.
            </div>
          </div>
        )}
      </section>

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Subsystem Live Infrastructure Telemetry Deck */}
      <section className="subsystems-section">
        <div className="subsystems-header">
          <div className="subsystems-title">
            <Server size={15} color="var(--acc)" />
            <span>Subsystem Telemetry (Live Backend Store Diagnostics)</span>
            {diagLoading && <RotateCw size={12} className="spin" style={{ color: 'var(--dim)' }} />}
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            onClick={() => void runSystemTargetTest('all')}
            disabled={subsystemTesting !== null}
          >
            <Zap size={12} /> Test All Subsystems
          </button>
        </div>

        <div className="subsystems-grid">
          {/* Database */}
          <div className="subsystem-card">
            <div className="subsystem-card-top">
              <div className="subsystem-meta">
                <div className="subsystem-name">Database Engine</div>
                <div className="subsystem-sub">{diagnostics?.database.dialect.toUpperCase() || '—'}</div>
              </div>
              <div
                className={`subsystem-icon-wrap ${
                  diagnostics?.database.status === 'healthy' ? 'healthy' : 'error'
                }`}
              >
                <Database size={18} />
              </div>
            </div>

            <div className="subsystem-stats">
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Status</span>
                <span
                  className={`badge ${
                    diagnostics?.database.status === 'healthy' ? 'badge-healthy' : 'badge-failed'
                  }`}
                >
                  {diagnostics?.database.status ? diagnostics.database.status.toUpperCase() : '—'}
                </span>
              </div>
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Ping Latency</span>
                <span className="subsystem-stat-val">
                  {diagnostics?.database.latency_ms !== undefined
                    ? `${diagnostics.database.latency_ms.toFixed(2)} ms`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="subsystem-card-footer">
              <span style={{ color: 'var(--dim)', fontSize: 11 }}>Async SQLAlchemy Pool</span>
              <button
                className="subsystem-btn-test"
                onClick={() => void runSystemTargetTest('database')}
                disabled={subsystemTesting !== null}
              >
                <Zap size={11} className={subsystemTesting === 'database' ? 'spin' : ''} />
                {subsystemTesting === 'database' ? 'Pinging…' : 'Ping DB'}
              </button>
            </div>
          </div>

          {/* Storage & CAS */}
          <div className="subsystem-card">
            <div className="subsystem-card-top">
              <div className="subsystem-meta">
                <div className="subsystem-name">Artifacts & CAS Storage</div>
                <div className="subsystem-sub">
                  Layout: {diagnostics?.storage.cas_layout ? diagnostics.storage.cas_layout.toUpperCase() : '—'}
                </div>
              </div>
              <div
                className={`subsystem-icon-wrap ${
                  diagnostics?.storage.status === 'healthy' ? 'healthy' : 'warning'
                }`}
              >
                <HardDrive size={18} />
              </div>
            </div>

            <div className="subsystem-stats">
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Free / Total</span>
                <span className="subsystem-stat-val">
                  {diagnostics?.storage.disk_free_gb !== undefined && diagnostics?.storage.disk_total_gb !== undefined
                    ? `${diagnostics.storage.disk_free_gb} GB / ${diagnostics.storage.disk_total_gb} GB`
                    : '—'}
                </span>
              </div>
              {diagnostics?.storage.disk_total_gb && diagnostics.storage.disk_total_gb > 0 && (
                <div className="subsystem-bar-wrap">
                  <div
                    className="subsystem-bar-fill"
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(
                          100,
                          Math.round(
                            ((diagnostics.storage.disk_total_gb - diagnostics.storage.disk_free_gb) /
                              diagnostics.storage.disk_total_gb) *
                              100,
                          ),
                        ),
                      )}%`,
                    }}
                  />
                </div>
              )}
              <div className="subsystem-stat-row" style={{ marginTop: 2 }}>
                <span className="subsystem-stat-label">I/O Permission</span>
                <span style={{ color: diagnostics?.storage.writable ? 'var(--acc3)' : 'var(--acc-rose)', fontWeight: 650, fontSize: 11.5 }}>
                  {diagnostics?.storage.writable !== undefined
                    ? diagnostics.storage.writable
                      ? 'Writable'
                      : 'Read-Only'
                    : '—'}
                </span>
              </div>
            </div>

            <div className="subsystem-card-footer">
              <span style={{ color: 'var(--dim)', fontSize: 11 }}>Blob Storage</span>
              <button
                className="subsystem-btn-test"
                onClick={() => void runSystemTargetTest('storage')}
                disabled={subsystemTesting !== null}
              >
                <Zap size={11} className={subsystemTesting === 'storage' ? 'spin' : ''} />
                {subsystemTesting === 'storage' ? 'Testing…' : 'Test I/O'}
              </button>
            </div>
          </div>

          {/* Process Memory & Async Loop */}
          <div className="subsystem-card">
            <div className="subsystem-card-top">
              <div className="subsystem-meta">
                <div className="subsystem-name">Process Memory & Tasks</div>
                <div className="subsystem-sub">Python 3.11 Runtime</div>
              </div>
              <div
                className={`subsystem-icon-wrap ${
                  diagnostics?.memory.status === 'healthy' ? 'healthy' : 'warning'
                }`}
              >
                <Cpu size={18} />
              </div>
            </div>

            <div className="subsystem-stats">
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Peak RSS</span>
                <span className="subsystem-stat-val">
                  {diagnostics?.memory.rss_mb !== undefined ? `${diagnostics.memory.rss_mb} MB` : '—'}
                </span>
              </div>
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Active Asyncio Tasks</span>
                <span className="subsystem-stat-val">
                  {diagnostics?.memory.active_tasks !== undefined
                    ? `${diagnostics.memory.active_tasks} Tasks`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="subsystem-card-footer">
              <span style={{ color: 'var(--dim)', fontSize: 11 }}>OS Process Telemetry</span>
              <button
                className="subsystem-btn-test"
                onClick={() => void runSystemTargetTest('memory')}
                disabled={subsystemTesting !== null}
              >
                <Zap size={11} className={subsystemTesting === 'memory' ? 'spin' : ''} />
                {subsystemTesting === 'memory' ? 'Checking…' : 'Check RAM'}
              </button>
            </div>
          </div>

          {/* MLflow & Evaluation Contracts */}
          <div className="subsystem-card">
            <div className="subsystem-card-top">
              <div className="subsystem-meta">
                <div className="subsystem-name">MLflow Eval & Tracking</div>
                <div className="subsystem-sub">Offline Contracts</div>
              </div>
              <div
                className={`subsystem-icon-wrap ${
                  diagnostics?.mlflow.status === 'configured' || diagnostics?.mlflow.status === 'connected'
                    ? 'healthy'
                    : 'warning'
                }`}
              >
                <Layers size={18} />
              </div>
            </div>

            <div className="subsystem-stats">
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Tracking Store</span>
                <span
                  className={`badge ${
                    diagnostics?.mlflow.status === 'configured' || diagnostics?.mlflow.status === 'connected'
                      ? 'badge-healthy'
                      : 'badge-pending'
                  }`}
                >
                  {diagnostics?.mlflow.status ? diagnostics.mlflow.status.toUpperCase() : '—'}
                </span>
              </div>
              <div className="subsystem-stat-row">
                <span className="subsystem-stat-label">Contracts</span>
                <span className="subsystem-stat-val" style={{ fontSize: 11 }}>
                  {diagnostics?.mlflow.offline_eval_contracts && diagnostics.mlflow.offline_eval_contracts.length > 0
                    ? diagnostics.mlflow.offline_eval_contracts.join(', ')
                    : '—'}
                </span>
              </div>
            </div>

            <div className="subsystem-card-footer">
              <span style={{ color: 'var(--dim)', fontSize: 11 }}>Offline Evaluator</span>
              <button
                className="subsystem-btn-test"
                onClick={() => void runSystemTargetTest('mlflow')}
                disabled={subsystemTesting !== null}
              >
                <Zap size={11} className={subsystemTesting === 'mlflow' ? 'spin' : ''} />
                {subsystemTesting === 'mlflow' ? 'Verifying…' : 'Verify Store'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Subsystem Connection Test Result Banner (if run recently) */}
      {testResults && (
        <section
          className={`system-test-banner ${
            Object.values(testResults.results).some(r => r.status === 'error') ? 'has-errors' : ''
          }`}
        >
          <div className="system-test-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={14} color="var(--acc3)" />
              <b>Live Subsystem Probe Run</b>
              <span style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 11 }}>
                ({formatUtc(testResults.timestamp)})
              </span>
            </span>
            <button
              className="btn btn-ghost"
              style={{ padding: '2px 6px', fontSize: 11 }}
              onClick={() => setTestResults(null)}
            >
              <X size={12} /> Dismiss
            </button>
          </div>
          <div className="system-test-grid">
            {Object.entries(testResults.results).map(([key, res]) => (
              <div key={key} className="system-test-item">
                <span style={{ fontWeight: 650, textTransform: 'capitalize' }}>{key}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                    {res.latency_ms !== undefined ? `${res.latency_ms.toFixed(2)} ms` : '—'}
                  </span>
                  <span
                    className={`badge ${
                      res.status === 'connected' || res.status === 'healthy'
                        ? 'badge-healthy'
                        : res.status === 'warning'
                        ? 'badge-pending'
                        : 'badge-failed'
                    }`}
                  >
                    {res.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Interactive Metric KPI Filter Strip */}
      <div className="health-kpi-grid">
        <button
          className={`health-kpi-card ${filterTab === 'all' ? 'active' : ''}`}
          onClick={() => setFilterTab('all')}
        >
          <div className="kpi-label-row">
            <span>All Conduits</span>
            <Activity size={15} />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-number">{allItems.length}</span>
            <span className="kpi-meta-text">registered</span>
          </div>
          <p className="kpi-meta-text">All active connectors and catalog templates in current scope.</p>
        </button>

        <button
          className={`health-kpi-card healthy ${filterTab === 'healthy' ? 'active' : ''}`}
          onClick={() => setFilterTab('healthy')}
        >
          <div className="kpi-label-row">
            <span>Healthy Conduits</span>
            <CheckCircle2 size={15} />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-number">{healthyCount}</span>
            <span className="kpi-meta-text">operational</span>
          </div>
          <p className="kpi-meta-text">Passing connectivity, authentication, and authorization vectors.</p>
        </button>

        <button
          className={`health-kpi-card warning ${filterTab === 'degraded' ? 'active' : ''}`}
          onClick={() => setFilterTab('degraded')}
        >
          <div className="kpi-label-row">
            <span>Degraded / Simulated</span>
            <Timer size={15} />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-number">{degradedCount}</span>
            <span className="kpi-meta-text">demo / throttled</span>
          </div>
          <p className="kpi-meta-text">Connectors operating in demo simulation or with unprobed socket.</p>
        </button>

        <button
          className={`health-kpi-card critical ${filterTab === 'critical' ? 'active' : ''}`}
          onClick={() => setFilterTab('critical')}
        >
          <div className="kpi-label-row">
            <span>Critical / Broken</span>
            <WifiOff size={15} />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-number">{criticalCount}</span>
            <span className="kpi-meta-text">unreachable / failed</span>
          </div>
          <p className="kpi-meta-text">Authentication failure, unauthorized scope, or broken socket.</p>
        </button>
      </div>

      {/* Toolbar: Search, Filter Tabs, Sort, and Batch Action */}
      <div className="health-toolbar">
        {/* Filter Pills */}
        <div className="health-filter-group">
          <button
            className={`health-pill-btn ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            All <span className="health-pill-count">{allItems.length}</span>
          </button>
          <button
            className={`health-pill-btn ${filterTab === 'configured' ? 'active' : ''}`}
            onClick={() => setFilterTab('configured')}
          >
            Platform Enabled <span className="health-pill-count">{configuredCount}</span>
          </button>
          <button
            className={`health-pill-btn ${filterTab === 'healthy' ? 'active' : ''}`}
            onClick={() => setFilterTab('healthy')}
          >
            Healthy <span className="health-pill-count">{healthyCount}</span>
          </button>
          <button
            className={`health-pill-btn ${filterTab === 'degraded' ? 'active' : ''}`}
            onClick={() => setFilterTab('degraded')}
          >
            Degraded / Demo <span className="health-pill-count">{degradedCount}</span>
          </button>
          <button
            className={`health-pill-btn ${filterTab === 'critical' ? 'active' : ''}`}
            onClick={() => setFilterTab('critical')}
          >
            Critical <span className="health-pill-count">{criticalCount}</span>
          </button>
          <button
            className={`health-pill-btn ${filterTab === 'unconfigured' ? 'active' : ''}`}
            onClick={() => setFilterTab('unconfigured')}
          >
            Templates <span className="health-pill-count">{health?.unconfigured.length || 0}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="health-search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="health-search-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search conduit name, category, endpoint, or status…"
          />
          {search && (
            <button className="health-search-clear" onClick={() => setSearch('')} title="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Actions & Reprobe Filtered */}
        <div className="health-actions-group">
          <button
            className="btn btn-secondary"
            onClick={() => void handleReprobeAll()}
            disabled={reprobeAllProgress !== null || loading}
            title="Reprobe all visible connector conduits"
          >
            <PlayCircle size={13} className={reprobeAllProgress ? 'spin' : ''} />
            {reprobeAllProgress ? 'Reprobing Conduits…' : 'Reprobe All Conduits'}
          </button>
        </div>
      </div>

      {/* Main Conduits Data Table with Actual Backend Setup */}
      <section className="conduits-table-card">
        {!health ? (
          <div className="notice-banner" role="status" style={{ margin: 20 }}>
            {loading ? 'Querying backend for connector health and deployment setup…' : 'No connector health loaded.'}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer', width: '28%' }} onClick={() => toggleSort('name')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Conduit & Backend Definition
                      <ArrowUpDown size={11} />
                    </span>
                  </th>
                  <th style={{ width: '22%' }}>Configured Endpoint & Secret</th>
                  <th style={{ width: '13%' }}>Overall Verdict</th>
                  <th style={{ width: '16%' }}>
                    Multi-Vector Health
                    <span style={{ fontSize: 9.5, color: 'var(--dim)', marginLeft: 4, fontWeight: 400, textTransform: 'none' }}>
                      (NET / AUTH / AUTHZ)
                    </span>
                  </th>
                  <th style={{ cursor: 'pointer', width: '10%' }} onClick={() => toggleSort('latency')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Latency
                      <ArrowUpDown size={11} />
                    </span>
                  </th>
                  <th style={{ textAlign: 'right', width: '11%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '36px 20px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <CheckCircle2 size={24} color="var(--dim)" />
                        <span style={{ fontWeight: 650, color: 'var(--tx)' }}>No matching connector conduits found</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {search.trim()
                            ? `No connectors match "${search}". Try clearing search filters.`
                            : 'No conduits configured in this deployment scope.'}
                        </span>
                        {search.trim() && (
                          <button className="btn btn-secondary" style={{ marginTop: 6 }} onClick={() => setSearch('')}>
                            Clear Search
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedItems.map(item => {
                    const id = item.connector_id;
                    const tool = toolsMap.get(id);
                    const overallBadge = getStatusBadge(item.overall);
                    const isPending = pendingIds.has(id);
                    const isInspected = inspectedConnectorId === id;
                    const isUnconfigured = unconfiguredSet.has(id);
                    const isDisabled = disabledSet.has(id);

                    // Speed tier for latency
                    const latencyTier =
                      item.latency_ms <= 0
                        ? 'unprobed'
                        : item.latency_ms < 150
                        ? 'fast'
                        : item.latency_ms < 600
                        ? 'moderate'
                        : 'slow';

                    return (
                      <tr
                        key={id}
                        className={`conduit-row ${isInspected ? 'selected' : ''}`}
                        onClick={() => setInspectedConnectorId(id)}
                      >
                        {/* Conduit & Backend Definition Column */}
                        <td>
                          <div className="connector-cell">
                            <div className="connector-avatar">{getConnectorIcon(id)}</div>
                            <div className="connector-info">
                              <div className="connector-name-row">
                                <span className="connector-title">{tool?.name || id}</span>
                                <span className="connector-id-badge">{id}</span>
                                {isUnconfigured ? (
                                  <span className="badge badge-neutral" style={{ fontSize: 9 }}>
                                    Catalog Template
                                  </span>
                                ) : (
                                  <span className="badge badge-healthy" style={{ fontSize: 9 }}>
                                    Platform Active
                                  </span>
                                )}
                                {isDisabled && (
                                  <span className="badge badge-failed" style={{ fontSize: 9 }}>
                                    Disabled
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                Category: <b>{tool?.category || 'General'}</b> • Protocol: <b>{tool?.protocol || 'HTTPS'}</b>
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Configured Endpoint & Secret Column */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div className="connector-endpoint-row" title={tool?.endpoint || 'No endpoint'}>
                              <Globe size={11} color="var(--dim)" />
                              <span className="endpoint-chip">
                                {tool?.endpoint ? tool.endpoint : 'Default Platform Conduit'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {tool?.secret_reference && (
                                <span className="secret-ref-chip" title="Secret Reference">
                                  <Key size={9} />
                                  {tool.secret_reference}
                                </span>
                              )}
                              {tool?.auth_method && (
                                <span style={{ fontSize: 10, color: 'var(--dim)' }}>
                                  ({tool.auth_method})
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Overall Verdict Column */}
                        <td>
                          <span className={`badge ${overallBadge.cls}`}>
                            {overallBadge.icon}
                            {item.overall}
                          </span>
                        </td>

                        {/* Multi-Vector Health Matrix */}
                        <td>
                          <div className="vector-matrix">
                            <span
                              className={`vector-pill ${getVectorClass(item.connectivity)}`}
                              title={`Network Connectivity: ${item.connectivity}`}
                            >
                              NET
                            </span>
                            <span
                              className={`vector-pill ${getVectorClass(item.authentication)}`}
                              title={`Authentication: ${item.authentication}`}
                            >
                              AUTH
                            </span>
                            <span
                              className={`vector-pill ${getVectorClass(item.authorization)}`}
                              title={`Authorization: ${item.authorization}`}
                            >
                              AUTHZ
                            </span>
                          </div>
                        </td>

                        {/* Latency Column */}
                        <td>
                          <div className="latency-cell">
                            {item.latency_ms > 0 ? (
                              <span className={`latency-val-row ${latencyTier}`}>
                                <b>{item.latency_ms.toFixed(1)}</b> ms
                              </span>
                            ) : (
                              <span className="latency-val-row unprobed" title="Not actively probed in demo mode">
                                —
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions Column */}
                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            <button
                              className="btn-inspect"
                              onClick={() => setInspectedConnectorId(id)}
                              title="Inspect backend setup, parameters, and telemetry"
                            >
                              Inspect
                              <ChevronRight size={12} />
                            </button>
                            <button
                              className="btn-reprobe"
                              onClick={() => void runSingleProbe(id)}
                              disabled={isPending || loading}
                              title="Trigger immediate backend probe"
                            >
                              <PlayCircle size={12} className={isPending ? 'spin' : ''} />
                              {isPending ? 'Probing…' : 'Probe'}
                            </button>
                          </div>
                          {recheckErrors[id] && (
                            <div style={{ color: 'var(--acc-rose)', fontSize: 11, marginTop: 4 }}>
                              {recheckErrors[id]}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Deep Diagnostic Inspection Drawer (Actual Backend Setup) */}
      {inspectedHealthRecord && (
        <>
          <div className="drawer-backdrop" onClick={() => setInspectedConnectorId(null)} />
          <aside className="diagnostic-drawer" role="dialog" aria-label="Connector Inspection Drawer">
            {/* Header */}
            <div className="diag-drawer-header">
              <div className="diag-drawer-title-row">
                <div className="connector-avatar">{getConnectorIcon(inspectedHealthRecord.connector_id)}</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 750, color: 'var(--tx)' }}>
                    {inspectedTool?.name || inspectedHealthRecord.connector_id}
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    conduit_id: {inspectedHealthRecord.connector_id}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setInspectedConnectorId(null)}
                style={{ padding: 4 }}
                title="Close drawer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="diag-drawer-body">
              {/* Actual Backend Status Notice */}
              <div
                className={`diag-info-callout ${
                  inspectedHealthRecord.overall === 'HEALTHY'
                    ? ''
                    : inspectedHealthRecord.overall === 'DEGRADED' || inspectedHealthRecord.overall === 'RATE_LIMITED'
                    ? 'amber'
                    : 'rose'
                }`}
              >
                {inspectedHealthRecord.overall === 'HEALTHY' ? (
                  <CheckCircle2 size={16} color="var(--acc3)" style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <AlertTriangle size={16} color="var(--acc-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2 }}>
                    Overall Verdict: {inspectedHealthRecord.overall}
                  </div>
                  <div>
                    {inspectedHealthRecord.message || 'No diagnostic message returned by backend.'}
                  </div>
                </div>
              </div>

              {/* Actual Backend Network Setup */}
              <div className="diag-section">
                <div className="diag-section-title">Actual Backend Configuration Setup</div>
                <div className="diag-checklist">
                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Globe size={14} color="var(--muted)" />
                      Configured Endpoint
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--tx)' }}>
                      {inspectedTool?.endpoint || 'Platform default conduit'}
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Radio size={14} color="var(--muted)" />
                      Transport Protocol
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--tx)' }}>
                      {inspectedTool?.protocol || 'HTTPS'} ({inspectedTool?.integration_kind || 'native'})
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Key size={14} color="var(--muted)" />
                      Authentication & Secret Reference
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--tx)' }}>
                      {inspectedTool?.auth_method || '—'} {inspectedTool?.secret_reference ? `(${inspectedTool.secret_reference})` : ''}
                    </span>
                  </div>

                  {inspectedTool?.service_user && (
                    <div className="diag-check-item">
                      <span className="diag-check-label">
                        <ShieldCheck size={14} color="var(--muted)" />
                        Service Account Identity
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--tx)' }}>
                        {inspectedTool.service_user}
                      </span>
                    </div>
                  )}

                  {inspectedTool?.rate_limit && (
                    <div className="diag-check-item">
                      <span className="diag-check-label">
                        <Timer size={14} color="var(--muted)" />
                        Rate Limit Quota
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--tx)' }}>
                        {inspectedTool.rate_limit}
                      </span>
                    </div>
                  )}

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Activity size={14} color="var(--muted)" />
                      Platform State
                    </span>
                    <span className={`badge ${inspectedTool?.enabled ? 'badge-healthy' : 'badge-neutral'}`}>
                      {inspectedTool?.enabled ? 'Enabled in Platform Config' : 'Template (Catalog)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-Vector Inspection Checklist */}
              <div className="diag-section">
                <div className="diag-section-title">Telemetry Vector Breakdown</div>
                <div className="diag-checklist">
                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Radio size={14} color="var(--muted)" />
                      Network Connectivity
                    </span>
                    <span className={`badge ${getStatusBadge(inspectedHealthRecord.connectivity).cls}`}>
                      {inspectedHealthRecord.connectivity}
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <ShieldCheck size={14} color="var(--muted)" />
                      Authentication Validation
                    </span>
                    <span className={`badge ${getStatusBadge(inspectedHealthRecord.authentication).cls}`}>
                      {inspectedHealthRecord.authentication}
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <ShieldAlert size={14} color="var(--muted)" />
                      Authorization (Tenant/Project Scope)
                    </span>
                    <span className={`badge ${getStatusBadge(inspectedHealthRecord.authorization).cls}`}>
                      {inspectedHealthRecord.authorization}
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Timer size={14} color="var(--muted)" />
                      Rate Limit Status
                    </span>
                    <span className={`badge ${getStatusBadge(inspectedHealthRecord.rate_limit_status).cls}`}>
                      {inspectedHealthRecord.rate_limit_status}
                    </span>
                  </div>

                  <div className="diag-check-item">
                    <span className="diag-check-label">
                      <Boxes size={14} color="var(--muted)" />
                      Schema Compatibility
                    </span>
                    <span className={`badge ${getStatusBadge(inspectedHealthRecord.schema_compatibility).cls}`}>
                      {inspectedHealthRecord.schema_compatibility}
                    </span>
                  </div>
                </div>
              </div>

              {/* Custom Config if present */}
              {inspectedTool?.custom_config && Object.keys(inspectedTool.custom_config).length > 0 && (
                <div className="diag-section">
                  <div className="diag-section-title">Custom Connector Parameters</div>
                  <pre className="diag-code-block">{JSON.stringify(inspectedTool.custom_config, null, 2)}</pre>
                </div>
              )}

              {/* Raw JSON Diagnostic Payload with Copy */}
              <div className="diag-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="diag-section-title">Live Backend Health Payload</div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px' }}
                    onClick={() => copyToClipboard(JSON.stringify(inspectedHealthRecord, null, 2))}
                  >
                    {copiedRaw ? <Check size={12} color="var(--acc3)" /> : <Copy size={12} />}
                    {copiedRaw ? 'Copied' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="diag-code-block">{JSON.stringify(inspectedHealthRecord, null, 2)}</pre>
              </div>
            </div>

            {/* Footer */}
            <div className="diag-drawer-footer">
              <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                System: <b>{inspectedHealthRecord.connector_id}</b>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setInspectedConnectorId(null)}>
                  Close
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void runSingleProbe(inspectedHealthRecord.connector_id)}
                  disabled={pendingIds.has(inspectedHealthRecord.connector_id)}
                >
                  <PlayCircle size={13} className={pendingIds.has(inspectedHealthRecord.connector_id) ? 'spin' : ''} />
                  {pendingIds.has(inspectedHealthRecord.connector_id) ? 'Probing…' : 'Trigger Backend Probe'}
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
};
