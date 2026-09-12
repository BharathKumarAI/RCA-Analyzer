import React, { useEffect, useMemo, useState } from 'react';
import {
  Sliders,
  RefreshCw,
  Search,
  Filter,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Lock,
  Unlock,
  Key,
  Database,
  Cpu,
  Server,
  Layers,
  Activity,
  Terminal,
  FileText,
  ChevronDown,
  ChevronRight,
  X,
  ExternalLink,
  Shield,
  Clock,
  Sparkles,
  Code,
  Info,
  Check,
  ToggleLeft,
  ToggleRight,
  HelpCircle,
  Radio,
  BookOpen,
  GitBranch,
  CheckSquare
} from 'lucide-react';
import {
  defineParameter,
  fetchParameters,
  fetchPrincipal,
  resetParameterOverride,
  setParameterOverride,
  ApiError
} from '../services/api';
import type { ParameterDefinitionRow, Principal, ConnectorValueType } from '../types/api';
import { parseNumericValue } from '../utils/parameterValues';

// Format helper
const parameterKey = (item: ParameterDefinitionRow) => `${item.tool}.${item.variable_name}`;

const displayValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatValueType = (valueType: ParameterDefinitionRow['value_type']) =>
  valueType.replace(/_/g, ' ');

// Known tools metadata registry
interface ToolMeta {
  displayName: string;
  category: string;
  description: string;
  icon: React.ReactNode;
}

const TOOL_REGISTRY: Record<string, ToolMeta> = {
  runtime: {
    displayName: 'Runtime Engine',
    category: 'System & Execution',
    description: 'Execution concurrency limits, evidence ceilings, timeouts, and operational thresholds.',
    icon: <Cpu size={18} />,
  },
  itsm: {
    displayName: 'ITSM / Jira Service',
    category: 'Incident & Ticketing',
    description: 'Issue tracker connector parameters, transition endpoints, timeout, and authentication.',
    icon: <Layers size={18} />,
  },
  log_search: {
    displayName: 'Log Search / Splunk',
    category: 'Observability & Logs',
    description: 'Search query windows, result caps, log analytics transport, and endpoints.',
    icon: <Search size={18} />,
  },
  confluence: {
    displayName: 'Confluence Knowledge',
    category: 'Documentation & Wiki',
    description: 'Atlassian wiki connector, documentation spaces, and runbook ingestion settings.',
    icon: <BookOpen size={18} />,
  },
  kubernetes: {
    displayName: 'Kubernetes Cluster',
    category: 'Containers & Clusters',
    description: 'Cluster API endpoints, namespace selectors, pod event correlation thresholds.',
    icon: <Server size={18} />,
  },
  kafka: {
    displayName: 'Apache Kafka Stream',
    category: 'Messaging & Events',
    description: 'Broker cluster bootstrap addresses, consumer group offsets, and lag tolerances.',
    icon: <Radio size={18} />,
  },
  oracle: {
    displayName: 'Oracle Database',
    category: 'Data & Storage',
    description: 'Enterprise relational database connector, connection pools, and query timeouts.',
    icon: <Database size={18} />,
  },
  gitlab: {
    displayName: 'GitLab DevSecOps',
    category: 'Code & CI/CD',
    description: 'Repository commit lineage, deployment pipeline hooks, and MR review settings.',
    icon: <GitBranch size={18} />,
  },
  signalfx: {
    displayName: 'SignalFx Telemetry',
    category: 'Metrics & APM',
    description: 'Real-time metrics streaming, detector query resolution, and chart thresholds.',
    icon: <Activity size={18} />,
  },
  qtest: {
    displayName: 'qTest QA Platform',
    category: 'Quality & Testing',
    description: 'Test run results, execution suite mappings, and release cycle validation.',
    icon: <CheckSquare size={18} />,
  },
  unix: {
    displayName: 'Unix / Linux Host',
    category: 'Infrastructure & OS',
    description: 'System diagnostics, remote SSH connection limits, and shell telemetry limits.',
    icon: <Terminal size={18} />,
  },
  jira: {
    displayName: 'Jira Native Provider',
    category: 'Incident & Ticketing',
    description: 'Native Jira REST API connectivity parameters and operational bounds.',
    icon: <Layers size={18} />,
  },
  splunk: {
    displayName: 'Splunk Native Provider',
    category: 'Observability & Logs',
    description: 'Native Splunk search jobs, REST API credentials, and dispatch settings.',
    icon: <Search size={18} />,
  },
};

