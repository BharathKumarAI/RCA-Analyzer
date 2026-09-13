import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  Search,
  Radio,
  Sliders,
  Check,
  Save,
  PlayCircle,
  HeartPulse,
  ShieldCheck,
  FileCog,
  Zap,
  ArrowRight,
  ExternalLink,
  CheckCheck,
  Eye,
  Clock,
  ChevronRight,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  fetchAlerts,
  fetchNotifications,
  createAlert,
  updateAlertStatus,
  fetchAlertConfig,
  updateAlertConfig,
  markNotificationsRead,
} from '../services/api';
import type {
  AlertsResponse,
  AlertItem,
  NotificationsResponse,
  NotificationItem,
  CustomAlertPayload,
  AlertConfig,
} from '../types/api';
import type { ActivePage } from '../components/Sidebar';
import '../styles/alerts.css';

type MainTab = 'all' | 'alerts' | 'notifications' | 'thresholds';
type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';

interface AlertsProps {
  onNavigate?: (page: ActivePage, options?: { runId?: string; filter?: string; targetId?: string }) => void;
  onNotificationsUpdated?: () => void;
}

interface UnifiedItem {
  id: string;
  type: 'alert' | 'notification';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  message: string;
  created_at: number;
  source?: string;
  component?: string;
  status?: string;
  resolution_note?: string;
  resolved_at?: number;
  read?: boolean;
  kind?: string;
  metadata?: Record<string, any>;
  rawAlert?: AlertItem;
  rawNotification?: NotificationItem;
}

