import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Activity,
  ArrowDownToLine,
  BarChart2,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wrench,
  Zap,
  LineChart,
} from 'lucide-react';
import { fetchCapabilities, getProjectContext } from '../services/api';
import {
  fetchProjectMetrics,
  fetchPlatformMetrics,
  type Telemetry,
  type TelemetryFilters,
  type PlatformMetrics,
  type Measurements,
} from '../services/telemetry';
import type { CapabilityItem } from '../types/api';
import '../styles/metrics.css';

export type WindowOption = '24h' | '7d' | '30d' | '90d' | 'custom';
export type ChartMetric = 'runs' | 'tickets' | 'latency' | 'tokens' | 'cost';
export type TabView = 'triage' | 'agents' | 'tokens' | 'tools' | 'feedback' | 'platform';
export type ChartRenderMode = 'area' | 'bar';

interface MetricsProps {
  initialMode?: 'live' | 'demo';
  projectWorkspace?: boolean;
  canAdminister?: boolean;
}

const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return 'Not recorded';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  const hours = mins / 60;
  return `${hours.toFixed(1)}h`;
};

const formatCurrency = (usd: number | null | undefined): string => {
  if (usd === null || usd === undefined) return 'Incomplete';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(usd);
};

const formatPercent = (rate: number | null | undefined): string => {
  if (rate === null || rate === undefined) return 'N/A';
  return `${(rate * 100).toFixed(1)}%`;
};

const labelClean = (value: string) => value.replace(/^tool:/, '').replace(/[_-]/g, ' ');
const utcDate = (date: Date) => date.toISOString().slice(0, 10);

// Helper for smooth SVG Bézier path generation
function generateSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Mini Sparkline component for KPI cards
const MiniSparkline: React.FC<{
  data: number[];
  color?: string;
  gradientId: string;
}> = ({ data, color = '#ec4899', gradientId }) => {
  if (!data || data.length < 2) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 3 - ((v - min) / range) * (h - 6),
  }));

  const linePath = generateSmoothPath(points);
  const areaPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="metrics-kpi-sparkline" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// Interactive Donut Chart for Priority & Outcomes
interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

