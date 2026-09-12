import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  Search,
  PlayCircle,
  WifiOff,
  Timer,
} from 'lucide-react';
import { fetchConnectorsHealth, fetchConnectorHealthCheck } from '../services/api';
import type { ConnectorsHealthResponse } from '../types/api';

export const HealthChecks: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ConnectorsHealthResponse | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [recheckErrors, setRecheckErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    setRecheckErrors({});
    try {
      const next = await fetchConnectorsHealth();
      setHealth(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load connector health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
      setRecheckErrors(prev => ({
        ...prev,
        [connector]: cause instanceof Error ? cause.message : `Unable to probe ${connector}.`,
      }));
    } finally {
      setPendingIds(current => {
        const next = new Set(current);
        next.delete(connector);
        return next;
      });
    }
  };

  const allItems = health ? Object.values(health.connectors) : [];

  const items = useMemo(() => {
    if (!health) return [];
    if (!search.trim()) return allItems;

    const term = search.trim().toLowerCase();
    return allItems.filter(item => {
      const connector = item.connector_id.toLowerCase();
      return (
        connector.includes(term) ||
        item.overall.toLowerCase().includes(term) ||
        item.connectivity.toLowerCase().includes(term) ||
        item.authentication.toLowerCase().includes(term) ||
        item.authorization.toLowerCase().includes(term)
      );
    });
  }, [allItems, search]);

  const formatUtc = (valueSeconds: number) => new Date(valueSeconds * 1000).toLocaleString('en-US', {
    timeZone: 'UTC',
    hour12: false,
  });
  const critical = allItems.filter(item => item.overall === 'UNHEALTHY' || item.overall === 'AUTHENTICATION_ERROR' || item.overall === 'AUTHORIZATION_ERROR' || item.overall === 'SCHEMA_MISMATCH').length;
  const degraded = allItems.filter(item => item.overall === 'DEGRADED' || item.overall === 'RATE_LIMITED').length;

  return (
    <div className="view-container">
      <header className="page-header">
        <div>
          <h1>Connector <span>Health Checks</span></h1>
          <p className="lede">Per-connector live probing and transport-layer health diagnostics.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => void load()} disabled={loading || pendingIds.size > 0}>
            <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh all'}
          </button>
        </div>
      </header>

      {error && <div className="notice-banner">{error}</div>}

      {health && (
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label-row">
              <span>Platform mode</span>
              <Activity size={15} />
            </div>
            <div className="metric-value">{health.mode}</div>
            <p className="metric-meta">Scope-aware connector probes honor project policy.</p>
          </div>
          <div className="metric-card">
            <div className="metric-label-row">
              <span>Critical checks</span>
              <WifiOff size={15} />
            </div>
            <div className="metric-value">{critical}</div>
            <p className="metric-meta">Critical status requires immediate connector attention.</p>
          </div>
          <div className="metric-card">
            <div className="metric-label-row">
              <span>Warning checks</span>
              <Timer size={15} />
            </div>
            <div className="metric-value">{degraded}</div>
            <p className="metric-meta">Degraded or rate limited connectors may recover on retry.</p>
          </div>
          <div className="metric-card">
            <div className="metric-label-row">
              <span>Disabled connectors</span>
              <CheckCircle2 size={15} />
            </div>
            <div className="metric-value">{health.disabled.length}</div>
            <p className="metric-meta">Connector-level health is hidden when disabled in policy.</p>
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search connector and health state."
          />
        </div>
        <div className="count-badge"><b>{health?.unconfigured.length || 0}</b> unconfigured probes</div>
      </div>

      <section className="card" style={{ padding: 0 }}>
        {!health ? (
          <div className="notice-banner" role="status">
            {loading ? 'Loading connector telemetry…' : 'No connector health loaded yet.'}
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Connector</th>
                  <th>Overall</th>
                  <th>Connectivity</th>
                  <th>Auth</th>
                  <th>Authz</th>
                  <th>Latency (ms)</th>
                  <th>Last probe (UTC)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <span className="metric-meta"><CheckCircle2 size={13} /> {search.trim() ? 'No connectors match your search.' : 'No connectors discovered for this deployment scope.'}</span>
                    </td>
                  </tr>
                ) : (
                  items.map(item => {
                    const connector = item.connector_id;
                    const last = item.last_probed_at ? formatUtc(item.last_probed_at) : 'Never';
                    const overallBadge = item.overall === 'HEALTHY'
                      ? 'badge-active'
                      : item.overall === 'DEGRADED' || item.overall === 'RATE_LIMITED'
                        ? 'badge-pending'
                        : 'badge-failed';
                    return (
                      <tr key={connector}>
                        <td><b>{connector}</b></td>
                        <td><span className={`badge ${overallBadge}`}>{item.overall}</span></td>
                        <td>{item.connectivity}</td>
                        <td>{item.authentication}</td>
                        <td>{item.authorization}</td>
                        <td>{item.latency_ms}</td>
                        <td>{last}</td>
                        <td>
                          <button
                            className="btn btn-open"
                            onClick={() => void runSingleProbe(connector)}
                            disabled={pendingIds.has(connector) || loading}
                          >
                            <PlayCircle size={13} /> {pendingIds.has(connector) ? 'Probing…' : 'Reprobe'}
                          </button>
                          {recheckErrors[connector] && (
                            <div className="metric-meta" style={{ color: 'var(--danger)', marginTop: 6 }}>
                              {recheckErrors[connector]}
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
    </div>
  );
};