export const Alerts: React.FC<AlertsProps> = ({ onNavigate, onNotificationsUpdated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);

  // Tabs and Filters
  const [activeTab, setActiveTab] = useState<MainTab>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Threshold config state
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
      setError(reason instanceof Error ? reason.message : 'Unable to load operational alerts.');
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

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markNotificationsRead([notificationId]);
      // Update locally
      setNotifications(prev => {
        if (!prev) return prev;
        const nextItems = prev.items.map(item =>
          item.id === notificationId ? { ...item, read: true } : item
        );
        const unreadCount = nextItems.filter(i => !i.read).length;
        return { ...prev, items: nextItems, unread_count: unreadCount };
      });
      onNotificationsUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark notification as read');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead(undefined, true);
      setNotifications(prev => {
        if (!prev) return prev;
        const nextItems = prev.items.map(item => ({ ...item, read: true }));
        return { ...prev, items: nextItems, unread_count: 0 };
      });
      setSuccessMsg('All notifications marked as read.');
      setTimeout(() => setSuccessMsg(null), 3000);
      onNotificationsUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all as read');
    }
  };

  // Helper to determine destination page and metadata from alert or notification
  const resolveTarget = (item: UnifiedItem): { page: ActivePage; label: string; icon: React.ReactNode; runId?: string } | null => {
    // 1. Run investigation target
    if (item.kind === 'run' || item.metadata?.run_id || item.source === 'run' || item.component === 'investigations') {
      const runId = item.metadata?.run_id || (item.message.match(/run-[\w\d-]+/i)?.[0]);
      return {
        page: 'runs',
        label: runId ? `Investigation ${runId.slice(0, 8)}…` : 'View Investigations',
        icon: <PlayCircle size={12} />,
        runId,
      };
    }

    // 2. Connector / Health check target
    if (
      item.source === 'connector' ||
      item.component === 'jira' ||
      item.component === 'splunk' ||
      item.component === 'probes' ||
      item.kind === 'connector' ||
      item.title.toLowerCase().includes('connector') ||
      item.summary.toLowerCase().includes('connector')
    ) {
      return {
        page: 'health-checks',
        label: 'Inspect Health Checks',
        icon: <HeartPulse size={12} />,
      };
    }

    // 3. Governance / Agent approvals
    if (
      item.kind === 'governance' ||
      item.source === 'governance' ||
      item.title.toLowerCase().includes('governance') ||
      item.title.toLowerCase().includes('agent draft') ||
      item.title.toLowerCase().includes('approved') ||
      item.title.toLowerCase().includes('rejected')
    ) {
      return {
        page: 'governance',
        label: 'Review Governance',
        icon: <ShieldCheck size={12} />,
      };
    }

    // 4. Project Scope / Setup
    if (
      item.source === 'scope' ||
      item.component === 'connectors' ||
      item.kind === 'scope' ||
      item.title.toLowerCase().includes('scope') ||
      item.title.toLowerCase().includes('tenant')
    ) {
      return {
        page: 'project-setup',
        label: 'Project Setup',
        icon: <FileCog size={12} />,
      };
    }

    // 5. Runtime concurrency / saturation
    if (
      item.component === 'planner' ||
      item.component === 'concurrency' ||
      item.source === 'runtime' ||
      item.title.toLowerCase().includes('saturation')
    ) {
      return {
        page: 'runtime',
        label: 'Runtime Status',
        icon: <Zap size={12} />,
      };
    }

    return null;
  };

  const handleNavigateToTarget = (item: UnifiedItem) => {
    const target = resolveTarget(item);
    if (!target) return;

    // If it's an unread notification, mark it as read automatically
    if (item.type === 'notification' && !item.read) {
      void handleMarkAsRead(item.id);
    }

    if (onNavigate) {
      onNavigate(target.page, { runId: target.runId });
    } else {
      window.location.hash = target.page;
    }
  };

  // Build unified items list
  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const list: UnifiedItem[] = [];

    if (data?.items) {
      data.items.forEach(alert => {
        list.push({
          id: alert.id,
          type: 'alert',
          severity: alert.severity,
          title: alert.title,
          summary: alert.summary,
          message: alert.message,
          created_at: alert.created_at,
          source: alert.source,
          component: alert.component,
          status: alert.status,
          resolution_note: alert.resolution_note,
          resolved_at: alert.resolved_at,
          rawAlert: alert,
        });
      });
    }

    if (notifications?.items) {
      notifications.items.forEach(note => {
        list.push({
          id: note.id,
          type: 'notification',
          severity: note.severity,
          title: note.title,
          summary: note.kind === 'run' ? 'Investigation Run Status Update' : 'Governance & Policy Event',
          message: note.message,
          created_at: note.created_at,
          read: note.read ?? false,
          kind: note.kind,
          metadata: note.metadata,
          rawNotification: note,
        });
      });
    }

    // Sort descending by timestamp
    return list.sort((a, b) => b.created_at - a.created_at);
  }, [data, notifications]);

  // Filtered unified list
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return unifiedItems.filter(item => {
      // Tab matching
      if (activeTab === 'alerts' && item.type !== 'alert') return false;
      if (activeTab === 'notifications' && item.type !== 'notification') return false;

      // Severity matching
      if (severityFilter !== 'all' && item.severity !== severityFilter) return false;

      // Unread only matching
      if (unreadOnly && item.type === 'notification' && item.read) return false;

      // Search matching
      if (query) {
        const matchString = [
          item.title,
          item.summary,
          item.message,
          item.source || '',
          item.component || '',
          item.kind || '',
          item.type,
        ]
          .join(' ')
          .toLowerCase();

        if (!matchString.includes(query)) return false;
      }

      return true;
    });
  }, [unifiedItems, activeTab, severityFilter, unreadOnly, search]);

  const formatUtc = (valueSeconds: number) => {
    const date = new Date(valueSeconds * 1000);
    return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  };

  const formatRelative = (valueSeconds: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - valueSeconds;
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const totalAlertsCount = data?.summary.total ?? 0;
  const criticalCount = data?.summary.critical ?? 0;
  const warningCount = data?.summary.warning ?? 0;
  const unreadNotificationsCount = notifications?.unread_count ?? 0;
  const totalNotificationsCount = notifications?.items.length ?? 0;

  return (
    <div className="alerts-page">
      {/* Breadcrumbs */}
      <div className="alerts-breadcrumbs">
        <span>Admin Platform</span>
        <span className="separator">/</span>
        <span>Operations & Observability</span>
        <span className="separator">/</span>
        <span className="active-crumb">Alerts & Notifications</span>
      </div>

      {/* Header Banner */}
      <header className="alerts-header">
        <div className="alerts-header-main">
          <h1>
            <AlertTriangle size={24} style={{ color: 'var(--acc)' }} />
            Operational <span>Alerts</span> & Notifications
          </h1>
          <p>
            Real-time incident triggers, safety tripwires, and live runtime governance notifications.
            Navigate directly to active investigations, health checks, or governance audits from any alert.
          </p>
        </div>

        <div className="alerts-header-actions">
          {unreadNotificationsCount > 0 && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void handleMarkAllRead()}
              title="Mark all notifications as read"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <CheckCheck size={14} style={{ color: 'var(--acc)' }} /> Mark All Read ({unreadNotificationsCount})
            </button>
          )}

          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>

          <button
            type="button"
            className={`btn ${activeTab === 'thresholds' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab(activeTab === 'thresholds' ? 'all' : 'thresholds')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <Sliders size={13} /> Thresholds
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowBroadcastModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <Radio size={13} /> Broadcast Alert
          </button>
        </div>
      </header>

      {/* Feedback Banners */}
      {error && (
        <div className="notice-banner red" role="alert">
          <AlertTriangle size={16} />
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn btn-outline btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="notice-banner green" role="status">
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="alerts-metrics-grid">
        <div className="alerts-stat-card" onClick={() => { setActiveTab('alerts'); setSeverityFilter('all'); }} style={{ cursor: 'pointer' }}>
          <div className="alerts-stat-icon-wrap" style={{ color: 'var(--acc)' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="alerts-stat-info">
            <span className="alerts-stat-label">Active Alerts</span>
            <span className="alerts-stat-value">{totalAlertsCount}</span>
            <span className="alerts-stat-sub">Across connectors & runtime</span>
          </div>
        </div>

        <div className="alerts-stat-card" onClick={() => { setActiveTab('alerts'); setSeverityFilter('critical'); }} style={{ cursor: 'pointer' }}>
          <div className="alerts-stat-icon-wrap critical">
            <AlertTriangle size={20} />
          </div>
          <div className="alerts-stat-info">
            <span className="alerts-stat-label">Critical Alerts</span>
            <span className="alerts-stat-value" style={{ color: 'var(--acc-rose)' }}>{criticalCount}</span>
            <span className="alerts-stat-sub">Requires immediate triage</span>
          </div>
        </div>

        <div className="alerts-stat-card" onClick={() => { setActiveTab('alerts'); setSeverityFilter('warning'); }} style={{ cursor: 'pointer' }}>
          <div className="alerts-stat-icon-wrap warning">
            <AlertCircle size={20} />
          </div>
          <div className="alerts-stat-info">
            <span className="alerts-stat-label">Warning Alerts</span>
            <span className="alerts-stat-value" style={{ color: 'var(--acc-amber)' }}>{warningCount}</span>
            <span className="alerts-stat-sub">Degraded latency or thresholds</span>
          </div>
        </div>

        <div className="alerts-stat-card" onClick={() => { setActiveTab('notifications'); setUnreadOnly(false); }} style={{ cursor: 'pointer' }}>
          <div className="alerts-stat-icon-wrap notifications">
            <BellRing size={20} />
          </div>
          <div className="alerts-stat-info">
            <span className="alerts-stat-label">Notifications</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="alerts-stat-value">{totalNotificationsCount}</span>
              {unreadNotificationsCount > 0 && (
                <span className="alerts-tab-count has-unread" style={{ fontSize: 11 }}>
                  {unreadNotificationsCount} unread
                </span>
              )}
            </div>
            <span className="alerts-stat-sub">Governance & run completions</span>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="alerts-tab-bar">
        <div className="alerts-nav-tabs">
          <button
            type="button"
            className={`alerts-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <Layers size={14} />
            <span>All Activity</span>
            <span className="alerts-tab-count">{unifiedItems.length}</span>
          </button>

          <button
            type="button"
            className={`alerts-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setActiveTab('alerts')}
          >
            <AlertTriangle size={14} />
            <span>Operational Alerts</span>
            <span className="alerts-tab-count">{totalAlertsCount}</span>
          </button>

          <button
            type="button"
            className={`alerts-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <BellRing size={14} />
            <span>Runtime Notifications</span>
            <span className={`alerts-tab-count ${unreadNotificationsCount > 0 ? 'has-unread' : ''}`}>
              {unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread` : totalNotificationsCount}
            </span>
          </button>

          <button
            type="button"
            className={`alerts-tab-btn ${activeTab === 'thresholds' ? 'active' : ''}`}
            onClick={() => setActiveTab('thresholds')}
          >
            <Sliders size={14} />
            <span>Threshold Policies</span>
          </button>
        </div>
      </div>

      {/* Threshold Policies Tab View */}
      {activeTab === 'thresholds' && (
        <section className="thresholds-config-card">
          <div className="thresholds-card-head">
            <div>
              <h3>
                <Sliders size={16} style={{ color: 'var(--acc)' }} /> Real-Time Evaluation Threshold Policies
              </h3>
              <p>
                Configure automated trigger boundaries across connector latency, investigation MTTR, and agent tool failure rates.
                Violations trigger operational alerts across the workspace.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveThresholds}>
            <div className="thresholds-form-grid">
              <div className="threshold-field">
                <label>MTTR Warning Threshold (Minutes)</label>
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={alertConfig.mttr_warning_minutes}
                  onChange={e =>
                    setAlertConfig(c => ({
                      ...c,
                      mttr_warning_minutes: parseInt(e.target.value, 10) || 1,
                    }))
                  }
                />
                <span className="threshold-hint">
                  Triggers warning if average mean time to resolution exceeds this limit.
                </span>
              </div>

              <div className="threshold-field">
                <label>Tool Failure Rate Threshold (%)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="50"
                  value={alertConfig.tool_failure_rate_percent}
                  onChange={e =>
                    setAlertConfig(c => ({
                      ...c,
                      tool_failure_rate_percent: parseFloat(e.target.value) || 0.5,
                    }))
                  }
                />
                <span className="threshold-hint">
                  Raises alarm when ADK agent connector tool errors exceed this percentage.
                </span>
              </div>

              <div className="threshold-field">
                <label>Connector Probe Latency Threshold (ms)</label>
                <input
                  type="number"
                  step="100"
                  min="200"
                  max="15000"
                  value={alertConfig.probe_latency_warning_ms}
                  onChange={e =>
                    setAlertConfig(c => ({
                      ...c,
                      probe_latency_warning_ms: parseInt(e.target.value, 10) || 200,
                    }))
                  }
                />
                <span className="threshold-hint">
                  Alerts on Jira or Splunk active probe roundtrip delays above this window.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setActiveTab('all')}
              >
                Back to Activity
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingConfig}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Save size={13} /> {savingConfig ? 'Saving Thresholds…' : 'Save Policies'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Main Feed Content (All, Alerts, Notifications) */}
      {activeTab !== 'thresholds' && (
        <>
          {/* Toolbar: Search and Filter Chips */}
          <div className="alerts-toolbar">
            <div className="alerts-search-box">
              <Search size={14} style={{ color: 'var(--dim)' }} />
              <input
                type="text"
                placeholder="Search alerts, notifications, components, run IDs, or sources…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="alerts-filters-group">
              <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--muted)', marginRight: 4 }}>
                Severity:
              </span>
              <button
                type="button"
                className={`alerts-filter-chip ${severityFilter === 'all' ? 'active' : ''}`}
                onClick={() => setSeverityFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`alerts-filter-chip critical ${severityFilter === 'critical' ? 'active critical' : ''}`}
                onClick={() => setSeverityFilter('critical')}
              >
                Critical
              </button>
              <button
                type="button"
                className={`alerts-filter-chip warning ${severityFilter === 'warning' ? 'active warning' : ''}`}
                onClick={() => setSeverityFilter('warning')}
              >
                Warning
              </button>
              <button
                type="button"
                className={`alerts-filter-chip info ${severityFilter === 'info' ? 'active info' : ''}`}
                onClick={() => setSeverityFilter('info')}
              >
                Info
              </button>

              {/* Unread toggle for notifications/all */}
              {(activeTab === 'notifications' || activeTab === 'all') && (
                <button
                  type="button"
                  className={`alerts-filter-chip ${unreadOnly ? 'active' : ''}`}
                  onClick={() => setUnreadOnly(!unreadOnly)}
                  style={{ marginLeft: 8 }}
                >
                  <Eye size={12} /> Unread Only
                </button>
              )}

              <span className="alerts-stat-sub" style={{ marginLeft: 8 }}>
                {visibleItems.length} match{visibleItems.length === 1 ? '' : 'es'}
              </span>
            </div>
          </div>

          {/* Cards Feed */}
          <div className="alerts-feed-container">
            {visibleItems.length === 0 ? (
              <div className="alerts-empty-feed">
                <div className="alerts-empty-icon">
                  <CheckCircle2 size={24} />
                </div>
                <h4>No Items to Display</h4>
                <p>
                  {search
                    ? `No alerts or notifications match "${search}". Try clearing the search query.`
                    : severityFilter !== 'all'
                    ? `No ${severityFilter} severity items active in this scope.`
                    : unreadOnly
                    ? 'All notifications have been read! No unread activity found.'
                    : 'All platform systems are operational and nominal within configured parameters.'}
                </p>
                {search && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setSearch('')}
                  >
                    Clear Search
                  </button>
                )}
              </div>
            ) : (
              visibleItems.map(item => {
                const target = resolveTarget(item);
                const isUnread = item.type === 'notification' && !item.read;

                return (
                  <article
                    key={`${item.type}-${item.id}`}
                    className={`alert-feed-item severity-${item.severity} ${
                      isUnread ? 'is-unread' : ''
                    } ${item.status === 'resolved' ? 'is-resolved' : ''}`}
                  >
                    {/* Header */}
                    <div className="alert-item-header">
                      <div className="alert-item-title-cluster">
                        <span className={`alert-type-badge ${item.severity}`}>
                          {item.severity}
                        </span>

                        <span className="source-tag" style={{ textTransform: 'uppercase' }}>
                          {item.type === 'notification' ? `NOTICE (${item.kind || 'runtime'})` : `ALERT (${item.source})`}
                        </span>

                        {item.component && (
                          <span className="source-tag">
                            {item.component}
                          </span>
                        )}

                        {item.type === 'notification' && !item.read && (
                          <span
                            className="alerts-tab-count has-unread"
                            style={{ fontSize: 9.5, padding: '1px 5px' }}
                          >
                            UNREAD
                          </span>
                        )}

                        {item.status && item.status !== 'open' && (
                          <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                            {item.status}
                          </span>
                        )}

                        <h3 className="alert-item-title">{item.title}</h3>
                      </div>

                      <div className="alert-item-meta-time" title={formatUtc(item.created_at)}>
                        <Clock size={12} />
                        <span>{formatRelative(item.created_at)}</span>
                        <span style={{ color: 'var(--line-strong)' }}>•</span>
                        <span>{formatUtc(item.created_at)}</span>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="alert-item-body">
                      {item.summary && item.summary !== item.title && (
                        <p className="alert-item-summary">{item.summary}</p>
                      )}
                      <p className="alert-item-message">{item.message}</p>

                      {item.resolution_note && (
                        <div className="alert-item-resolution-note">
                          <strong>Resolution Note:</strong> {item.resolution_note}
                        </div>
                      )}
                    </div>

                    {/* Footer & Actions */}
                    <div className="alert-item-footer">
                      <div className="alert-item-target-nav">
                        {target ? (
                          <button
                            type="button"
                            className="alert-target-btn"
                            onClick={() => handleNavigateToTarget(item)}
                            title={`Navigate to ${target.page}`}
                          >
                            {target.icon}
                            <span>{target.label}</span>
                            <ArrowRight size={12} />
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                            Platform-wide telemetry item
                          </span>
                        )}
                      </div>

                      <div className="alert-item-status-actions">
                        {/* Alert specific actions */}
                        {item.type === 'alert' && item.status !== 'resolved' && (
                          <>
                            {item.status !== 'acknowledged' && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => handleAcknowledge(item.id)}
                                title="Acknowledge this alert"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                              >
                                Ack
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setResolvingAlertId(item.id);
                                setResolutionNotes('');
                              }}
                              title="Resolve and document remediation"
                              style={{
                                fontSize: 11,
                                padding: '3px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Check size={11} /> Resolve
                            </button>
                          </>
                        )}

                        {/* Notification specific actions */}
                        {item.type === 'notification' && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => handleMarkAsRead(item.id)}
                            title={item.read ? 'Marked as read' : 'Mark as read'}
                            disabled={item.read}
                            style={{
                              fontSize: 11,
                              padding: '3px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <CheckCheck size={11} style={{ color: item.read ? 'var(--acc3)' : 'var(--muted)' }} />
                            {item.read ? 'Read' : 'Mark as read'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Broadcast Alert Modal */}
      {showBroadcastModal && (
        <div className="alert-modal-backdrop">
          <div className="alert-modal-card">
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={16} style={{ color: 'var(--acc)' }} /> Broadcast Platform Alert
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Publish an urgent notice or system advisory across the active operational feed.
            </p>

            <form onSubmit={handleBroadcastAlert}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Severity Level
                  </label>
                  <select
                    value={broadcastSeverity}
                    onChange={e => setBroadcastSeverity(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'var(--bg)',
                      color: 'var(--tx)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm, 4px)',
                      fontSize: 13,
                    }}
                  >
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Source Identifier
                  </label>
                  <input
                    type="text"
                    value={broadcastSource}
                    onChange={e => setBroadcastSource(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'var(--bg)',
                      color: 'var(--tx)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm, 4px)',
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Component
                </label>
                <input
                  type="text"
                  value={broadcastComponent}
                  onChange={e => setBroadcastComponent(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Alert Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Splunk Ingestion Latency Degradation"
                  value={broadcastTitle}
                  onChange={e => setBroadcastTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Summary
                </label>
                <input
                  type="text"
                  placeholder="Brief one-line summary"
                  value={broadcastSummary}
                  onChange={e => setBroadcastSummary(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Detailed Message *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Elaborate on the cause, affected services, and expected recovery time…"
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: 12,
                  }}
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
                  {broadcasting ? 'Broadcasting…' : 'Broadcast Alert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Alert Modal */}
      {resolvingAlertId && (
        <div className="alert-modal-backdrop">
          <div className="alert-modal-card" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Resolve Alert</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Mark this alert as resolved and document any remediation action taken for the platform audit trail.
            </p>

            <form onSubmit={handleResolve}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Resolution Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Scaled Splunk forwarder pods and restarted connector pool."
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: 12,
                  }}
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
