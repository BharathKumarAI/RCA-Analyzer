import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  Search,
  Plus,
  Sliders,
  Check,
  ShieldAlert,
  Save,
  Radio,
} from 'lucide-react';
import {
  fetchAlerts,
  fetchNotifications,
  createAlert,
  updateAlertStatus,
  fetchAlertConfig,
  updateAlertConfig,
} from '../services/api';
import type {
  AlertsResponse,
  AlertItem,
  NotificationsResponse,
  CustomAlertPayload,
  AlertConfig,
} from '../types/api';

type AlertKind = 'all' | 'critical' | 'warning' | 'info';

export const Alerts: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [filter, setFilter] = useState<AlertKind>('all');
  const [search, setSearch] = useState('');

  // Threshold config state
  const [showConfigDrawer, setShowConfigDrawer] = useState(false);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    mttr_warning_minutes: 15,
    tool_failure_rate_percent: 5.0,
    probe_latency_warning_ms: 1500,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Broadcast alert modal state
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastSeverity, setBroadcastSeverity] = useState<'critical' | 'warning' | 'info'>('warning');
  const [broadcastSource, setBroadcastSource] = useState('admin_broadcast');
  const [broadcastComponent, setBroadcastComponent] = useState('platform_core');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastSummary, setBroadcastSummary] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  // Resolution note modal
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [alertResult, noticeResult, configResult] = await Promise.allSettled([
        fetchAlerts(),
        fetchNotifications(),
        fetchAlertConfig(),
      ]);

      if (alertResult.status === 'fulfilled') setData(alertResult.value);
      if (noticeResult.status === 'fulfilled') setNotifications(noticeResult.value);
      if (configResult.status === 'fulfilled') setAlertConfig(configResult.value);

      if (alertResult.status === 'rejected' && noticeResult.status === 'rejected') {
        throw alertResult.reason;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load alert feed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setError(null);
    try {
      const updated = await updateAlertConfig(alertConfig);
      setAlertConfig(updated);
      setSuccessMsg('Alert evaluation thresholds updated and persisted!');
      setShowConfigDrawer(false);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save alert thresholds');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleBroadcastAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) return;

    setBroadcasting(true);
    setError(null);
    try {
      const payload: CustomAlertPayload = {
        severity: broadcastSeverity,
        source: broadcastSource.trim() || 'admin_broadcast',
        component: broadcastComponent.trim() || 'platform',
        title: broadcastTitle.trim(),
        summary: broadcastSummary.trim() || broadcastTitle.trim(),
        message: broadcastMessage.trim(),
      };
      await createAlert(payload);
      setShowBroadcastModal(false);
      setBroadcastTitle('');
      setBroadcastSummary('');
      setBroadcastMessage('');
      setSuccessMsg('Platform operational alert successfully broadcasted to feed!');
      setTimeout(() => setSuccessMsg(null), 4000);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to broadcast alert');
    } finally {
      setBroadcasting(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      await updateAlertStatus(alertId, 'acknowledged');
      setSuccessMsg('Alert marked as acknowledged.');
      setTimeout(() => setSuccessMsg(null), 3000);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to acknowledge alert');
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingAlertId) return;

    try {
      await updateAlertStatus(resolvingAlertId, 'resolved', resolutionNotes.trim());
      setResolvingAlertId(null);
      setResolutionNotes('');
      setSuccessMsg('Alert successfully resolved and closed.');
      setTimeout(() => setSuccessMsg(null), 3000);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve alert');
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();

    return data.items.filter(item => {
      const matchesSeverity = filter === 'all' ? true : item.severity === filter;
      const matchesSearch = !query
        ? true
        : [
            item.title,
            item.summary,
            item.message,
            item.source,
            item.component,
          ].some(value => String(value).toLowerCase().includes(query));

      return matchesSeverity && matchesSearch;
    });
  }, [data, filter, search]);

  const formatUtc = (valueSeconds: number) =>
    new Date(valueSeconds * 1000).toLocaleString('en-US', {
      timeZone: 'UTC',
      hour12: false,
    });

  const hasSearch = search.trim().length > 0;

  const iconFor = (severity: AlertItem['severity']) => {
    if (severity === 'critical') return <AlertTriangle size={14} />;
    if (severity === 'warning') return <AlertCircle size={14} />;
    return <Info size={14} />;
  };

  return (
    <div className="view-container">
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Operational <span>Alerts</span> & Governance
          </h1>
          <p className="hero-lede">
            Live operations alerts, safety tripwires, and runtime notifications for governance and run status.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{data ? data.summary.total : '—'}</b> Active Alerts
            </span>
            <span className="hero-stat-chip">
              <AlertTriangle size={12} color="var(--acc-rose)" />
              <b>{data ? data.summary.critical : 0}</b> Critical
            </span>
            <span className="hero-stat-chip">
              <AlertCircle size={12} color="var(--acc-amber)" />
              <b>{data ? data.summary.warning : 0}</b> Warning
            </span>
            <span className="hero-stat-chip">
              <BellRing size={12} />
              <b>{notifications ? notifications.items.length : 0}</b> Notifications
            </span>
          </div>
        </div>
        <div className="hero-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setShowConfigDrawer(!showConfigDrawer)}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Sliders size={13} /> Thresholds
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowBroadcastModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Radio size={13} /> Broadcast Alert
          </button>
        </div>
      </section>

      {error && (
        <div className="notice-banner red" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} /> {error}
          <button className="btn btn-outline btn-sm" onClick={() => setError(null)} style={{ marginLeft: 'auto' }}>
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="notice-banner green" role="status" style={{ marginBottom: 16 }}>
          <CheckCircle2 size={15} /> {successMsg}
        </div>
      )}

      {/* Threshold Configuration Drawer */}
      {showConfigDrawer && (
        <div className="card" style={{ padding: 20, marginBottom: 20, border: '1px solid var(--acc)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={15} style={{ color: 'var(--acc)' }} /> Real-Time Alert Evaluation Thresholds
            </h3>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Configured across tenant scope</span>
          </div>

          <form onSubmit={handleSaveThresholds}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  MTTR Warning (Minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={alertConfig.mttr_warning_minutes}
                  onChange={e => setAlertConfig(c => ({ ...c, mttr_warning_minutes: parseInt(e.target.value, 10) || 1 }))}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Tool Failure Rate Alarm (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="50"
                  value={alertConfig.tool_failure_rate_percent}
                  onChange={e => setAlertConfig(c => ({ ...c, tool_failure_rate_percent: parseFloat(e.target.value) || 0.5 }))}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Connector Probe Latency (ms)
                </label>
                <input
                  type="number"
                  step="100"
                  min="200"
                  max="10000"
                  value={alertConfig.probe_latency_warning_ms}
                  onChange={e => setAlertConfig(c => ({ ...c, probe_latency_warning_ms: parseInt(e.target.value, 10) || 200 }))}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowConfigDrawer(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={savingConfig}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Save size={12} /> {savingConfig ? 'Saving...' : 'Save Thresholds'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="search-box">
          <Search size={14} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search title, summary, message, source, or component..."
          />
        </div>
        <div className="count-badge">
          {data ? `${visible.length} / ${data.summary.total} shown` : '—'} alert{data && data.summary.total === 1 ? '' : 's'}
        </div>
        <button
          className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`btn ${filter === 'critical' ? 'btn-danger' : 'btn-secondary'}`}
          onClick={() => setFilter('critical')}
        >
          Critical
        </button>
        <button
          className={`btn ${filter === 'warning' ? 'btn-open' : 'btn-secondary'}`}
          onClick={() => setFilter('warning')}
        >
          Warning
        </button>
        <button
          className={`btn ${filter === 'info' ? 'btn-open' : 'btn-secondary'}`}
          onClick={() => setFilter('info')}
        >
          Info
        </button>
      </div>

      {/* Main Alerts Table */}
      <section className="card" style={{ padding: 0, marginBottom: 20 }}>
        {!data ? (
          <div className="notice-banner" role="status">
            {loading ? 'Loading notifications from backend…' : 'No alert feed loaded yet.'}
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Title & Summary</th>
                  <th>Source / Component</th>
                  <th>Message</th>
                  <th>Detected (UTC)</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!visible.length && (
                  <tr>
                    <td colSpan={6}>
                      <span className="metric-meta" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={14} style={{ color: '#10b981' }} />
                        {hasSearch
                          ? 'No alerts match the current search term.'
                          : filter === 'all'
                          ? 'No active alerts in this scope.'
                          : `No ${filter} alerts in this scope.`}
                      </span>
                    </td>
                  </tr>
                )}
                {visible.map(item => (
                  <tr key={item.id}>
                    <td style={{ verticalAlign: 'middle' }}>
                      <span
                        className={`badge badge-${
                          item.severity === 'critical' ? 'failed' : item.severity === 'warning' ? 'neutral' : 'active'
                        }`}
                        style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
                      >
                        {iconFor(item.severity)} {item.severity}
                      </span>
                    </td>
                    <td>
                      <strong>{item.title}</strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.summary}</div>
                    </td>
                    <td>
                      <span className="meta-pill">{item.source}</span>{' '}
                      <span className="meta-pill">{item.component}</span>
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 300 }}>{item.message}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{formatUtc(item.created_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => void handleAcknowledge(item.id)}
                        title="Acknowledge alert"
                        style={{ fontSize: 11, padding: '2px 8px', marginRight: 6 }}
                      >
                        Ack
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setResolvingAlertId(item.id);
                          setResolutionNotes('');
                        }}
                        title="Resolve alert"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >
                        <Check size={11} /> Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Notifications Section */}
      <section className="card" style={{ padding: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <h3 className="card-title" style={{ margin: 0 }}>
            Runtime Notifications Stream
          </h3>
          <span className="count-badge">
            {notifications ? `${notifications.unread_count} unread` : '—'} notification
            {notifications && notifications.unread_count === 1 ? '' : 's'}
          </span>
        </div>
        {!notifications ? (
          <div className="notice-banner" role="status">
            {loading ? 'Loading notifications from backend…' : 'No notification feed loaded yet.'}
          </div>
        ) : notifications.items.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--muted)' }}>
            <span className="metric-meta">
              <BellRing size={13} /> No pending notifications.
            </span>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Kind</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Received (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {notifications.items.slice(0, 10).map(item => (
                  <tr key={item.id}>
                    <td>
                      <span
                        className={`badge badge-${
                          item.severity === 'critical' ? 'failed' : item.severity === 'warning' ? 'neutral' : 'active'
                        }`}
                      >
                        {item.severity}
                      </span>
                    </td>
                    <td>
                      <span className="meta-pill">{item.kind}</span>
                    </td>
                    <td>
                      <strong>{item.title}</strong>
                    </td>
                    <td>{item.message}</td>
                    <td>{formatUtc(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: Broadcast Alert */}
      {showBroadcastModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              width: 520,
              maxWidth: '90vw',
              padding: 24,
              border: '1px solid var(--line)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={16} style={{ color: 'var(--acc)' }} /> Broadcast Platform Alert
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Publish an urgent notice or system advisory across the active operational feed.
            </p>

            <form onSubmit={handleBroadcastAlert}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    Severity Level
                  </label>
                  <select
                    value={broadcastSeverity}
                    onChange={e => setBroadcastSeverity(e.target.value as any)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                  >
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    Source Identifier
                  </label>
                  <input
                    type="text"
                    value={broadcastSource}
                    onChange={e => setBroadcastSource(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Component
                </label>
                <input
                  type="text"
                  value={broadcastComponent}
                  onChange={e => setBroadcastComponent(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Alert Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Splunk Ingestion Latency Degradation"
                  value={broadcastTitle}
                  onChange={e => setBroadcastTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Summary
                </label>
                <input
                  type="text"
                  placeholder="Brief one-line summary"
                  value={broadcastSummary}
                  onChange={e => setBroadcastSummary(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Detailed Message *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Elaborate on the cause, affected services, and expected recovery time..."
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowBroadcastModal(false)}
                  disabled={broadcasting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={broadcasting}>
                  {broadcasting ? 'Broadcasting...' : 'Broadcast Alert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Resolve Alert */}
      {resolvingAlertId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              width: 440,
              maxWidth: '90vw',
              padding: 24,
              border: '1px solid var(--line)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Resolve Alert</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Mark this alert as resolved and document any remediation action taken.
            </p>

            <form onSubmit={handleResolve}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Resolution Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Scaled Splunk forwarder pods and restarted connector pool."
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setResolvingAlertId(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Confirm Resolve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
