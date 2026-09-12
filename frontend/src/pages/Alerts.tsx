import { useEffect, useMemo, useState } from 'react';
import { BellRing, AlertCircle, RefreshCw, AlertTriangle, Info, CheckCircle2, Search } from 'lucide-react';
import { fetchAlerts, fetchNotifications } from '../services/api';
import type { AlertsResponse, AlertItem, NotificationsResponse } from '../types/api';

type AlertKind = 'all' | 'critical' | 'warning' | 'info';

export const Alerts: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [filter, setFilter] = useState<AlertKind>('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [alertResult, noticeResult] = await Promise.allSettled([
        fetchAlerts(),
        fetchNotifications(),
      ]);

      if (alertResult.status === 'fulfilled') setData(alertResult.value);
      if (noticeResult.status === 'fulfilled') setNotifications(noticeResult.value);

      if (alertResult.status === 'rejected' && noticeResult.status === 'rejected') {
        throw alertResult.reason;
      }

      if (alertResult.status === 'rejected') {
        setError(noticeResult.status === 'fulfilled'
          ? 'Unable to load alert feed; notifications still loaded.'
          : (alertResult.reason instanceof Error ? alertResult.reason.message : 'Unable to load alert feed.'));
      }

      if (noticeResult.status === 'rejected' && alertResult.status === 'fulfilled') {
        setError('Notifications temporarily unavailable; alerts loaded.');
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

  const formatUtc = (valueSeconds: number) => new Date(valueSeconds * 1000).toLocaleString('en-US', {
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
      <header className="page-header">
        <div>
          <h1>Operational <span>Alerts</span></h1>
          <p className="lede">Live operations alerts and runtime notifications for governance and run status.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="notice-banner" role="alert">{error}</div>}

      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search title, summary, message, source, or component."
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

      <section className="card" style={{ padding: 0 }}>
        {!data ? (
          <div className="notice-banner" role="status">
            {loading ? 'Loading notifications from backend…' : 'No alert feed loaded yet.'}
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Summary</th>
                  <th>Source</th>
                  <th>Message</th>
                  <th>Detected (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {!visible.length && (
                  <tr>
                    <td colSpan={6}>
                      <span className="metric-meta">
                        <CheckCircle2 size={13} />
                        {hasSearch ? 'No alerts match the current search term.' : filter === 'all' ? 'No active alerts in this scope.' : `No ${filter} alerts in this scope.`}
                      </span>
                    </td>
                  </tr>
                )}
                {visible.map(item => (
                  <tr key={item.id}>
                    <td>
                      <span className={`badge badge-${item.severity === 'critical' ? 'failed' : item.severity === 'warning' ? 'neutral' : 'active'}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {iconFor(item.severity)} {item.severity}
                      </span>
                    </td>
                    <td><strong>{item.title}</strong></td>
                    <td>{item.summary}</td>
                    <td><span className="meta-pill">{item.source}</span> <span className="meta-pill">{item.component}</span></td>
                    <td>{item.message}</td>
                    <td style={{ color: 'var(--muted)' }}>{formatUtc(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Runtime notifications</h3>
          <span className="count-badge">{notifications ? `${notifications.unread_count} unread` : '—'} notification{notifications && notifications.unread_count === 1 ? '' : 's'}</span>
        </div>
        {!notifications ? (
          <div className="notice-banner" role="status">
            {loading ? 'Loading notifications from backend…' : 'No notification feed loaded yet.'}
          </div>
        ) : notifications.items.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--muted)' }}>
            <span className="metric-meta"><BellRing size={13} /> No pending notifications.</span>
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
                      <span className={`badge badge-${item.severity === 'critical' ? 'failed' : item.severity === 'warning' ? 'neutral' : 'active'}`}>{item.severity}</span>
                    </td>
                    <td><span className="meta-pill">{item.kind}</span></td>
                    <td><strong>{item.title}</strong></td>
                    <td>{item.message}</td>
                    <td>{formatUtc(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="notice-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650 }}>
          <BellRing size={15} /> Alert stream
        </div>
        <p className="metric-meta">
          Severity is calculated from health and run telemetry. Use Alerts for immediate operational changes and Health Checks for connector-level details.
        </p>
      </section>
    </div>
  );
};