const InteractiveDonut: React.FC<{
  segments: DonutSegment[];
  centerValue: string | number;
  centerLabel: string;
  onSelect?: (id: string) => void;
  activeId?: string | null;
}> = ({ segments, centerValue, centerLabel, onSelect, activeId }) => {
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let accumulated = 0;

  return (
    <div className="metrics-donut-svg-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={strokeWidth}
          opacity="0.5"
        />
        {total > 0 && segments.map(seg => {
          const ratio = seg.value / total;
          const strokeDash = ratio * circumference;
          const offset = accumulated * circumference;
          accumulated += ratio;
          const isSelected = activeId === seg.id;

          return (
            <circle
              key={seg.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={isSelected ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={`${Math.max(1, strokeDash)} ${circumference}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={{
                cursor: 'pointer',
                transition: 'stroke-width 0.2s ease, opacity 0.2s ease',
                opacity: activeId && !isSelected ? 0.45 : 1,
              }}
              onClick={() => onSelect?.(seg.id)}
            />
          );
        })}
      </svg>
      <div className="metrics-donut-center-label">
        <div className="metrics-donut-center-val">{total > 0 ? centerValue : 0}</div>
        <div className="metrics-donut-center-sub">{centerLabel}</div>
      </div>
    </div>
  );
};

export const Metrics: React.FC<MetricsProps> = ({
  initialMode = 'live',
  projectWorkspace = true,
  canAdminister = false,
}) => {
  const currentProject = getProjectContext();

  // Filter States
  const [windowOption, setWindowOption] = useState<WindowOption>('30d');
  const [mode, setMode] = useState<'live' | 'demo'>(initialMode);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 29);
    return utcDate(d);
  });
  const [endDate, setEndDate] = useState<string>(() => utcDate(new Date()));
  const [selectedCapability, setSelectedCapability] = useState<string>('');
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);

  // Active View & Tab
  const [activeTab, setActiveTab] = useState<TabView>(projectWorkspace ? 'triage' : 'platform');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('runs');
  const [chartRenderMode, setChartRenderMode] = useState<ChartRenderMode>('area');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);
  const [activePriorityFilter, setActivePriorityFilter] = useState<string | null>(null);

  // Data States
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [platformData, setPlatformData] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefreshSecs, setAutoRefreshSecs] = useState<number>(0);

  // Stale request guard
  const requestVersionRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load capabilities once
  useEffect(() => {
    let active = true;
    fetchCapabilities()
      .then(items => {
        if (active) setCapabilities(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Compute dates when windowOption changes
  const applyWindowOption = (opt: WindowOption) => {
    setWindowOption(opt);
    if (opt === 'custom') return;
    const end = new Date();
    const start = new Date(end);
    if (opt === '24h') start.setUTCDate(start.getUTCDate() - 1);
    else if (opt === '7d') start.setUTCDate(start.getUTCDate() - 6);
    else if (opt === '30d') start.setUTCDate(start.getUTCDate() - 29);
    else if (opt === '90d') start.setUTCDate(start.getUTCDate() - 89);
    setStartDate(utcDate(start));
    setEndDate(utcDate(end));
  };

  // Main Data Fetcher
  const loadData = useCallback(async (isSilent = false) => {
    const version = ++requestVersionRef.current;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const filters: TelemetryFilters = {
      start: windowOption === 'custom' ? startDate : undefined,
      end: windowOption === 'custom' ? endDate : undefined,
      mode,
      capability: selectedCapability || undefined,
      window: windowOption !== 'custom' ? windowOption : undefined,
    };

    try {
      if (!projectWorkspace && canAdminister) {
        // Platform view
        const data = await fetchPlatformMetrics({
          start: windowOption === 'custom' ? startDate : undefined,
          end: windowOption === 'custom' ? endDate : undefined,
          mode,
          window: windowOption !== 'custom' ? windowOption : undefined,
        });
        if (requestVersionRef.current === version) {
          setPlatformData(data);
          setLastUpdated(new Date());
        }
      } else {
        // Project view
        const data = await fetchProjectMetrics(filters);
        if (requestVersionRef.current === version) {
          setTelemetry(data);
          setLastUpdated(new Date());
        }
      }
    } catch (err: any) {
      if (requestVersionRef.current === version) {
        setError(err instanceof Error ? err.message : 'Failed to load metrics data.');
      }
    } finally {
      if (requestVersionRef.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [startDate, endDate, mode, selectedCapability, windowOption, projectWorkspace, canAdminister]);

  // Trigger load when parameters change
  useEffect(() => {
    loadData();
    return () => { requestVersionRef.current++; };
  }, [loadData]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshSecs <= 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await loadData(true);
      if (!cancelled) timer = setTimeout(refresh, autoRefreshSecs * 1000);
    };
    timer = setTimeout(refresh, autoRefreshSecs * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoRefreshSecs, loadData]);

  const summary = telemetry?.summary;
  const sre = telemetry?.sre_metrics;
  const coverage = telemetry?.coverage || platformData?.coverage;

  // Chart data calculations
  const dailyRows = useMemo(() => telemetry?.daily || [], [telemetry?.daily]);

  const getMetricValue = useCallback((row: Measurements & { tickets?: number; resolved_tickets?: number }, m: ChartMetric): number | null => {
    if (m === 'runs') return row.runs;
    if (m === 'tickets') return row.tickets ?? null;
    if (m === 'tokens') return row.reported_token_fields?.total_tokens > 0 ? row.total_tokens : null;
    if (m === 'latency') return row.run_latency.mean_duration_ms;
    if (m === 'cost') return row.estimated_cost_usd;
    return null;
  }, []);

  const chartSeries = useMemo(() => {
    return dailyRows.map(r => ({
      date: r.date,
      value: getMetricValue(r, chartMetric),
      raw: r,
    }));
  }, [dailyRows, chartMetric, getMetricValue]);

  const hasMissingChartData = chartSeries.some(point => point.value === null);

  const maxChartValue = useMemo(() => {
    const valid = chartSeries.map(s => s.value || 0);
    return Math.max(1, ...valid);
  }, [chartSeries]);

  const totalChartSum = useMemo(() => {
    return chartSeries.reduce((acc, curr) => acc + (curr.value || 0), 0);
  }, [chartSeries]);

  const peakDayInfo = useMemo(() => {
    if (chartSeries.length === 0) return null;
    let peak = chartSeries[0];
    for (const item of chartSeries) {
      if ((item.value || 0) > (peak.value || 0)) {
        peak = item;
      }
    }
    return peak;
  }, [chartSeries]);

  const inspectedDayRow = useMemo(() => {
    if (hoveredDayIndex !== null && chartSeries[hoveredDayIndex]) {
      return chartSeries[hoveredDayIndex].raw;
    }
    return dailyRows.find(r => r.date === selectedDay);
  }, [hoveredDayIndex, chartSeries, dailyRows, selectedDay]);

  // Export JSON handler
  const handleExport = () => {
    const payload = projectWorkspace ? telemetry : platformData;
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rca-metrics-${projectWorkspace ? currentProject || 'project' : 'platform'}-${startDate}-${endDate}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Sparkline data extraction
  const costSparkline = useMemo(() => dailyRows.some(row => row.estimated_cost_usd === null) ? [] : dailyRows.map(row => row.estimated_cost_usd as number), [dailyRows]);

  // Chart Metric formatting helpers
  const formatMetricAxis = (val: number): string => {
    if (chartMetric === 'cost') return `$${val.toFixed(2)}`;
    if (chartMetric === 'latency') return formatDuration(val);
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return Math.round(val).toString();
  };

  const getMetricColor = (): { stroke: string; fill: string; gradient: string } => {
    if (chartMetric === 'runs') return { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.2)', gradient: 'grad-pink' };
    if (chartMetric === 'tickets') return { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.2)', gradient: 'grad-teal' };
    if (chartMetric === 'latency') return { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.2)', gradient: 'grad-amber' };
    if (chartMetric === 'tokens') return { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.2)', gradient: 'grad-violet' };
    return { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.2)', gradient: 'grad-cyan' };
  };

  const metricPalette = getMetricColor();

  // Mouse hover tracking across SVG
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartSeries.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const paddingX = 40;
    const chartW = rect.width - paddingX * 2;
    const ratio = Math.max(0, Math.min(1, (x - paddingX) / chartW));
    const index = Math.min(chartSeries.length - 1, Math.floor(ratio * chartSeries.length));
    setHoveredDayIndex(index);
  };

  const handleSvgMouseLeave = () => {
    setHoveredDayIndex(null);
  };

  // Priority segments for Donut
  const prioritySegments: DonutSegment[] = useMemo(() => {
    if (!sre) return [];
    return [
      { id: 'P1', label: 'P1 Critical', value: sre.priority_breakdown.P1 || 0, color: '#ef4444' },
      { id: 'P2', label: 'P2 High', value: sre.priority_breakdown.P2 || 0, color: '#f59e0b' },
      { id: 'P3', label: 'P3 Medium', value: sre.priority_breakdown.P3 || 0, color: '#3b82f6' },
      { id: 'P4', label: 'P4 Low', value: sre.priority_breakdown.P4 || 0, color: '#10b981' },
    ];
  }, [sre]);

  // Investigation outcome segments
  const outcomeSegments: DonutSegment[] = useMemo(() => {
    if (!summary) return [];
    return [
      { id: 'succeeded', label: 'Succeeded', value: summary.succeeded_runs, color: '#10b981' },
      { id: 'partial', label: 'Partial', value: summary.partial_runs, color: '#f59e0b' },
      { id: 'failed', label: 'Failed / Blocked', value: summary.failed_runs, color: '#ef4444' },
      { id: 'cancelled', label: 'Cancelled', value: summary.cancelled_runs, color: '#64748b' },
    ];
  }, [summary]);

  return (
    <div className="metrics-page" role="main" aria-label="SRE and Platform Metrics">
      {/* Standard Framework Page Hero Card */}
      <header className="metrics-hero-card">
        <div className="metrics-hero-left">
          <div className="metrics-hero-icon-box" aria-hidden="true">
            <BarChart2 size={24} />
          </div>
          <div className="metrics-hero-title-group">
            <h1>
              {projectWorkspace ? 'SRE & Platform Metrics' : 'Tenant Platform Metrics'}
            </h1>
            <div className="metrics-hero-pills">
              <span className="metrics-hero-pill primary">
                <span className="metrics-hero-pill-dot" />
                {projectWorkspace ? `Project: ${currentProject || 'Default'}` : 'Collated Tenant Fleet'}
              </span>
              <span className="metrics-hero-pill live">
                <span className="metrics-hero-pill-dot" />
                {mode === 'live' ? 'Live Telemetry' : 'Demo Mode (Simulated)'}
              </span>
              <span className="metrics-hero-pill">
                Database-first Persistence
              </span>
            </div>
          </div>
        </div>

        <div className="metrics-actions">
          {lastUpdated && (
            <span className="metrics-freshness" title={lastUpdated.toISOString()}>
              <Clock size={12} />
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || refreshing}
            onClick={() => void loadData(true)}
            aria-label="Refresh metrics"
          >
            <RefreshCw size={13} className={refreshing ? 'metrics-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || (!telemetry && !platformData)}
            onClick={handleExport}
            aria-label="Export metrics report"
          >
            <ArrowDownToLine size={13} />
            Export JSON
          </button>
        </div>
      </header>

      {/* Control Toolbar */}
      <div className="metrics-toolbar" role="search" aria-label="Filter metrics">
        <div className="metrics-filter-group">
          <div className="metrics-window-pills" role="group" aria-label="Time window selection">
            {(['24h', '7d', '30d', '90d', 'custom'] as WindowOption[]).map(opt => (
              <button
                key={opt}
                type="button"
                className={`metrics-pill ${windowOption === opt ? 'active' : ''}`}
                onClick={() => applyWindowOption(opt)}
                aria-pressed={windowOption === opt}
              >
                {opt === '24h' ? '24h' : opt === '7d' ? '7d' : opt === '30d' ? '30d' : opt === '90d' ? '90d' : 'Custom'}
              </button>
            ))}
          </div>

          {windowOption === 'custom' && (
            <div className="metrics-custom-dates">
              <label>
                From
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={e => e.target.value && setStartDate(e.target.value)}
                  aria-label="Start date"
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => e.target.value && setEndDate(e.target.value)}
                  aria-label="End date"
                />
              </label>
            </div>
          )}

          {projectWorkspace && capabilities.length > 0 && (
            <select
              className="metrics-select"
              value={selectedCapability}
              onChange={e => setSelectedCapability(e.target.value)}
              aria-label="Filter by capability"
            >
              <option value="">All capabilities</option>
              {capabilities.map(cap => (
                <option key={cap.id} value={cap.id}>
                  {cap.name}
                </option>
              ))}
            </select>
          )}

          <select
            className="metrics-select"
            value={mode}
            onChange={e => setMode(e.target.value as 'live' | 'demo')}
            aria-label="Execution mode"
          >
            <option value="live">Live Runs</option>
            <option value="demo">Demo Runs</option>
          </select>
        </div>

        <div className="metrics-filter-group">
          <label style={{ fontSize: '11.5px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Auto-refresh
            <select
              className="metrics-select"
              value={autoRefreshSecs}
              onChange={e => setAutoRefreshSecs(Number(e.target.value))}
              aria-label="Auto-refresh interval"
            >
              <option value={0}>Off</option>
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </label>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="metrics-state-box" role="status">
          <RefreshCw size={24} className="metrics-spin" style={{ margin: '0 auto 12px' }} />
          <p>Aggregating operational telemetry from persistent stores…</p>
        </div>
      )}

      {error && (
        <div className="insights-error" role="alert">
          <ShieldAlert size={18} />
          <div>
            <strong>Unable to load metrics</strong>
            <p style={{ margin: '4px 0 0', fontSize: '12px' }}>{error}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadData()}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Coverage & Safeguards Notice */}
          {coverage && (coverage.truncated || coverage.legacy_runs > 0 || (summary && summary.usage_unknown_calls > 0)) && (
            <div className="metrics-coverage-box">
              <Activity size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <div>
                <strong>Telemetry Scope & Data Safeguards</strong>
                <p>
                  Analyzed {coverage.analyzed_runs} of {coverage.matched_runs} matching investigations.
                  {summary && summary.usage_unknown_calls > 0 && ` ${summary.usage_unknown_calls} calls have unrecorded tokens.`}
                  {coverage.legacy_runs > 0 && ` ${coverage.legacy_runs} older runs predate model usage tracking.`}
                  {coverage.truncated && ' Selected date range exceeded observation limit; choose a narrower window for full coverage.'}
                </p>
              </div>
            </div>
          )}

          {/* Project View KPI Strip with SVG Sparklines */}
          {projectWorkspace && summary && sre && (
            <div className="metrics-kpi-grid" aria-label="Executive operational KPIs">
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  MTTT (Mean Triage)
                  <Clock size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatDuration(sre.mttt.mean_duration_ms)}</span>
                <span className="metrics-kpi-meta">
                  95% in {formatDuration(sre.mttt.p95_duration_ms)}
                </span>
              </div>

              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  MTTR (Resolution)
                  <CheckCircle2 size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatDuration(sre.mttr.mean_duration_ms)}</span>
                <span className="metrics-kpi-meta">
                  {sre.tickets_resolved} resolved in period
                </span>
              </div>

              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  SLA Compliance
                  <ShieldCheck size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatPercent(sre.sla_compliance_rate)}</span>
                <span className="metrics-kpi-meta">
                  {(sre.ongoing_breaches ?? 0) > 0 ? (
                    <span className="metrics-badge badge-danger">{sre.ongoing_breaches} ongoing breaches</span>
                  ) : (
                    <span className="metrics-badge badge-neutral">{sre.ongoing_breaches === null ? 'SLA targets not configured' : '0 active breaches'}</span>
                  )}
                </span>
              </div>

              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  Auto-Triage Success
                  <Zap size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatPercent(sre.auto_triage.success_rate)}</span>
                <span className="metrics-kpi-meta">
                  {sre.auto_triage.succeeded} of {sre.auto_triage.runs} runs completed
                </span>
              </div>

              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  Analyst Validation
                  <TrendingUp size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatPercent(sre.analyst_validation.agreement_rate)}</span>
                <span className="metrics-kpi-meta">
                  {sre.analyst_validation.confirmed} confirmed · {sre.analyst_validation.rejected} rejected
                </span>
              </div>

              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">
                  Estimated LLM Spend
                  <Cpu size={13} className="metrics-kpi-label-icon" />
                </span>
                <span className="metrics-kpi-value">{formatCurrency(summary.estimated_cost_usd ?? summary.known_cost_usd)}</span>
                <MiniSparkline data={costSparkline} color="#f59e0b" gradientId="spark-cost" />
                <span className="metrics-kpi-meta">
                  {summary.priced_calls} priced calls (frozen rates)
                </span>
              </div>
            </div>
          )}

          {/* Platform View KPI Strip */}
          {!projectWorkspace && platformData && (
            <div className="metrics-kpi-grid" aria-label="Tenant operational totals">
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Total Projects</span>
                <span className="metrics-kpi-value">{platformData.projects.length}</span>
                <span className="metrics-kpi-meta">Scoped to tenant</span>
              </div>
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Total Investigations</span>
                <span className="metrics-kpi-value">{platformData.totals.runs.toLocaleString()}</span>
                <span className="metrics-kpi-meta">{platformData.totals.succeeded_runs} succeeded</span>
              </div>
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Tenant Spend</span>
                <span className="metrics-kpi-value">{formatCurrency(platformData.totals.estimated_cost_usd ?? platformData.totals.known_cost_usd)}</span>
                <span className="metrics-kpi-meta">Frozen model rates</span>
              </div>
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Reported Tokens</span>
                <span className="metrics-kpi-value">{platformData.totals.total_tokens.toLocaleString()}</span>
                <span className="metrics-kpi-meta">{platformData.totals.model_calls} model calls</span>
              </div>
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Mean Run Latency</span>
                <span className="metrics-kpi-value">{formatDuration(platformData.totals.overall_run_latency.mean_duration_ms)}</span>
                <span className="metrics-kpi-meta">P95: {formatDuration(platformData.totals.overall_run_latency.p95_duration_ms)}</span>
              </div>
              <div className="metrics-kpi-card">
                <span className="metrics-kpi-label">Cache Hit Rate</span>
                <span className="metrics-kpi-value">{formatPercent(platformData.totals.cache_hit_rate)}</span>
                <span className="metrics-kpi-meta">{platformData.totals.cache_hits} hits · {platformData.totals.cache_misses} misses</span>
              </div>
            </div>
          )}

          {/* Proper Interactive SVG Operational Trends Chart (Project View) */}
          {projectWorkspace && (
            <section className="metrics-section" aria-label="Operational trend over time">
              <div className="metrics-section-heading">
                <div>
                  <h2>Operational Trends</h2>
                  <p>Continuous telemetry curve with granular day-by-day inspections and hover crosshairs.</p>
                </div>
                <div className="metrics-chart-header-controls">
                  <div className="metrics-chart-type-toggle" role="group" aria-label="Chart mode">
                    <button
                      type="button"
                      className={`metrics-chart-type-btn ${chartRenderMode === 'area' ? 'active' : ''}`}
                      onClick={() => setChartRenderMode('area')}
                      aria-pressed={chartRenderMode === 'area'}
                      title="Area wave curve"
                    >
                      <LineChart size={13} />
                      Curve
                    </button>
                    <button
                      type="button"
                      className={`metrics-chart-type-btn ${chartRenderMode === 'bar' ? 'active' : ''}`}
                      onClick={() => setChartRenderMode('bar')}
                      aria-pressed={chartRenderMode === 'bar'}
                      title="Bar columns"
                    >
                      <BarChart2 size={13} />
                      Bars
                    </button>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                    Metric
                    <select
                      className="metrics-select"
                      value={chartMetric}
                      onChange={e => setChartMetric(e.target.value as ChartMetric)}
                      aria-label="Select trend metric"
                    >
                      <option value="runs">Investigations</option>
                      <option value="tickets">Tickets Ingested</option>
                      <option value="latency">Average Run Duration</option>
                      <option value="tokens">Reported Tokens</option>
                      <option value="cost">Estimated Cost (USD)</option>
                    </select>
                  </label>
                </div>
              </div>

              {dailyRows.length === 0 ? (
                <div className="insights-no-runs">
                  <BarChart2 size={28} />
                  <h3>No activity recorded in this period</h3>
                  <p>Trigger an investigation or choose a broader time range.</p>
                </div>
              ) : (
                <>
                  {/* Aggregated Quick-Stats Strip */}
                  {!hasMissingChartData && chartMetric !== 'latency' && <div className="metrics-chart-summary-strip">
                    <div className="metrics-chart-summary-item">
                      <span className="metrics-chart-summary-label">Window Total</span>
                      <span className="metrics-chart-summary-val">{formatMetricAxis(totalChartSum)}</span>
                    </div>
                    <div className="metrics-chart-summary-item">
                      <span className="metrics-chart-summary-label">Daily Average</span>
                      <span className="metrics-chart-summary-val">{formatMetricAxis(totalChartSum / Math.max(1, chartSeries.length))}</span>
                    </div>
                    {peakDayInfo && (
                      <div className="metrics-chart-summary-item">
                        <span className="metrics-chart-summary-label">Peak Velocity ({peakDayInfo.date.slice(5)})</span>
                        <span className="metrics-chart-summary-val">{formatMetricAxis(peakDayInfo.value || 0)}</span>
                      </div>
                    )}
                  </div>

                  }
                  {hasMissingChartData && <p>Some daily measurements are unavailable. Review recorded values in the table below.</p>}
                  {/* SVG Chart Area */}
                  {!hasMissingChartData && <div className="metrics-svg-chart-wrap">
                    {(() => {
                      const svgWidth = 860;
                      const svgHeight = 220;
                      const padTop = 20;
                      const padBottom = 30;
                      const padLeft = 60;
                      const padRight = 30;
                      const plotW = svgWidth - padLeft - padRight;
                      const plotH = svgHeight - padTop - padBottom;

                      const count = chartSeries.length;
                      const stepX = count > 1 ? plotW / (count - 1) : plotW;

                      const points = chartSeries.map((s, i) => {
                        const val = s.value || 0;
                        const y = padTop + plotH - (val / maxChartValue) * plotH;
                        const x = padLeft + (count > 1 ? i * stepX : plotW / 2);
                        return { x, y, ...s };
                      });

                      const lineD = generateSmoothPath(points);
                      const areaD = count > 1 && points.length > 0
                        ? `${lineD} L ${points[points.length - 1].x} ${padTop + plotH} L ${points[0].x} ${padTop + plotH} Z`
                        : '';

                      const hoveredPoint = hoveredDayIndex !== null ? points[hoveredDayIndex] : null;

                      // Y Ticks (4 levels)
                      const yTicks = [1, 0.66, 0.33, 0];

                      return (
                        <>
                          <svg
                            ref={svgRef}
                            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                            className="metrics-svg-chart"
                            onMouseMove={handleSvgMouseMove}
                            onMouseLeave={handleSvgMouseLeave}
                            role="img"
                            aria-label="Interactive operational trend graph"
                          >
                            <defs>
                              <linearGradient id="grad-pink" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ec4899" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="grad-teal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="grad-amber" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="grad-violet" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                              </linearGradient>
                              <linearGradient id="grad-cyan" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                              </linearGradient>
                              <filter id="point-glow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge>
                                  <feMergeNode in="blur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>

                            {/* Horizontal Gridlines & Y-Axis Labels */}
                            {yTicks.map((ratio, idx) => {
                              const y = padTop + plotH - ratio * plotH;
                              const val = ratio * maxChartValue;
                              return (
                                <g key={idx}>
                                  <line
                                    x1={padLeft}
                                    y1={y}
                                    x2={svgWidth - padRight}
                                    y2={y}
                                    stroke="var(--line)"
                                    strokeDasharray="4 4"
                                    strokeOpacity="0.6"
                                  />
                                  <text
                                    x={padLeft - 10}
                                    y={y + 3.5}
                                    fill="var(--muted)"
                                    fontSize="10"
                                    textAnchor="end"
                                    fontFamily="var(--font-mono, monospace)"
                                  >
                                    {formatMetricAxis(val)}
                                  </text>
                                </g>
                              );
                            })}

                            {/* X Axis Baseline */}
                            <line
                              x1={padLeft}
                              y1={padTop + plotH}
                              x2={svgWidth - padRight}
                              y2={padTop + plotH}
                              stroke="var(--line)"
                              strokeWidth="1.5"
                            />

                            {/* Chart Data: Area Mode vs Bar Mode */}
                            {chartRenderMode === 'area' ? (
                              <>
                                <path d={areaD} fill={`url(#${metricPalette.gradient})`} />
                                <path
                                  d={lineD}
                                  fill="none"
                                  stroke={metricPalette.stroke}
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                {points.map((p, idx) => (
                                  <circle
                                    key={idx}
                                    cx={p.x}
                                    cy={p.y}
                                    r={hoveredDayIndex === idx ? 5 : (p.value ? 2.5 : 1)}
                                    fill={hoveredDayIndex === idx ? '#ffffff' : metricPalette.stroke}
                                    stroke={metricPalette.stroke}
                                    strokeWidth={hoveredDayIndex === idx ? 2 : 1}
                                    filter={hoveredDayIndex === idx ? 'url(#point-glow)' : undefined}
                                    style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                                    onClick={() => setSelectedDay(p.date)}
                                  />
                                ))}
                              </>
                            ) : (
                              /* Column / Bar Render Mode */
                              points.map((p, idx) => {
                                const barW = Math.max(6, Math.min(24, stepX * 0.65));
                                const barH = Math.max(2, (padTop + plotH) - p.y);
                                const isHovered = hoveredDayIndex === idx;
                                return (
                                  <rect
                                    key={idx}
                                    x={p.x - barW / 2}
                                    y={p.y}
                                    width={barW}
                                    height={barH}
                                    rx={4}
                                    ry={4}
                                    fill={metricPalette.stroke}
                                    opacity={isHovered ? 1 : 0.75}
                                    style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                                    onClick={() => setSelectedDay(p.date)}
                                  />
                                );
                              })
                            )}

                            {/* Crosshair Cursor Tracking */}
                            {hoveredPoint && (
                              <g pointerEvents="none">
                                <line
                                  x1={hoveredPoint.x}
                                  y1={padTop}
                                  x2={hoveredPoint.x}
                                  y2={padTop + plotH}
                                  stroke={metricPalette.stroke}
                                  strokeDasharray="3 3"
                                  strokeWidth="1.5"
                                  opacity="0.85"
                                />
                                <circle
                                  cx={hoveredPoint.x}
                                  cy={hoveredPoint.y}
                                  r="6"
                                  fill="#ffffff"
                                  stroke={metricPalette.stroke}
                                  strokeWidth="3"
                                  filter="url(#point-glow)"
                                />
                              </g>
                            )}

                            {/* X-Axis Dates (sample evenly) */}
                            {points.map((p, idx) => {
                              const showLabel = count <= 14 || idx % Math.ceil(count / 7) === 0 || idx === count - 1;
                              if (!showLabel) return null;
                              return (
                                <text
                                  key={idx}
                                  x={p.x}
                                  y={padTop + plotH + 18}
                                  fill="var(--muted)"
                                  fontSize="9.5"
                                  textAnchor="middle"
                                  fontFamily="var(--font-mono, monospace)"
                                >
                                  {p.date.slice(5)}
                                </text>
                              );
                            })}
                          </svg>

                          {/* Interactive Hover Tooltip */}
                          {hoveredPoint && (
                            <div
                              className="metrics-chart-hover-hud"
                              style={{
                                left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                                top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                              }}
                            >
                              <div className="metrics-chart-hud-date">{hoveredPoint.date}</div>
                              <div className="metrics-chart-hud-row">
                                <span>{chartMetric.toUpperCase()}:</span>
                                <strong>{formatMetricAxis(hoveredPoint.value || 0)}</strong>
                              </div>
                              <div className="metrics-chart-hud-row" style={{ fontSize: '10.5px' }}>
                                <span>Runs: {hoveredPoint.raw.runs} · Tickets: {hoveredPoint.raw.tickets ?? 0}</span>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  }
                  <details className="metrics-table-wrap" open={hasMissingChartData}>
                    <summary>Daily measurements</summary>
                    <table className="metrics-table">
                      <thead><tr><th scope="col">Date (UTC)</th><th scope="col">{chartMetric}</th></tr></thead>
                      <tbody>{chartSeries.map(point => <tr key={point.date}><th scope="row"><button type="button" className="btn btn-secondary" onClick={() => setSelectedDay(point.date)}>{point.date}</button></th><td>{point.value === null ? 'Not measured' : formatMetricAxis(point.value)}</td></tr>)}</tbody>
                    </table>
                  </details>
                  {/* Granular Day Inspection Box */}
                  <div className="metrics-chart-inspection" aria-live="polite">
                    {inspectedDayRow ? (
                      <>
                        <strong>Observation on {inspectedDayRow.date}:</strong>
                        <span>{inspectedDayRow.runs} investigations</span>
                        <span>{inspectedDayRow.tickets ?? 0} ingested tickets</span>
                        <span>{formatDuration(inspectedDayRow.run_latency.mean_duration_ms)} mean duration</span>
                        <span>{inspectedDayRow.total_tokens.toLocaleString()} tokens</span>
                        <span>{formatCurrency(inspectedDayRow.estimated_cost_usd)} spend</span>
                      </>
                    ) : (
                      <span>Hover along the curve or click any node to inspect that date's granular telemetry.</span>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Interactive Drill-down Tabs */}
          <div className="metrics-tabs" role="tablist" aria-label="Metrics breakdown tabs">
            {projectWorkspace ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'triage'}
                  className={`metrics-tab ${activeTab === 'triage' ? 'active' : ''}`}
                  onClick={() => setActiveTab('triage')}
                >
                  <ShieldCheck size={14} />
                  Triage & SLAs
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'agents'}
                  className={`metrics-tab ${activeTab === 'agents' ? 'active' : ''}`}
                  onClick={() => setActiveTab('agents')}
                >
                  <Layers size={14} />
                  Agent Execution & Latency
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'tokens'}
                  className={`metrics-tab ${activeTab === 'tokens' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tokens')}
                >
                  <Cpu size={14} />
                  LLM Economics & Tokens
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'tools'}
                  className={`metrics-tab ${activeTab === 'tools' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tools')}
                >
                  <Wrench size={14} />
                  Runtime Tool Reliability
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'feedback'}
                  className={`metrics-tab ${activeTab === 'feedback' ? 'active' : ''}`}
                  onClick={() => setActiveTab('feedback')}
                >
                  <Activity size={14} />
                  Team Feedback
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'platform'}
                  className={`metrics-tab ${activeTab === 'platform' ? 'active' : ''}`}
                  onClick={() => setActiveTab('platform')}
                >
                  <BarChart2 size={14} />
                  Cross-Project Comparison
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'tools'}
                  className={`metrics-tab ${activeTab === 'tools' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tools')}
                >
                  <Wrench size={14} />
                  Tenant Connector Telemetry
                </button>
              </>
            )}
          </div>

          {/* TAB 1: Triage & SLAs with Donut Chart and SLA Progress Bars */}
          {activeTab === 'triage' && sre && (
            <div className="metrics-split-grid">
              <section className="metrics-section">
                <h2>Priority Breakdown & Distribution</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Interactive incident distribution categorized by urgency level.
                </p>

                <div className="metrics-donut-layout">
                  <InteractiveDonut
                    segments={prioritySegments}
                    centerValue={sre.tickets_total}
                    centerLabel="Total Tickets"
                    activeId={activePriorityFilter}
                    onSelect={id => setActivePriorityFilter(activePriorityFilter === id ? null : id)}
                  />

                  <div className="metrics-donut-legend">
                    {prioritySegments.map(seg => {
                      const count = seg.value;
                      const share = sre.tickets_total > 0 ? (count / sre.tickets_total) * 100 : 0;
                      const isSelected = activePriorityFilter === seg.id;

                      return (
                        <div
                          key={seg.id}
                          className={`metrics-donut-legend-item ${isSelected ? 'active' : ''}`}
                          onClick={() => setActivePriorityFilter(isSelected ? null : seg.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActivePriorityFilter(isSelected ? null : seg.id); } }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span className="metrics-legend-color-dot" style={{ backgroundColor: seg.color }} />
                            <strong>{seg.label}</strong>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{count}</span>
                            <span className="metrics-badge badge-neutral">{share.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p>SLA compliance uses configured project targets. Missing targets remain unmeasured.</p>

              </section>

              <section className="metrics-section">
                <h2>Queue & Resolution Velocity</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Triage measures the first completed local queue interval. Resolution requires recorded source incident start and resolution timestamps.
                </p>
                <div className="metrics-table-wrap">
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Mean</th>
                        <th>95th Percentile</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>Time to Initial Triage (MTTT)</th>
                        <td>{formatDuration(sre.mttt.mean_duration_ms)}</td>
                        <td>{formatDuration(sre.mttt.p95_duration_ms)}</td>
                        <td>
                          <span className="metrics-badge badge-success">Completed</span>
                        </td>
                      </tr>
                      <tr>
                        <th>Time to Resolution (MTTR)</th>
                        <td>{formatDuration(sre.mttr.mean_duration_ms)}</td>
                        <td>{formatDuration(sre.mttr.p95_duration_ms)}</td>
                        <td>
                          <span className="metrics-badge badge-neutral">Resolved: {sre.tickets_resolved}</span>
                        </td>
                      </tr>
                      <tr>
                        <th>Active Backlog</th>
                        <td colSpan={2}>{sre.tickets_active} unresolved tickets</td>
                        <td>
                          {(sre.ongoing_breaches ?? 0) > 0 ? (
                            <span className="metrics-badge badge-danger">{sre.ongoing_breaches} breached</span>
                          ) : (
                            <span className="metrics-badge badge-neutral">{sre.ongoing_breaches === null ? 'SLA targets not configured' : 'No recorded breaches'}</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Auto-Triage Completion Callout */}
                <div style={{ marginTop: '24px', padding: '16px', background: 'var(--card-subtle)', borderRadius: '8px', border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px' }}>Autonomous Triage Execution</strong>
                    <span className="metrics-badge badge-success">
                      {formatPercent(sre.auto_triage.success_rate)} Complete
                    </span>
                  </div>
                  <div className="metrics-sla-bar-track">
                    <div
                      className="metrics-sla-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, (sre.auto_triage.success_rate ?? 0) * 100))}%`,
                        background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>
                    {sre.auto_triage.succeeded} of {sre.auto_triage.runs} auto-triage investigations reached full completion.
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: Agent Execution & Stage Latency Graphs */}
          {activeTab === 'agents' && telemetry && (
            <div className="metrics-split-grid">
              <section className="metrics-section">
                <h2>Investigation Outcomes</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Execution status ratio across {summary?.runs} total runs.
                </p>

                <div className="metrics-donut-layout">
                  <InteractiveDonut
                    segments={outcomeSegments}
                    centerValue={summary?.runs || 0}
                    centerLabel="Total Runs"
                  />

                  <div className="metrics-donut-legend">
                    {outcomeSegments.map(seg => (
                      <div key={seg.id} className="metrics-donut-legend-item">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="metrics-legend-color-dot" style={{ backgroundColor: seg.color }} />
                          <span>{seg.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong>{seg.value}</strong>
                          <span className="metrics-badge badge-neutral">
                            {formatPercent(summary?.runs ? seg.value / summary.runs : 0)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="metrics-section">
                <h2>Agent timing by stage (mean and P95)</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Horizontal duration comparison measured per orchestrator and specialist stage.
                </p>

                {telemetry.agents.length === 0 ? (
                  <div className="insights-no-runs">
                    <Clock size={24} />
                    <p>No stage measurements recorded yet.</p>
                  </div>
                ) : (
                  <div className="metrics-stage-bars">
                    {telemetry.agents.map(agent => {
                      const maxMs = 60000; // 60s reference max
                      const meanMs = agent.mean_duration_ms ?? 0;
                      const p95Ms = agent.p95_duration_ms ?? 0;
                      const meanRatio = Math.min(100, Math.max(0, (meanMs / maxMs) * 100));
                      const p95Ratio = Math.min(100, Math.max(0, (p95Ms / maxMs) * 100));

                      return (
                        <div key={agent.name} className="metrics-stage-row">
                          <div className="metrics-stage-meta">
                            <strong>{labelClean(agent.name)}</strong>
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                              {agent.calls} calls · {agent.errors} errors
                            </span>
                          </div>
                          <div className="metrics-stage-dual-bar">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '10px', width: '32px', color: 'var(--muted)' }}>Mean</span>
                              <div className="metrics-stage-track" style={{ flex: 1 }}>
                                <div className="metrics-stage-fill-mean" style={{ width: `${meanRatio}%` }} />
                              </div>
                              <span style={{ fontSize: '10.5px', width: '45px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {formatDuration(agent.mean_duration_ms)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '10px', width: '32px', color: 'var(--muted)' }}>P95</span>
                              <div className="metrics-stage-track" style={{ flex: 1 }}>
                                <div className="metrics-stage-fill-p95" style={{ width: `${p95Ratio}%` }} />
                              </div>
                              <span style={{ fontSize: '10.5px', width: '45px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {formatDuration(agent.p95_duration_ms)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 3: LLM Economics & Tokens */}
          {activeTab === 'tokens' && telemetry && (
            <div className="metrics-split-grid">
              <section className="metrics-section">
                <h2>Model Usage & Cost Breakdown</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Costs calculated using administrator prices frozen at run creation.
                </p>

                {/* Stacked Token Category Bar */}
                {summary && summary.total_tokens > 0 && (
                  <div style={{ marginBottom: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                      <span><strong>Token Allocation</strong> ({summary.total_tokens.toLocaleString()} total)</span>
                      <span style={{ color: 'var(--muted)' }}>Prompt Cache vs Fresh I/O</span>
                    </div>
                    <div className="metrics-stacked-bar-track">
                      {summary.cached_input_tokens > 0 && (
                        <div
                          className="metrics-stacked-bar-seg cached"
                          style={{ width: `${(summary.cached_input_tokens / summary.total_tokens) * 100}%` }}
                          title={`Cached: ${summary.cached_input_tokens.toLocaleString()}`}
                        />
                      )}
                      <div
                        className="metrics-stacked-bar-seg input"
                        style={{
                          width: `${((summary.input_tokens - summary.cached_input_tokens) / summary.total_tokens) * 100}%`,
                        }}
                        title={`Fresh Input: ${(summary.input_tokens - summary.cached_input_tokens).toLocaleString()}`}
                      />
                      <div
                        className="metrics-stacked-bar-seg output"
                        style={{ width: `${(summary.output_tokens / summary.total_tokens) * 100}%` }}
                        title={`Output: ${summary.output_tokens.toLocaleString()}`}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#10b981' }} />
                        Cached ({formatPercent(summary.cached_input_tokens / summary.total_tokens)})
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#8b5cf6' }} />
                        Fresh Input
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#ec4899' }} />
                        Output
                      </span>
                    </div>
                  </div>
                )}

                <div className="metrics-table-wrap">
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Calls</th>
                        <th>Input Tokens</th>
                        <th>Output Tokens</th>
                        <th>Thinking</th>
                        <th>Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetry.by_model.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                            No model calls recorded in period.
                          </td>
                        </tr>
                      ) : (
                        telemetry.by_model.map(row => (
                          <tr key={row.model}>
                            <th>{row.model}</th>
                            <td>{row.model_calls}</td>
                            <td>{row.reported_token_fields?.input_tokens > 0 ? row.input_tokens.toLocaleString() : '—'}</td>
                            <td>{row.reported_token_fields?.output_tokens > 0 ? row.output_tokens.toLocaleString() : '—'}</td>
                            <td>{row.reported_token_fields?.thinking_tokens > 0 ? row.thinking_tokens.toLocaleString() : '—'}</td>
                            <td>{formatCurrency(row.estimated_cost_usd)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="metrics-section">
                <h2>Prompt Caching & Efficiency</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Savings from provider-level model prompt cache hits.
                </p>
                <div className="metrics-table-wrap">
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>Dimension</th>
                        <th>Measurement</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>Cache Hit Rate</th>
                        <td>
                          <strong>{formatPercent(summary?.cache_hit_rate)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <th>Cache Hits</th>
                        <td>{summary?.cache_hits.toLocaleString()} calls</td>
                      </tr>
                      <tr>
                        <th>Cache Misses</th>
                        <td>{summary?.cache_misses.toLocaleString()} calls</td>
                      </tr>
                      <tr>
                        <th>Cached Input Tokens</th>
                        <td>{summary?.cached_input_tokens.toLocaleString() ?? 'Unrecorded'}</td>
                      </tr>
                      <tr>
                        <th>Unmeasured Cache Calls</th>
                        <td>{summary?.cache_unknown_calls.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB 4: Runtime Tool Reliability */}
          {activeTab === 'tools' && (
            <section className="metrics-section">
              <h2>Runtime Tool Execution Telemetry</h2>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                Derived from actual production tool executions during investigations (excluding offline probes).
              </p>
              <div className="metrics-table-wrap">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Tool / Connector</th>
                      <th>Total Calls</th>
                      <th>Errors</th>
                      <th>Cancelled</th>
                      <th>Mean Duration</th>
                      <th>P95 Latency</th>
                      <th>Reliability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((projectWorkspace ? telemetry?.tools : platformData?.tools) || []).length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                          No tool execution events recorded in this period.
                        </td>
                      </tr>
                    ) : (
                      ((projectWorkspace ? telemetry?.tools : platformData?.tools) || []).map(tool => {
                        const errorRate = tool.calls > 0 ? (tool.errors / tool.calls) * 100 : 0;
                        const reliability = 100 - errorRate;
                        return (
                          <tr key={tool.name}>
                            <th>{labelClean(tool.name)}</th>
                            <td>{tool.calls.toLocaleString()}</td>
                            <td>{tool.errors}</td>
                            <td>{tool.cancelled}</td>
                            <td>{formatDuration(tool.mean_duration_ms)}</td>
                            <td>{formatDuration(tool.p95_duration_ms)}</td>
                            <td>
                              <span
                                className={`metrics-badge ${
                                  reliability >= 98
                                    ? 'badge-success'
                                    : reliability >= 90
                                    ? 'badge-warning'
                                    : 'badge-danger'
                                }`}
                              >
                                {reliability.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* TAB 5: Team Feedback */}
          {activeTab === 'feedback' && telemetry && (
            <div className="metrics-split-grid">
              <section className="metrics-section">
                <h2>Operator Sentiment & Reviews</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Direct feedback submitted by investigation authors.
                </p>
                <div className="metrics-table-wrap">
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>Rating</th>
                        <th>Investigations</th>
                        <th>Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>
                          <span className="metrics-badge badge-success">Helpful / Useful</span>
                        </th>
                        <td>{telemetry.feedback?.helpful ?? 0}</td>
                        <td>
                          {formatPercent(
                            (telemetry.feedback?.helpful || 0) /
                              (telemetry.feedback?.reviewed_runs || 1)
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>
                          <span className="metrics-badge badge-warning">Needs Work</span>
                        </th>
                        <td>{telemetry.feedback?.needs_work ?? 0}</td>
                        <td>
                          {formatPercent(
                            (telemetry.feedback?.needs_work || 0) /
                              (telemetry.feedback?.reviewed_runs || 1)
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>Unreviewed</th>
                        <td>{telemetry.feedback?.unreviewed_runs ?? 0}</td>
                        <td>—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="metrics-section">
                <h2>Hypothesis Calibration</h2>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                  Analyst agreement on auto-triage findings.
                </p>
                <div className="metrics-table-wrap">
                  <table className="metrics-table">
                    <thead>
                      <tr>
                        <th>State</th>
                        <th>Findings</th>
                        <th>Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>
                          <span className="metrics-badge badge-success">CONFIRMED</span>
                        </th>
                        <td>{sre?.analyst_validation.confirmed ?? 0}</td>
                        <td>{formatPercent(sre?.analyst_validation.agreement_rate)}</td>
                      </tr>
                      <tr>
                        <th>
                          <span className="metrics-badge badge-danger">REJECTED</span>
                        </th>
                        <td>{sre?.analyst_validation.rejected ?? 0}</td>
                        <td>
                          {formatPercent(
                            sre?.analyst_validation.agreement_rate !== null && sre?.analyst_validation.agreement_rate !== undefined
                              ? 1 - sre.analyst_validation.agreement_rate
                              : null
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>Candidate / Unreviewed</th>
                        <td>{sre?.analyst_validation.candidate ?? 0}</td>
                        <td>—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB 6: Platform Fleet (Cross-Project Comparison) */}
          {activeTab === 'platform' && platformData && (
            <section className="metrics-section">
              <h2>Cross-Project Comparison</h2>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                Authorized tenant-wide metrics by project with relative volume and spend distribution.
              </p>

              <div className="metrics-table-wrap">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Investigations</th>
                      <th>Success %</th>
                      <th>Tokens</th>
                      <th>Spend (USD)</th>
                      <th>Mean Latency</th>
                      <th>P95 Latency</th>
                      <th>Active Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformData.projects.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                          No projects recorded.
                        </td>
                      </tr>
                    ) : (
                      platformData.projects.map(p => {
                        const successRate = p.runs > 0 ? (p.succeeded_runs / p.runs) * 100 : 0;
                        return (
                          <tr key={p.project_id}>
                            <th>
                              {p.project_name}
                              <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{p.project_id}</div>
                            </th>
                            <td>{p.runs.toLocaleString()}</td>
                            <td>
                              <span
                                className={`metrics-badge ${
                                  successRate >= 90
                                    ? 'badge-success'
                                    : successRate >= 75
                                    ? 'badge-warning'
                                    : 'badge-danger'
                                }`}
                              >
                                {successRate.toFixed(1)}%
                              </span>
                            </td>
                            <td>{p.total_tokens.toLocaleString()}</td>
                            <td>{formatCurrency(p.estimated_cost_usd)}</td>
                            <td>{formatDuration(p.mean_duration_ms)}</td>
                            <td>{formatDuration(p.p95_duration_ms)}</td>
                            <td>{p.active_tickets}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Telemetry Safeguard Notes */}
          {coverage?.notes && coverage.notes.length > 0 && (
            <details className="insights-notes" style={{ marginTop: '24px' }}>
              <summary>Measurement definitions & telemetry accounting rules</summary>
              <ul>
                {coverage.notes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
              <p>
                {coverage.events_analyzed?.toLocaleString()} saved execution events analyzed. All measurements adhere to database-first persistence.
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
};