function getToolMeta(toolName: string): ToolMeta {
  if (TOOL_REGISTRY[toolName.toLowerCase()]) {
    return TOOL_REGISTRY[toolName.toLowerCase()];
  }
  // Generic fallback
  const formatted = toolName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
  return {
    displayName: formatted,
    category: 'Integration Connector',
    description: `Configured parameters and operational settings for ${formatted}.`,
    icon: <Sliders size={18} />,
  };
}

export function ParameterStudio() {
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // User Principal & Roles
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canOverride, setCanOverride] = useState(false);

  // Filters & Organization
  const [selectedTool, setSelectedTool] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({});

  // Inspector / Drawer State
  const [activeParam, setActiveParam] = useState<ParameterDefinitionRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<'override' | 'platform_default' | 'details'>('override');

  // Edit fields for Project Override
  const [editOverrideValue, setEditOverrideValue] = useState<string>('');
  const [editOverrideBool, setEditOverrideBool] = useState<boolean>(false);
  const [editOverrideNumber, setEditOverrideNumber] = useState<number>(0);
  const [overrideJsonError, setOverrideJsonError] = useState<string | null>(null);

  // Edit fields for Platform Default
  const [editDefaultValue, setEditDefaultValue] = useState<string>('');
  const [editDefaultBool, setEditDefaultBool] = useState<boolean>(false);
  const [editDefaultNumber, setEditDefaultNumber] = useState<number>(0);
  const [editDescription, setEditDescription] = useState<string>('');
  const [editAllowOverride, setEditAllowOverride] = useState<boolean>(false);
  const [defaultJsonError, setDefaultJsonError] = useState<string | null>(null);

  // Load Data
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchParameters();
      setParameters(items);
      if (activeParam) {
        const updated = items.find(i => parameterKey(i) === parameterKey(activeParam));
        if (updated) setActiveParam(updated);
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to load parameter catalog from deployment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    fetchPrincipal()
      .then(p => {
        setPrincipal(p);
        const roles = p.roles || [];
        const isAdm = roles.includes('PLATFORM_ADMIN');
        setIsPlatformAdmin(isAdm);
        setCanOverride(isAdm || roles.includes('TENANT_ADMIN') || roles.includes('PROJECT_OWNER'));
      })
      .catch(() => {
        setIsPlatformAdmin(false);
        setCanOverride(false);
      });
  }, []);

  // Sync edit state whenever activeParam changes
  useEffect(() => {
    if (!activeParam) return;
    setOverrideJsonError(null);
    setDefaultJsonError(null);

    // Populate Override fields
    if (activeParam.value_type === 'boolean') {
      setEditOverrideBool(Boolean(activeParam.effective_value));
    } else if (activeParam.value_type === 'integer' || activeParam.value_type === 'number') {
      setEditOverrideNumber(Number(activeParam.effective_value) || 0);
      setEditOverrideValue(String(activeParam.effective_value ?? '0'));
    } else {
      setEditOverrideValue(displayValue(activeParam.effective_value));
    }

    // Populate Platform Default fields
    setEditDescription(activeParam.description || '');
    setEditAllowOverride(Boolean(activeParam.allow_project_override));
    if (activeParam.value_type === 'boolean') {
      setEditDefaultBool(Boolean(activeParam.default_value));
    } else if (activeParam.value_type === 'integer' || activeParam.value_type === 'number') {
      setEditDefaultNumber(Number(activeParam.default_value) || 0);
      setEditDefaultValue(String(activeParam.default_value ?? '0'));
    } else {
      setEditDefaultValue(displayValue(activeParam.default_value));
    }

    // Default tab based on permissions
    if (activeParam.allow_project_override) {
      setDrawerTab('override');
    } else if (isPlatformAdmin) {
      setDrawerTab('platform_default');
    } else {
      setDrawerTab('details');
    }
  }, [activeParam, isPlatformAdmin]);

  // Group parameters by tool
  const toolsMap = useMemo(() => {
    const map = new Map<string, ParameterDefinitionRow[]>();
    for (const item of parameters) {
      const list = map.get(item.tool) || [];
      list.push(item);
      map.set(item.tool, list);
    }
    return map;
  }, [parameters]);

  const uniqueTools = useMemo(() => {
    return Array.from(toolsMap.keys()).sort();
  }, [toolsMap]);

  // Overall Statistics
  const stats = useMemo(() => {
    const total = parameters.length;
    const toolsCount = uniqueTools.length;
    const overridden = parameters.filter(p => p.override_revision !== null && p.override_revision > 0).length;
    const platformEnforced = parameters.filter(p => !p.allow_project_override).length;
    return { total, toolsCount, overridden, platformEnforced };
  }, [parameters, uniqueTools]);

  // Filtered parameters
  const filteredParameters = useMemo(() => {
    return parameters.filter(item => {
      // Tool filter
      if (selectedTool !== 'ALL' && item.tool !== selectedTool) {
        return false;
      }
      // Value type filter
      if (typeFilter !== 'ALL' && item.value_type !== typeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter === 'OVERRIDDEN' && (!item.override_revision || item.override_revision <= 0)) {
        return false;
      }
      if (statusFilter === 'DEFAULT' && item.override_revision && item.override_revision > 0) {
        return false;
      }
      if (statusFilter === 'CAN_OVERRIDE' && !item.allow_project_override) {
        return false;
      }
      if (statusFilter === 'LOCKED' && item.allow_project_override) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const key = parameterKey(item).toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const toolName = getToolMeta(item.tool).displayName.toLowerCase();
        const effVal = displayValue(item.effective_value).toLowerCase();
        if (!key.includes(q) && !desc.includes(q) && !toolName.includes(q) && !effVal.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [parameters, selectedTool, typeFilter, statusFilter, searchQuery]);

  // Filtered grouped by tool
  const filteredToolsMap = useMemo(() => {
    const map = new Map<string, ParameterDefinitionRow[]>();
    for (const item of filteredParameters) {
      const list = map.get(item.tool) || [];
      list.push(item);
      map.set(item.tool, list);
    }
    return map;
  }, [filteredParameters]);

  const toggleCollapseTool = (tool: string) => {
    setCollapsedTools(prev => ({ ...prev, [tool]: !prev[tool] }));
  };

  // Helper to parse input values
  const parseInputValue = (type: ConnectorValueType, rawString: string, rawBool: boolean, rawNum: number): unknown => {
    if (type === 'boolean') return Boolean(rawBool);
    if (type === 'integer') {
      return parseNumericValue(rawNum, rawString, true);
    }
    if (type === 'number') {
      return parseNumericValue(rawNum, rawString, false);
    }
    if (type === 'string') return rawString;
    if (type === 'secret_ref') {
      const trimmed = rawString.trim();
      if (!/^env:\/\/[A-Z][A-Z0-9_]{0,127}$/.test(trimmed)) {
        throw new Error('Secret reference must follow the format env://VARIABLE_NAME');
      }
      return trimmed;
    }
    if (type === 'json') {
      try {
        return JSON.parse(rawString);
      } catch {
        throw new Error('Invalid JSON syntax.');
      }
    }
    return rawString;
  };

  // Save Project Override Action
  const handleSaveOverride = async (targetParam?: ParameterDefinitionRow, directVal?: unknown) => {
    const item = targetParam || activeParam;
    if (!item) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      let finalValue: unknown;
      if (directVal !== undefined) {
        finalValue = directVal;
      } else {
        finalValue = parseInputValue(item.value_type, editOverrideValue, editOverrideBool, editOverrideNumber);
      }

      await setParameterOverride(item.tool, item.variable_name, {
        value: finalValue,
        expected_revision: item.override_revision ?? 0,
        expected_definition_revision: item.revision,
      });

      await load();
      setNotice({
        type: 'success',
        message: `Saved project override for ${item.tool}.${item.variable_name}. Persisted to database.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to save project override.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Restore Default Action
  const handleResetOverride = async (targetParam?: ParameterDefinitionRow) => {
    const item = targetParam || activeParam;
    if (!item || !item.override_revision) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await resetParameterOverride(item.tool, item.variable_name, item.override_revision);
      await load();
      setNotice({
        type: 'success',
        message: `Removed project override for ${item.tool}.${item.variable_name}. Restored platform default.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to reset parameter override.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Save Platform Default Action (Admin)
  const handleSavePlatformDefault = async () => {
    if (!activeParam || !isPlatformAdmin) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const finalDefault = parseInputValue(
        activeParam.value_type,
        editDefaultValue,
        editDefaultBool,
        editDefaultNumber
      );

      if (!editDescription.trim()) {
        throw new Error('Description cannot be empty.');
      }

      await defineParameter(activeParam.tool, activeParam.variable_name, {
        value_type: activeParam.value_type,
        description: editDescription.trim(),
        default_value: finalDefault,
        allow_project_override: editAllowOverride,
        icon: (activeParam as any).icon || 'settings',
        expected_revision: activeParam.revision,
      });

      await load();
      setNotice({
        type: 'success',
        message: `Saved platform default definition for ${activeParam.tool}.${activeParam.variable_name}. Persisted to database.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to save platform default definition.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-container">
      {/* Hero Header */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Parameter <span>Studio</span>
          </h1>
          <p className="hero-lede">
            Inspect, tune, and override tool parameters and runtime constraints arranged per provider with cryptographic revision checks.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Sliders size={13} /> {loading ? 'Loading…' : `${stats.total} parameters across ${stats.toolsCount} tools`}
            </span>
            <span className="hero-stat-chip">
              <Shield size={13} color="var(--acc)" /> Scope: {principal?.tenant_id || 'acme'} / {principal?.project_id || 'payments-prod'}
            </span>
            {principal && (
              <span className="hero-stat-chip" style={{ color: isPlatformAdmin ? 'var(--acc)' : 'var(--muted)' }}>
                Role: {principal.roles.join(', ') || 'Standard'}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            disabled={loading || busy}
            onClick={() => void load()}
            title="Reload all parameters from the server"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </section>

      {/* Notice & Error Banners */}
      {error && (
        <div className="notice-banner" role="alert" style={{ borderColor: 'var(--danger)', background: 'rgba(244, 63, 94, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontWeight: 600 }}>
            <AlertCircle size={16} /> Error
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text)' }}>{error}</p>
        </div>
      )}

      {notice && (
        <div
          className="notice-banner"
          role="status"
          style={{
            borderColor: notice.type === 'success' ? 'var(--acc)' : 'var(--line)',
            background: notice.type === 'success' ? 'var(--acc-glow)' : 'var(--card-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: notice.type === 'success' ? 'var(--acc)' : 'var(--text)' }}>
            {notice.type === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
            <span>{notice.message}</span>
          </div>
        </div>
      )}

      {/* Main Studio Wrapper */}
      <div className="param-studio-wrapper">
        {/* Metric Summary Cards */}
        <div className="param-stats-grid">
          <div className="param-stat-card">
            <div className="param-stat-icon" style={{ color: 'var(--acc)' }}>
              <Sliders size={20} />
            </div>
            <div className="param-stat-content">
              <span className="param-stat-label">Total Parameters</span>
              <span className="param-stat-value">{stats.total}</span>
            </div>
          </div>
          <div className="param-stat-card">
            <div className="param-stat-icon" style={{ color: 'var(--acc2)' }}>
              <Layers size={20} />
            </div>
            <div className="param-stat-content">
              <span className="param-stat-label">Configured Tools</span>
              <span className="param-stat-value">{stats.toolsCount}</span>
            </div>
          </div>
          <div className="param-stat-card">
            <div className="param-stat-icon" style={{ color: 'var(--acc)' }}>
              <Sparkles size={20} />
            </div>
            <div className="param-stat-content">
              <span className="param-stat-label">Active Overrides</span>
              <span className="param-stat-value">{stats.overridden}</span>
            </div>
          </div>
          <div className="param-stat-card">
            <div className="param-stat-icon" style={{ color: 'var(--muted)' }}>
              <Lock size={20} />
            </div>
            <div className="param-stat-content">
              <span className="param-stat-label">Platform Enforced</span>
              <span className="param-stat-value">{stats.platformEnforced}</span>
            </div>
          </div>
        </div>

        {/* Filter & Controls Bar */}
        <div className="param-controls-bar">
          <div className="param-search-box">
            <Search size={15} color="var(--muted)" />
            <input
              type="search"
              placeholder="Search parameters by name, description, or value…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="param-filters-row">
            {/* Value Type Filter */}
            <select
              className="param-filter-select"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Types</option>
              <option value="string">String</option>
              <option value="integer">Integer</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
              <option value="secret_ref">Secret Reference</option>
            </select>

            {/* Override Status Filter */}
            <select
              className="param-filter-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="OVERRIDDEN">Active Overrides Only</option>
              <option value="DEFAULT">Platform Defaults Only</option>
              <option value="CAN_OVERRIDE">Override Permitted</option>
              <option value="LOCKED">Platform Locked</option>
            </select>
          </div>
        </div>

        {/* Tool Selector Tabs */}
        <div className="param-tools-nav">
          <button
            className={`param-tool-tab ${selectedTool === 'ALL' ? 'active' : ''}`}
            onClick={() => setSelectedTool('ALL')}
          >
            <Sliders size={14} />
            <span>All Tools</span>
            <span className="param-tab-count">{parameters.length}</span>
          </button>

          {uniqueTools.map(toolKey => {
            const meta = getToolMeta(toolKey);
            const toolParams = toolsMap.get(toolKey) || [];
            const hasOverrides = toolParams.some(p => p.override_revision && p.override_revision > 0);
            const isSelected = selectedTool === toolKey;

            return (
              <button
                key={toolKey}
                className={`param-tool-tab ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedTool(toolKey)}
              >
                {meta.icon}
                <span>{meta.displayName}</span>
                {hasOverrides && <span className="param-tool-dot" title="Has active project overrides" />}
                <span className="param-tab-count">{toolParams.length}</span>
              </button>
            );
          })}
        </div>

        {/* Tool Groups Section */}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
            <p>Loading parameter catalog definitions from deployment…</p>
          </div>
        )}

        {!loading && filteredToolsMap.size === 0 && (
          <div className="notice-banner" style={{ textAlign: 'center', padding: 40 }}>
            <Sliders size={28} color="var(--muted)" style={{ margin: '0 auto 10px' }} />
            <h3>No matching parameters found</h3>
            <p className="metric-meta">
              No parameters matched your search criteria or selected filters. Try clearing search keywords or selecting All Tools.
            </p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => {
                setSelectedTool('ALL');
                setSearchQuery('');
                setTypeFilter('ALL');
                setStatusFilter('ALL');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {!loading &&
          Array.from(filteredToolsMap.entries()).map(([toolKey, toolParams]) => {
            const meta = getToolMeta(toolKey);
            const isCollapsed = Boolean(collapsedTools[toolKey]);
            const toolOverrideCount = toolParams.filter(p => p.override_revision && p.override_revision > 0).length;

            return (
              <section key={toolKey} className="param-tool-group">
                {/* Tool Header */}
                <div
                  className="param-tool-group-header"
                  onClick={() => toggleCollapseTool(toolKey)}
                  title="Click to expand/collapse this tool's parameters"
                >
                  <div className="param-tool-info">
                    <div className="param-tool-avatar">{meta.icon}</div>
                    <div className="param-tool-titles">
                      <h3>
                        {meta.displayName}
                        <span className="param-tool-system-tag">{toolKey}</span>
                      </h3>
                      <p className="param-tool-desc">{meta.description}</p>
                    </div>
                  </div>

                  <div className="param-tool-meta-badges">
                    <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                      {toolParams.length} parameters
                    </span>
                    {toolOverrideCount > 0 && (
                      <span className="badge badge-active" style={{ fontSize: '11px' }}>
                        {toolOverrideCount} overridden
                      </span>
                    )}
                    <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                      {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </div>
                </div>

                {/* Parameters Cards Grid */}
                {!isCollapsed && (
                  <div className="param-cards-grid">
                    {toolParams.map(param => {
                      const isOverridden = Boolean(param.override_revision && param.override_revision > 0);
                      const key = parameterKey(param);

                      return (
                        <div
                          key={key}
                          className={`param-card ${isOverridden ? 'is-overridden' : ''}`}
                        >
                          <div>
                            {/* Card Top: Name & Badges */}
                            <div className="param-card-header">
                              <div className="param-name-wrapper">
                                <span className="param-name">{param.variable_name}</span>
                              </div>
                              <div className="param-card-badges">
                                <span className={`param-badge-type ${param.value_type}`}>
                                  {formatValueType(param.value_type)}
                                </span>
                                {isOverridden ? (
                                  <span className="param-badge-status overridden" title="Custom Project Override">
                                    <Sparkles size={10} /> Override (r{param.override_revision})
                                  </span>
                                ) : param.allow_project_override ? (
                                  <span className="param-badge-status default" title="Using platform default">
                                    Platform Default
                                  </span>
                                ) : (
                                  <span className="param-badge-status locked" title="Platform enforced">
                                    <Lock size={10} /> Platform Enforced
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Description */}
                            <p className="param-desc" title={param.description}>
                              {param.description}
                            </p>

                            {/* Value Display Box */}
                            <div className="param-value-box">
                              <div className="param-value-header">
                                <span>{isOverridden ? 'Project Effective Value' : 'Effective Default'}</span>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>
                                  rev {param.revision}
                                </span>
                              </div>
                              <div className="param-value-display">
                                {param.value_type === 'secret_ref' ? (
                                  <span style={{ color: 'var(--acc-amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Key size={12} /> {String(param.effective_value)}
                                  </span>
                                ) : param.value_type === 'boolean' ? (
                                  <span
                                    style={{
                                      color: param.effective_value ? 'var(--acc)' : 'var(--muted)',
                                      fontWeight: 700,
                                    }}
                                  >
                                    {param.effective_value ? 'TRUE' : 'FALSE'}
                                  </span>
                                ) : (
                                  displayValue(param.effective_value)
                                )}
                              </div>
                              {isOverridden && (
                                <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: 2 }}>
                                  Default: <code>{displayValue(param.default_value)}</code>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Card Footer Actions */}
                          <div className="param-card-actions">
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '11px', padding: '5px 10px' }}
                              onClick={() => {
                                setActiveParam(param);
                                setNotice(null);
                              }}
                            >
                              <Sliders size={12} /> Configure
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {/* Quick boolean toggle */}
                              {param.value_type === 'boolean' && param.allow_project_override && canOverride && (
                                <button
                                  className="btn btn-secondary"
                                  style={{
                                    fontSize: '11px',
                                    padding: '5px 10px',
                                    color: param.effective_value ? 'var(--acc)' : 'var(--muted)',
                                  }}
                                  disabled={busy}
                                  onClick={() => handleSaveOverride(param, !param.effective_value)}
                                  title={`Toggle override to ${!param.effective_value}`}
                                >
                                  {param.effective_value ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                  {param.effective_value ? 'On' : 'Off'}
                                </button>
                              )}

                              {/* Revert override button */}
                              {isOverridden && canOverride && (
                                <button
                                  className="btn btn-secondary"
                                  style={{ fontSize: '11px', padding: '5px 8px' }}
                                  disabled={busy}
                                  onClick={() => handleResetOverride(param)}
                                  title="Revert to Platform Default"
                                >
                                  <RotateCcw size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
      </div>

      {/* Slide-Over Drawer / Inspector Modal */}
      {activeParam && (
        <div className="param-drawer-backdrop" onClick={() => setActiveParam(null)}>
          <div className="param-drawer" onClick={e => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="param-drawer-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="param-tool-avatar" style={{ width: 26, height: 26 }}>
                    {getToolMeta(activeParam.tool).icon}
                  </span>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{parameterKey(activeParam)}</h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span className={`param-badge-type ${activeParam.value_type}`}>
                    {formatValueType(activeParam.value_type)}
                  </span>
                  <span className="badge badge-neutral">Def Rev {activeParam.revision}</span>
                  {activeParam.override_revision && (
                    <span className="badge badge-active">Override Rev {activeParam.override_revision}</span>
                  )}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: '6px 8px' }}
                onClick={() => setActiveParam(null)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs Bar */}
            <div style={{ padding: '10px 20px 0', background: 'var(--bg-surface)' }}>
              <div className="param-tabs-header">
                <button
                  className={`param-tab-btn ${drawerTab === 'override' ? 'active' : ''}`}
                  onClick={() => setDrawerTab('override')}
                >
                  <Sparkles size={14} /> Project Override
                </button>
                {isPlatformAdmin && (
                  <button
                    className={`param-tab-btn ${drawerTab === 'platform_default' ? 'active' : ''}`}
                    onClick={() => setDrawerTab('platform_default')}
                  >
                    <Shield size={14} /> Platform Default
                  </button>
                )}
                <button
                  className={`param-tab-btn ${drawerTab === 'details' ? 'active' : ''}`}
                  onClick={() => setDrawerTab('details')}
                >
                  <Info size={14} /> Details & Lineage
                </button>
              </div>
            </div>

            {/* Drawer Content */}
            <div className="param-drawer-body">
              {/* Tab 1: Project Override */}
              {drawerTab === 'override' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
                    {activeParam.description}
                  </p>

                  {!activeParam.allow_project_override ? (
                    <div className="notice-banner" style={{ borderColor: 'rgba(148, 163, 184, 0.3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8' }}>
                        <Lock size={16} />
                        <strong>Platform Managed Setting</strong>
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                        Project overrides are disabled for this parameter by platform governance. Platform administrators can enable overrides in the Platform Default tab.
                      </p>
                    </div>
                  ) : !canOverride ? (
                    <div className="notice-banner">
                      <p style={{ margin: 0, fontSize: 12 }}>
                        Saving project overrides requires the <code>PLATFORM_ADMIN</code>, <code>TENANT_ADMIN</code>, or <code>PROJECT_OWNER</code> role.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Interactive Value Inputs */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          Project Value Override · {formatValueType(activeParam.value_type)}
                        </label>

                        {/* Boolean Input */}
                        {activeParam.value_type === 'boolean' && (
                          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                            <button
                              type="button"
                              className={`btn ${editOverrideBool ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => setEditOverrideBool(true)}
                              style={{ flex: 1, padding: 10 }}
                            >
                              <CheckCircle2 size={14} /> TRUE (Enabled)
                            </button>
                            <button
                              type="button"
                              className={`btn ${!editOverrideBool ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => setEditOverrideBool(false)}
                              style={{ flex: 1, padding: 10 }}
                            >
                              <X size={14} /> FALSE (Disabled)
                            </button>
                          </div>
                        )}

                        {/* Numeric Input */}
                        {(activeParam.value_type === 'integer' || activeParam.value_type === 'number') && (
                          <input
                            type="number"
                            step={activeParam.value_type === 'integer' ? '1' : 'any'}
                            value={Number.isFinite(editOverrideNumber) ? editOverrideNumber : ''}
                            onChange={e => { setEditOverrideNumber(e.target.valueAsNumber); setEditOverrideValue(e.target.value); }}
                            style={{
                              padding: 10,
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--line)',
                              borderRadius: 8,
                              color: 'var(--text)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          />
                        )}

                        {/* Secret Reference Input */}
                        {activeParam.value_type === 'secret_ref' && (
                          <div>
                            <input
                              type="text"
                              value={editOverrideValue}
                              onChange={e => setEditOverrideValue(e.target.value)}
                              placeholder="env://SERVICE_CREDENTIAL"
                              style={{
                                width: '100%',
                                padding: 10,
                                background: 'var(--bg-surface)',
                                border: '1px solid var(--line)',
                                borderRadius: 8,
                                color: 'var(--text)',
                                fontFamily: 'var(--font-mono)',
                              }}
                            />
                            <p className="metric-meta" style={{ marginTop: 4 }}>
                              Enter an <code>env://VARIABLE_NAME</code> reference. Raw tokens are rejected by server validation.
                            </p>
                          </div>
                        )}

                        {/* JSON Input */}
                        {activeParam.value_type === 'json' && (
                          <div>
                            <textarea
                              rows={8}
                              value={editOverrideValue}
                              onChange={e => {
                                setEditOverrideValue(e.target.value);
                                try {
                                  JSON.parse(e.target.value);
                                  setOverrideJsonError(null);
                                } catch (err: any) {
                                  setOverrideJsonError(err.message);
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: 10,
                                background: 'rgba(0, 0, 0, 0.4)',
                                border: overrideJsonError ? '1px solid var(--danger)' : '1px solid var(--line)',
                                borderRadius: 8,
                                color: 'var(--text)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 12,
                              }}
                            />
                            {overrideJsonError && (
                              <span style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4, display: 'block' }}>
                                JSON Syntax Error: {overrideJsonError}
                              </span>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ marginTop: 6, fontSize: 11, padding: '4px 8px' }}
                              onClick={() => {
                                try {
                                  const formatted = JSON.stringify(JSON.parse(editOverrideValue), null, 2);
                                  setEditOverrideValue(formatted);
                                  setOverrideJsonError(null);
                                } catch {
                                  setOverrideJsonError('Cannot format invalid JSON');
                                }
                              }}
                            >
                              <Code size={12} /> Format JSON
                            </button>
                          </div>
                        )}

                        {/* String / Default Textarea */}
                        {activeParam.value_type === 'string' && (
                          <textarea
                            rows={5}
                            value={editOverrideValue}
                            onChange={e => setEditOverrideValue(e.target.value)}
                            style={{
                              width: '100%',
                              padding: 10,
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--line)',
                              borderRadius: 8,
                              color: 'var(--text)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 12,
                            }}
                          />
                        )}
                      </div>

                      {/* Side-by-side Diff Table */}
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                          Value Comparison
                        </span>
                        <table className="param-diff-table">
                          <tbody>
                            <tr>
                              <th style={{ width: '35%' }}>Platform Default</th>
                              <td>{displayValue(activeParam.default_value)}</td>
                            </tr>
                            <tr>
                              <th>Current Effective</th>
                              <td style={{ color: activeParam.override_revision ? 'var(--acc)' : 'var(--text)' }}>
                                {displayValue(activeParam.effective_value)}
                              </td>
                            </tr>
                            <tr>
                              <th>Source & Revision</th>
                              <td>
                                {activeParam.source.toUpperCase()} · rev {activeParam.override_revision || activeParam.revision}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                        <button
                          className="btn btn-primary"
                          disabled={busy || Boolean(overrideJsonError)}
                          onClick={() => handleSaveOverride()}
                          style={{ flex: 1 }}
                        >
                          <Save size={14} className={busy ? 'spin' : ''} />
                          {busy ? 'Saving…' : 'Save Project Override'}
                        </button>
                        {Boolean(activeParam.override_revision) && (
                          <button
                            className="btn btn-secondary"
                            disabled={busy}
                            onClick={() => handleResetOverride()}
                          >
                            <RotateCcw size={14} /> Restore Default
                          </button>
                        )}
                      </div>

                      <p className="metric-meta" style={{ marginTop: 4 }}>
                        Note: Runtime engine constraints and connector endpoints take effect on the next API server restart.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Tab 2: Platform Default (Admin) */}
              {drawerTab === 'platform_default' && isPlatformAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="notice-banner" style={{ background: 'rgba(56, 189, 248, 0.05)', borderColor: 'rgba(56, 189, 248, 0.2)' }}>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text)' }}>
                      Platform administrators can update the base default value, description, and toggle project override permissions.
                    </p>
                  </div>

                  {/* Description Input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                      Parameter Description
                    </label>
                    <textarea
                      rows={3}
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      maxLength={2000}
                      style={{
                        padding: 10,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        color: 'var(--text)',
                        fontSize: 12,
                      }}
                    />
                  </div>

                  {/* Platform Default Value */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                      Default Value · {formatValueType(activeParam.value_type)}
                    </label>

                    {activeParam.value_type === 'boolean' && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          type="button"
                          className={`btn ${editDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setEditDefaultBool(true)}
                          style={{ flex: 1, padding: 8 }}
                        >
                          <CheckCircle2 size={14} /> TRUE
                        </button>
                        <button
                          type="button"
                          className={`btn ${!editDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setEditDefaultBool(false)}
                          style={{ flex: 1, padding: 8 }}
                        >
                          <X size={14} /> FALSE
                        </button>
                      </div>
                    )}

                    {(activeParam.value_type === 'integer' || activeParam.value_type === 'number') && (
                      <input
                        type="number"
                        step={activeParam.value_type === 'integer' ? '1' : 'any'}
                        value={Number.isFinite(editDefaultNumber) ? editDefaultNumber : ''}
                        onChange={e => { setEditDefaultNumber(e.target.valueAsNumber); setEditDefaultValue(e.target.value); }}
                        style={{
                          padding: 10,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--text)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />
                    )}

                    {activeParam.value_type === 'secret_ref' && (
                      <input
                        type="text"
                        value={editDefaultValue}
                        onChange={e => setEditDefaultValue(e.target.value)}
                        placeholder="env://SECRET_KEY"
                        style={{
                          padding: 10,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--text)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />
                    )}

                    {activeParam.value_type === 'json' && (
                      <textarea
                        rows={6}
                        value={editDefaultValue}
                        onChange={e => setEditDefaultValue(e.target.value)}
                        style={{
                          padding: 10,
                          background: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--text)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                        }}
                      />
                    )}

                    {activeParam.value_type === 'string' && (
                      <textarea
                        rows={4}
                        value={editDefaultValue}
                        onChange={e => setEditDefaultValue(e.target.value)}
                        style={{
                          padding: 10,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--text)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                        }}
                      />
                    )}
                  </div>

                  {/* Allow Project Override Checkbox */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={editAllowOverride}
                      onChange={e => setEditAllowOverride(e.target.checked)}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      Allow project workspaces to override this parameter
                    </span>
                  </label>

                  {/* Save Platform Default Button */}
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="btn btn-primary"
                      disabled={busy || !editDescription.trim()}
                      onClick={() => handleSavePlatformDefault()}
                      style={{ width: '100%' }}
                    >
                      <Save size={14} className={busy ? 'spin' : ''} />
                      {busy ? 'Saving…' : 'Save Platform Definition'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: Details & Lineage */}
              {drawerTab === 'details' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <table className="param-diff-table">
                    <tbody>
                      <tr>
                        <th style={{ width: '40%' }}>Tool Identifier</th>
                        <td>{activeParam.tool}</td>
                      </tr>
                      <tr>
                        <th>Variable Name</th>
                        <td>{activeParam.variable_name}</td>
                      </tr>
                      <tr>
                        <th>Type Specification</th>
                        <td>{activeParam.value_type}</td>
                      </tr>
                      <tr>
                        <th>Definition Revision</th>
                        <td>{activeParam.revision}</td>
                      </tr>
                      <tr>
                        <th>Override Revision</th>
                        <td>{activeParam.override_revision ?? 'None (Platform Default)'}</td>
                      </tr>
                      <tr>
                        <th>Project Override Allowed</th>
                        <td style={{ color: activeParam.allow_project_override ? 'var(--acc)' : 'var(--muted)' }}>
                          {activeParam.allow_project_override ? 'Yes (Permitted)' : 'No (Locked by Platform)'}
                        </td>
                      </tr>
                      <tr>
                        <th>Project Visible</th>
                        <td>{activeParam.project_visible ? 'Yes' : 'Platform Only'}</td>
                      </tr>
                      <tr>
                        <th>Current Value Source</th>
                        <td>{activeParam.source.toUpperCase()}</td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="notice-banner" style={{ fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
                      <Clock size={14} /> Persistence & Lifecycle Contract
                    </div>
                    <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>
                      Saved parameter definitions and project overrides are persisted to the PostgreSQL database with row-level revision locks to prevent concurrent race conditions. All updates are logged in the immutable audit lineage.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
