import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Sliders,
  RefreshCw,
  Search,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Lock,
  Key,
  Database,
  Cpu,
  Server,
  Layers,
  Activity,
  Terminal,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
  Shield,
  Clock,
  Sparkles,
  Code,
  Info,
  Check,
  ToggleLeft,
  ToggleRight,
  Radio,
  BookOpen,
  GitBranch,
  CheckSquare,
  List,
  Grid,
  Copy,
  Boxes,
  Plus,
  Trash2
} from 'lucide-react';
import {
  defineParameter,
  deleteParameterDefinition,
  fetchParameters,
  fetchPrincipal,
  resetParameterOverride,
  setParameterOverride,
  ApiError
} from '../services/api';
import type { ParameterDefinitionRow, Principal, ConnectorValueType } from '../types/api';
import { parseNumericValue } from '../utils/parameterValues';
import '../styles/parameters.css';

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
    icon: <Cpu size={16} />,
  },
  itsm: {
    displayName: 'ITSM / Jira Service',
    category: 'Incident & Ticketing',
    description: 'Issue tracker connector parameters, transition endpoints, timeout, and authentication.',
    icon: <Layers size={16} />,
  },
  log_search: {
    displayName: 'Log Search / Splunk',
    category: 'Observability & Logs',
    description: 'Search query windows, result caps, log analytics transport, and endpoints.',
    icon: <Search size={16} />,
  },
  confluence: {
    displayName: 'Confluence Knowledge',
    category: 'Documentation & Wiki',
    description: 'Atlassian wiki connector, documentation spaces, and runbook ingestion settings.',
    icon: <BookOpen size={16} />,
  },
  kubernetes: {
    displayName: 'Kubernetes Cluster',
    category: 'Containers & Clusters',
    description: 'Cluster API endpoints, namespace selectors, pod event correlation thresholds.',
    icon: <Server size={16} />,
  },
  kafka: {
    displayName: 'Apache Kafka Stream',
    category: 'Messaging & Events',
    description: 'Broker cluster bootstrap addresses, consumer group offsets, and lag tolerances.',
    icon: <Radio size={16} />,
  },
  oracle: {
    displayName: 'Oracle Database',
    category: 'Data & Storage',
    description: 'Enterprise relational database connector, connection pools, and query timeouts.',
    icon: <Database size={16} />,
  },
  gitlab: {
    displayName: 'GitLab DevSecOps',
    category: 'Code & CI/CD',
    description: 'Repository commit lineage, deployment pipeline hooks, and MR review settings.',
    icon: <GitBranch size={16} />,
  },
  signalfx: {
    displayName: 'SignalFx Telemetry',
    category: 'Metrics & APM',
    description: 'Real-time metrics streaming, detector query resolution, and chart thresholds.',
    icon: <Activity size={16} />,
  },
  qtest: {
    displayName: 'qTest QA Platform',
    category: 'Quality & Testing',
    description: 'Test run results, execution suite mappings, and release cycle validation.',
    icon: <CheckSquare size={16} />,
  },
  unix: {
    displayName: 'Unix / Linux Host',
    category: 'Infrastructure & OS',
    description: 'System diagnostics, remote SSH connection limits, and shell telemetry limits.',
    icon: <Terminal size={16} />,
  },
  jira: {
    displayName: 'Jira Native Provider',
    category: 'Incident & Ticketing',
    description: 'Native Jira REST API connectivity parameters and operational bounds.',
    icon: <Layers size={16} />,
  },
  splunk: {
    displayName: 'Splunk Native Provider',
    category: 'Observability & Logs',
    description: 'Native Splunk search jobs, REST API credentials, and dispatch settings.',
    icon: <Search size={16} />,
  },
};

function getToolMeta(toolName: string): ToolMeta {
  if (TOOL_REGISTRY[toolName.toLowerCase()]) {
    return TOOL_REGISTRY[toolName.toLowerCase()];
  }
  // Generic fallback for custom services / tools defined by users
  const formatted = toolName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
  return {
    displayName: formatted,
    category: 'Custom Service',
    description: `Configured parameters and operational settings for ${formatted}.`,
    icon: <Sliders size={16} />,
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

  // View Mode: Table (default) vs Cards
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Filters & Navigation
  const [selectedTool, setSelectedTool] = useState<string>('ALL');
  const [providerSearch, setProviderSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'PLATFORM' | 'PROJECT'>('ALL');
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({});

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inspector / Drawer State
  const [activeParam, setActiveParam] = useState<ParameterDefinitionRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<'override' | 'platform_default' | 'details'>('override');

  // Add Parameter Dialog State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTool, setNewTool] = useState('runtime');
  const [newCustomTool, setNewCustomTool] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ConnectorValueType>('string');
  const [newDefaultValue, setNewDefaultValue] = useState('');
  const [newDefaultBool, setNewDefaultBool] = useState(false);
  const [newDefaultNumber, setNewDefaultNumber] = useState(0);
  const [newDescription, setNewDescription] = useState('');
  const [newScope, setNewScope] = useState<'platform' | 'project' | 'platform_only'>('project');
  const [addError, setAddError] = useState<string | null>(null);

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
  const [editScope, setEditScope] = useState<'platform' | 'project' | 'platform_only'>('platform_only');
  const [defaultJsonError, setDefaultJsonError] = useState<string | null>(null);

  // Load Data
  const load = useCallback(async () => {
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
  }, [activeParam]);

  useEffect(() => {
    void load();
    fetchPrincipal()
      .then(p => {
        setPrincipal(p);
        const roles = p.roles || [];
        const isAdm = roles.includes('PLATFORM_ADMIN');
        setIsPlatformAdmin(isAdm);
        setCanOverride(isAdm || roles.includes('PROJECT_OWNER') || roles.includes('PROJECT_MANAGER'));
      })
      .catch(() => {
        setIsPlatformAdmin(false);
        setCanOverride(false);
      });
  }, []);

  // Keyboard shortcut listener for ESC (close modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddOpen) {
          setIsAddOpen(false);
        } else if (activeParam) {
          setActiveParam(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeParam, isAddOpen]);

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
    setEditScope(activeParam.allow_project_override ? (activeParam.project_visible ? 'project' : 'platform') : 'platform_only');
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

  // Filtered providers for sidebar search
  const filteredSidebarTools = useMemo(() => {
    if (!providerSearch.trim()) return uniqueTools;
    const q = providerSearch.toLowerCase();
    return uniqueTools.filter(t => {
      const meta = getToolMeta(t);
      return t.toLowerCase().includes(q) || meta.displayName.toLowerCase().includes(q);
    });
  }, [uniqueTools, providerSearch]);

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
      if (scopeFilter === 'PLATFORM' && item.project_visible) return false;
      if (scopeFilter === 'PROJECT' && !item.project_visible) return false;
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
  }, [parameters, selectedTool, typeFilter, statusFilter, scopeFilter, searchQuery]);

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

  const setAllCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const t of uniqueTools) {
      next[t] = collapsed;
    }
    setCollapsedTools(next);
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

  // Copy to clipboard helper
  const handleCopyValue = (key: string, val: unknown) => {
    const str = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
    navigator.clipboard.writeText(str).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }).catch(() => null);
  };

  // Create Parameter Action
  const handleCreateParameter = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const finalTool = (newTool === '__custom__' ? newCustomTool : newTool).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const finalName = newName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

    if (!finalTool || !finalName) {
      setAddError('Please enter valid tool and variable names (letters, numbers, and underscores).');
      return;
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(finalTool) || !/^[a-z][a-z0-9_]{0,63}$/.test(finalName)) {
      setAddError('Identifiers must start with a lowercase letter and contain only alphanumeric characters or underscores (max 64 chars).');
      return;
    }
    if (!newDescription.trim()) {
      setAddError('Parameter description is required.');
      return;
    }

    setBusy(true);
    try {
      const parsedVal = parseInputValue(newType, newDefaultValue, newDefaultBool, newDefaultNumber);
      await defineParameter(finalTool, finalName, {
        value_type: newType,
        default_value: parsedVal,
        description: newDescription.trim(),
        allow_project_override: newScope !== 'platform_only',
        icon: 'sliders',
        expected_revision: 0,
      });

      setIsAddOpen(false);
      setNewName('');
      setNewDescription('');
      setNewDefaultValue('');
      await load();
      setSelectedTool(finalTool);
      setNotice({
        type: 'success',
        message: `Created parameter ${finalTool}.${finalName}. Persisted to PostgreSQL runtime database.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to create parameter.';
      setAddError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Delete Parameter Action (Admin)
  const handleDeleteDefinition = async (param: ParameterDefinitionRow) => {
    if (!isPlatformAdmin) return;
    const confirmed = window.confirm(
      `Delete parameter definition "${param.tool}.${param.variable_name}"?\n\nThis will remove the platform default and all project overrides from the database.`
    );
    if (!confirmed) return;

    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await deleteParameterDefinition(param.tool, param.variable_name, param.revision);
      if (activeParam && parameterKey(activeParam) === parameterKey(param)) {
        setActiveParam(null);
      }
      await load();
      setNotice({
        type: 'success',
        message: `Deleted parameter definition ${param.tool}.${param.variable_name}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to delete parameter definition.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
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
        message: `Saved override for ${item.tool}.${item.variable_name}.`,
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
        message: `Restored default for ${item.tool}.${item.variable_name}.`,
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
        scope: editScope,
        icon: (activeParam as any).icon || 'sliders',
        expected_revision: activeParam.revision,
      });

      await load();
      setNotice({
        type: 'success',
        message: `Saved platform default definition for ${activeParam.tool}.${activeParam.variable_name}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to save platform default definition.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Active provider metadata if single provider selected
  const activeSelectedMeta = selectedTool !== 'ALL' ? getToolMeta(selectedTool) : null;

  // Add Parameter Dialog Modal (Portaled)
  const addParameterModal = isAddOpen && createPortal(
    <div className="param-modal-overlay" onClick={() => setIsAddOpen(false)}>
      <div className="param-modal-card" onClick={e => e.stopPropagation()}>
        <div className="param-modal-header">
          <h3>
            <Plus size={18} color="var(--acc)" />
            Add Parameter Definition
          </h3>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 6px' }}
            onClick={() => setIsAddOpen(false)}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleCreateParameter}>
          <div className="param-modal-body">
            {addError && (
              <div className="notice-banner" role="alert" style={{ borderColor: 'var(--acc-rose)', background: 'rgba(244, 63, 94, 0.08)' }}>
                <p style={{ margin: 0, color: 'var(--acc-rose)', fontSize: 12 }}>{addError}</p>
              </div>
            )}

            {/* Target Tool / Provider */}
            <div className="param-form-group">
              <label>Target Provider / Service *</label>
              <select
                value={newTool}
                onChange={e => setNewTool(e.target.value)}
              >
                {uniqueTools.map(t => (
                  <option key={t} value={t}>
                    {getToolMeta(t).displayName} ({t})
                  </option>
                ))}
                <option value="__custom__">+ Define New Tool or Service…</option>
              </select>
            </div>

            {newTool === '__custom__' && (
              <div className="param-form-group">
                <label>Custom Tool Identifier *</label>
                <input
                  type="text"
                  placeholder="e.g. payments, redis, llm_gateway"
                  value={newCustomTool}
                  onChange={e => setNewCustomTool(e.target.value)}
                  required
                />
                <span className="param-form-help">Lowercase letters, numbers, and underscores only.</span>
              </div>
            )}

            {/* Parameter Variable Name */}
            <div className="param-form-group">
              <label>Variable Name *</label>
              <input
                type="text"
                placeholder="e.g. max_connections, feature_enabled, timeout_seconds"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
              />
              <span className="param-form-help">Unique operational variable identifier.</span>
            </div>

            {/* Value Type */}
            <div className="param-form-group">
              <label>Value Type *</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as ConnectorValueType)}
              >
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="number">Number (Float)</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON Object / Array</option>
                <option value="secret_ref">Secret Reference (env://VAR)</option>
              </select>
            </div>

            {/* Default Value Input based on Type */}
            <div className="param-form-group">
              <label>Default Value *</label>
              {newType === 'boolean' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className={`btn ${newDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNewDefaultBool(true)}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <CheckCircle2 size={13} /> TRUE
                  </button>
                  <button
                    type="button"
                    className={`btn ${!newDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNewDefaultBool(false)}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <X size={13} /> FALSE
                  </button>
                </div>
              )}

              {(newType === 'integer' || newType === 'number') && (
                <input
                  type="number"
                  step={newType === 'integer' ? '1' : 'any'}
                  value={Number.isFinite(newDefaultNumber) ? newDefaultNumber : ''}
                  onChange={e => setNewDefaultNumber(e.target.valueAsNumber)}
                  required
                />
              )}

              {newType === 'secret_ref' && (
                <input
                  type="text"
                  placeholder="env://SERVICE_TOKEN"
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}

              {newType === 'json' && (
                <textarea
                  rows={4}
                  placeholder='{"key": "value"}'
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}

              {newType === 'string' && (
                <input
                  type="text"
                  placeholder="Default string value"
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}
            </div>

            {/* Description */}
            <div className="param-form-group">
              <label>Description *</label>
              <textarea
                rows={2}
                placeholder="What this parameter controls in the runtime environment..."
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                required
              />
            </div>

            <div className="param-form-group">
              <label>Parameter Scope *</label>
              <select value={newScope} onChange={e => setNewScope(e.target.value as typeof newScope)}>
                <option value="platform">Platform default</option>
                <option value="project">Project workspace</option>
                <option value="platform_only">Platform only (locked)</option>
              </select>
              <span className="param-form-help">Scope maps to the persisted platform default and project override policy.</span>
            </div>
          </div>

          <div className="param-modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsAddOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
            >
              <Save size={13} />
              {busy ? 'Creating…' : 'Save Parameter Definition'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );

  // Drawer JSX (Mounted to document.body via createPortal)
  const drawerPortal = activeParam && createPortal(
    <div className="param-drawer-backdrop" onClick={() => setActiveParam(null)}>
      <div className="param-drawer" onClick={e => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="param-drawer-header">
          <div>
            <div className="param-drawer-title-row">
              <span className="param-tool-avatar" style={{ width: 28, height: 28 }}>
                {getToolMeta(activeParam.tool).icon}
              </span>
              <h3 className="param-drawer-param-name">{parameterKey(activeParam)}</h3>
            </div>
            <div className="param-drawer-badges">
              <span className={`param-type-badge ${activeParam.value_type}`}>
                {formatValueType(activeParam.value_type)}
              </span>
              <span className="param-pill-badge default">Def Rev {activeParam.revision}</span>
              {Boolean(activeParam.override_revision) && (
                <span className="param-pill-badge overridden">
                  Override Rev {activeParam.override_revision}
                </span>
              )}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 8px' }}
            onClick={() => setActiveParam(null)}
            title="Close inspector (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="param-drawer-tabs-bar">
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
                    Saving project overrides requires the <code>PLATFORM_ADMIN</code>, <code>PROJECT_OWNER</code>, or <code>PROJECT_MANAGER</code> role.
                  </p>
                </div>
              ) : (
                <>
                  {/* Interactive Value Inputs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
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
                        onChange={e => {
                          setEditOverrideNumber(e.target.valueAsNumber);
                          setEditOverrideValue(e.target.value);
                        }}
                        style={{
                          padding: 10,
                          background: 'var(--card-subtle)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--tx)',
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
                            background: 'var(--card-subtle)',
                            border: '1px solid var(--line)',
                            borderRadius: 8,
                            color: 'var(--tx)',
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
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: overrideJsonError ? '1px solid var(--acc-rose)' : '1px solid var(--line)',
                            borderRadius: 8,
                            color: 'var(--tx)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                          }}
                        />
                        {overrideJsonError && (
                          <span style={{ color: 'var(--acc-rose)', fontSize: 11, marginTop: 4, display: 'block' }}>
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
                          background: 'var(--card-subtle)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--tx)',
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
                          <td style={{ color: activeParam.override_revision ? '#22c55e' : 'var(--tx)', fontWeight: 600 }}>
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
                        title="Revert override to deployment platform default"
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
                <p style={{ margin: 0, fontSize: 12, color: 'var(--tx)' }}>
                  Platform administrators can update the base default value, description, and toggle project override permissions.
                </p>
              </div>

              {/* Description Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                  Parameter Description
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  maxLength={2000}
                  style={{
                    padding: 10,
                    background: 'var(--card-subtle)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    color: 'var(--tx)',
                    fontSize: 12,
                  }}
                />
              </div>

              {/* Platform Default Value */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
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
                    onChange={e => {
                      setEditDefaultNumber(e.target.valueAsNumber);
                      setEditDefaultValue(e.target.value);
                    }}
                    style={{
                      padding: 10,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
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
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                )}

                {activeParam.value_type === 'json' && (
                  <div>
                    <textarea
                      rows={6}
                      value={editDefaultValue}
                      onChange={e => {
                        setEditDefaultValue(e.target.value);
                        try {
                          JSON.parse(e.target.value);
                          setDefaultJsonError(null);
                        } catch (err: any) {
                          setDefaultJsonError(err.message);
                        }
                      }}
                      style={{
                        padding: 10,
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: defaultJsonError ? '1px solid var(--acc-rose)' : '1px solid var(--line)',
                        borderRadius: 8,
                        color: 'var(--tx)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        width: '100%',
                      }}
                    />
                    {defaultJsonError && (
                      <span style={{ color: 'var(--acc-rose)', fontSize: 11, marginTop: 4, display: 'block' }}>
                        JSON Syntax Error: {defaultJsonError}
                      </span>
                    )}
                  </div>
                )}

                {activeParam.value_type === 'string' && (
                  <textarea
                    rows={4}
                    value={editDefaultValue}
                    onChange={e => setEditDefaultValue(e.target.value)}
                    style={{
                      padding: 10,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  />
                )}
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--tx)' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Parameter Scope</span>
                <select value={editScope} onChange={e => { const value = e.target.value as typeof editScope; setEditScope(value); setEditAllowOverride(value !== 'platform_only'); }} style={{ padding: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--tx)' }}>
                  <option value="platform">Platform default</option>
                  <option value="project">Project workspace</option>
                  <option value="platform_only">Platform only (locked)</option>
                </select>
              </label>

              {/* Allow Project Override Checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={editAllowOverride}
                  onChange={e => { setEditAllowOverride(e.target.checked); setEditScope(e.target.checked ? 'project' : 'platform_only'); }}
                />
                <span style={{ fontSize: 13, color: 'var(--tx)' }}>
                  Allow project workspaces to override this parameter
                </span>
              </label>

              {/* Save Platform Default Button */}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || !editDescription.trim()}
                  onClick={() => handleSavePlatformDefault()}
                  style={{ flex: 1 }}
                >
                  <Save size={14} className={busy ? 'spin' : ''} />
                  {busy ? 'Saving…' : 'Save Platform Definition'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => handleDeleteDefinition(activeParam)}
                  style={{ color: 'var(--acc-rose)' }}
                  title="Delete parameter definition from database"
                >
                  <Trash2 size={14} /> Delete
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
    </div>,
    document.body
  );

  // Render Table Row
  const renderTableRow = (param: ParameterDefinitionRow) => {
    const isOverridden = Boolean(param.override_revision && param.override_revision > 0);
    const key = parameterKey(param);
    const isCopied = copiedKey === key;

    return (
      <tr key={key} className={isOverridden ? 'is-overridden' : ''}>
        {/* Name & Tool */}
        <td>
          <div className="param-cell-name">
            <span className="param-key-text">
              {selectedTool === 'ALL' && <span className="param-tool-prefix">{param.tool} / </span>}
              {param.variable_name}
            </span>
            <span className="param-desc-subtext" title={param.description}>
              {param.description}
            </span>
          </div>
        </td>

        {/* Type Badge */}
        <td>
          <span className={`param-type-badge ${param.value_type}`}>
            {formatValueType(param.value_type)}
          </span>
        </td>

        {/* Effective Value & Inline Toggle */}
        <td>
          <div className="param-cell-value">
            {param.value_type === 'boolean' && param.allow_project_override && canOverride ? (
              <button
                type="button"
                className={`param-inline-toggle ${param.effective_value ? 'is-true' : 'is-false'}`}
                disabled={busy}
                onClick={() => handleSaveOverride(param, !param.effective_value)}
                title={`Click to quickly toggle to ${!param.effective_value}`}
              >
                {param.effective_value ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                <span>{param.effective_value ? 'TRUE' : 'FALSE'}</span>
              </button>
            ) : param.value_type === 'secret_ref' ? (
              <span className="param-value-code" style={{ color: 'var(--acc-amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Key size={11} /> {String(param.effective_value)}
              </span>
            ) : param.value_type === 'boolean' ? (
              <span
                style={{
                  color: param.effective_value ? '#22c55e' : 'var(--muted)',
                  fontWeight: 700,
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {param.effective_value ? 'TRUE' : 'FALSE'}
              </span>
            ) : (
              <span className={`param-value-code ${isOverridden ? 'is-override' : ''}`}>
                {displayValue(param.effective_value)}
              </span>
            )}

            {/* Quick Copy Button */}
            <button
              className="param-copy-btn"
              onClick={() => handleCopyValue(key, param.effective_value)}
              title={isCopied ? 'Copied!' : 'Copy value'}
            >
              {isCopied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
            </button>
          </div>
        </td>

        {/* Status / Governance */}
        <td>
          {isOverridden ? (
            <span className="param-pill-badge overridden" title={`Custom project override (rev ${param.override_revision})`}>
              <Sparkles size={11} /> Override (r{param.override_revision})
            </span>
          ) : param.allow_project_override ? (
            <span className="param-pill-badge default" title="Using platform base default">
              Platform Default
            </span>
          ) : (
            <span className="param-pill-badge locked" title="Platform enforced parameter">
              <Lock size={10} /> Enforced
            </span>
          )}
        </td>

        {/* Row Actions */}
        <td>
          <div className="param-row-actions">
            <button
              className="param-action-btn"
              onClick={() => {
                setActiveParam(param);
                setNotice(null);
              }}
              title="Configure parameter and inspect lineage"
            >
              <Sliders size={12} /> Configure
            </button>

            {isOverridden && canOverride && (
              <button
                className="param-action-btn revert"
                disabled={busy}
                onClick={() => handleResetOverride(param)}
                title="Restore platform default value"
              >
                <RotateCcw size={12} />
              </button>
            )}

            {isPlatformAdmin && (
              <button
                className="param-action-btn delete"
                disabled={busy}
                onClick={() => handleDeleteDefinition(param)}
                title="Delete parameter definition from database"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Render Card View
  const renderCard = (param: ParameterDefinitionRow) => {
    const isOverridden = Boolean(param.override_revision && param.override_revision > 0);
    const key = parameterKey(param);
    const isCopied = copiedKey === key;

    return (
      <div key={key} className={`param-card ${isOverridden ? 'is-overridden' : ''}`}>
        <div>
          {/* Card Top: Name & Badges */}
          <div className="param-card-header">
            <div className="param-name-wrapper">
              <span className="param-name">
                {selectedTool === 'ALL' && <span className="param-tool-prefix">{param.tool} / </span>}
                {param.variable_name}
              </span>
            </div>
            <div className="param-card-badges">
              <span className={`param-type-badge ${param.value_type}`}>
                {formatValueType(param.value_type)}
              </span>
              {isOverridden ? (
                <span className="param-pill-badge overridden" title="Custom Project Override">
                  <Sparkles size={10} /> Override (r{param.override_revision})
                </span>
              ) : param.allow_project_override ? (
                <span className="param-pill-badge default" title="Using platform default">
                  Platform Default
                </span>
              ) : (
                <span className="param-pill-badge locked" title="Platform enforced">
                  <Lock size={10} /> Enforced
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>rev {param.revision}</span>
                <button
                  className="param-copy-btn"
                  onClick={() => handleCopyValue(key, param.effective_value)}
                  title={isCopied ? 'Copied!' : 'Copy value'}
                >
                  {isCopied ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
            <div className="param-value-display">
              {param.value_type === 'secret_ref' ? (
                <span style={{ color: 'var(--acc-amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Key size={12} /> {String(param.effective_value)}
                </span>
              ) : param.value_type === 'boolean' ? (
                <span style={{ color: param.effective_value ? '#22c55e' : 'var(--muted)', fontWeight: 700 }}>
                  {param.effective_value ? 'TRUE' : 'FALSE'}
                </span>
              ) : (
                displayValue(param.effective_value)
              )}
            </div>
            {isOverridden && (
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
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
                  color: param.effective_value ? '#22c55e' : 'var(--muted)',
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

            {/* Delete button (admin) */}
            {isPlatformAdmin && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 8px', color: 'var(--acc-rose)' }}
                disabled={busy}
                onClick={() => handleDeleteDefinition(param)}
                title="Delete parameter definition from database"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="view-container param-studio-page">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Parameter Studio & <span>Runtime Tuning</span>
          </h1>
          <p className="hero-lede">
            Declarative operational variables, stage-level tuning, and dual-custody parameter overrides for active connectors.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Sliders size={12} /> <b>{loading ? '…' : stats.total}</b> Parameters
            </span>
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{stats.overridden}</b> Overrides
            </span>
            <span className="hero-stat-chip">
              <Lock size={11} /> <b>{stats.platformEnforced}</b> Enforced
            </span>
            <span className="hero-stat-chip">
              <Shield size={12} color="var(--acc)" />
              <b>Scope:</b> {principal?.tenant_id && principal?.project_id ? `${principal.tenant_id} / ${principal.project_id}` : '—'}
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            {canOverride && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setIsAddOpen(true);
                  setAddError(null);
                  if (selectedTool !== 'ALL') {
                    setNewTool(selectedTool);
                  }
                }}
                title="Define and persist a new parameter set"
              >
                <Plus size={13} /> Add Parameter
              </button>
            )}

            <div className="param-view-toggle">
              <button
                type="button"
                className={`param-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Switch to high-density table view"
              >
                <List size={13} /> Table
              </button>
              <button
                type="button"
                className={`param-view-btn ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setViewMode('cards')}
                title="Switch to card grid view"
              >
                <Grid size={13} /> Cards
              </button>
            </div>

            <button
              className="btn btn-secondary"
              disabled={loading || busy}
              onClick={() => void load()}
              title="Reload all parameters from the server"
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Parameter Lifecycle Stepper (From Architectural Diagram) */}
      <div className="param-lifecycle-strip">
        <div className="param-lifecycle-steps">
          <div className="param-lifecycle-step active">
            <Sparkles size={12} />
            <span>1. Draft (Create & Edit)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <CheckCircle2 size={12} />
            <span>2. Validate (Schema & Security)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Shield size={12} />
            <span>3. Review (Revision Guard)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Database size={12} />
            <span>4. Publish (PostgreSQL)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Cpu size={12} />
            <span>5. Runtime (ADK Bound)</span>
          </div>
        </div>
        <div className="param-lifecycle-meta">
          <span>{stats.overridden} active overrides · Cryptographic revision locks</span>
        </div>
      </div>

      {/* Main Master-Detail Layout */}
      <div className="param-layout">
        {/* Left Providers Sidebar Navigation */}
        <aside className="param-sidebar">
          <div className="param-sidebar-header">
            <div className="param-sidebar-title-row">
              <span className="param-sidebar-label">Providers & Tools</span>
              <span className="param-provider-count">{uniqueTools.length}</span>
            </div>
            <div className="param-sidebar-search">
              <Search size={13} color="var(--muted)" />
              <input
                type="search"
                placeholder="Filter tools…"
                value={providerSearch}
                onChange={e => setProviderSearch(e.target.value)}
              />
              {providerSearch && (
                <button
                  onClick={() => setProviderSearch('')}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <nav className="param-sidebar-list">
            {/* All Providers Option */}
            <button
              type="button"
              className={`param-provider-item ${selectedTool === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedTool('ALL')}
            >
              <div className="param-provider-info">
                <div className="param-provider-icon">
                  <Boxes size={14} />
                </div>
                <div className="param-provider-names">
                  <span className="param-provider-name">All Providers</span>
                  <span className="param-provider-syskey">{uniqueTools.length} connected tools</span>
                </div>
              </div>
              <div className="param-provider-badges">
                {stats.overridden > 0 && <span className="param-override-indicator" title="Has active overrides" />}
                <span className="param-provider-count">{parameters.length}</span>
              </div>
            </button>

            {/* Individual Provider Tools */}
            {filteredSidebarTools.map(toolKey => {
              const meta = getToolMeta(toolKey);
              const toolParams = toolsMap.get(toolKey) || [];
              const hasOverrides = toolParams.some(p => p.override_revision && p.override_revision > 0);
              const isSelected = selectedTool === toolKey;

              return (
                <button
                  key={toolKey}
                  type="button"
                  className={`param-provider-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedTool(toolKey)}
                >
                  <div className="param-provider-info">
                    <div className="param-provider-icon">{meta.icon}</div>
                    <div className="param-provider-names">
                      <span className="param-provider-name">{meta.displayName}</span>
                      <span className="param-provider-syskey">{toolKey}</span>
                    </div>
                  </div>
                  <div className="param-provider-badges">
                    {hasOverrides && (
                      <span className="param-override-indicator" title="Has active project overrides" />
                    )}
                    <span className="param-provider-count">{toolParams.length}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Main Workspace */}
        <main className="param-workspace">
          {/* Filter & Search Toolbar */}
          <div className="param-toolbar">
            <div className="param-search-input-wrap">
              <Search size={14} color="var(--muted)" />
              <input
                type="search"
                placeholder="Search by parameter name, description, or value…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Quick Status Pills */}
              <div className="param-status-filters">
                <button
                  type="button"
                  className={`param-filter-pill ${statusFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('ALL')}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`param-filter-pill ${statusFilter === 'OVERRIDDEN' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('OVERRIDDEN')}
                >
                  Overrides ({stats.overridden})
                </button>
                <button
                  type="button"
                  className={`param-filter-pill ${statusFilter === 'DEFAULT' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('DEFAULT')}
                >
                  Defaults
                </button>
                <button
                  type="button"
                  className={`param-filter-pill ${statusFilter === 'LOCKED' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('LOCKED')}
                >
                  Locked
                </button>
              </div>

              {/* Type Select */}
              <select
                className="param-type-select"
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
              <select className="param-type-select" value={scopeFilter} onChange={e => setScopeFilter(e.target.value as typeof scopeFilter)} aria-label="Filter parameter scope">
                <option value="ALL">All Scopes</option>
                <option value="PLATFORM">Platform Only</option>
                <option value="PROJECT">Project Visible</option>
              </select>

              {/* Expand/Collapse All when in ALL mode */}
              {selectedTool === 'ALL' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => {
                    const anyCollapsed = Object.values(collapsedTools).some(Boolean);
                    setAllCollapsed(!anyCollapsed);
                  }}
                  title="Expand or collapse all provider groups"
                >
                  {Object.values(collapsedTools).some(Boolean) ? 'Expand All' : 'Collapse All'}
                </button>
              )}
            </div>
          </div>

          {/* Workspace Content */}
          <div className="param-content-area">
            {/* Notices & Errors */}
            {error && (
              <div className="notice-banner" role="alert" style={{ borderColor: 'var(--acc-rose)', background: 'rgba(244, 63, 94, 0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--acc-rose)', fontWeight: 600 }}>
                  <AlertCircle size={15} /> Error
                </div>
                <p style={{ margin: '4px 0 0', color: 'var(--tx)', fontSize: 13 }}>{error}</p>
              </div>
            )}

            {notice && (
              <div
                className="notice-banner"
                role="status"
                style={{
                  borderColor: notice.type === 'success' ? '#22c55e' : 'var(--line)',
                  background: notice.type === 'success' ? 'rgba(34, 197, 94, 0.08)' : 'var(--card-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: notice.type === 'success' ? '#22c55e' : 'var(--tx)', fontSize: 13 }}>
                  {notice.type === 'success' ? <CheckCircle2 size={15} /> : <Info size={15} />}
                  <span>{notice.message}</span>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
                <p>Loading parameters from deployment runtime…</p>
              </div>
            )}

            {/* Empty State */}
            {!loading && filteredParameters.length === 0 && (
              <div className="notice-banner" style={{ textAlign: 'center', padding: 40 }}>
                <Sliders size={26} color="var(--muted)" style={{ margin: '0 auto 10px' }} />
                <h3 style={{ margin: 0, fontSize: 15 }}>No matching parameters</h3>
                <p className="metric-meta" style={{ marginTop: 4 }}>
                  No parameters matched the current search query or status filter.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setSelectedTool('ALL');
                      setSearchQuery('');
                      setTypeFilter('ALL');
                      setStatusFilter('ALL');
                    }}
                  >
                    Reset All Filters
                  </button>
                  {canOverride && (
                    <button
                      className="btn btn-primary"
                      onClick={() => setIsAddOpen(true)}
                    >
                      <Plus size={13} /> Add Parameter
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* View Mode: Single Tool Selected */}
            {!loading && selectedTool !== 'ALL' && activeSelectedMeta && (
              <div>
                {/* Active Provider Header Banner */}
                <div className="param-active-provider-header">
                  <div className="param-active-provider-info">
                    <div className="param-active-provider-avatar">{activeSelectedMeta.icon}</div>
                    <div>
                      <h2 className="param-active-provider-title">
                        {activeSelectedMeta.displayName}
                        <span className="param-active-provider-syskey">{selectedTool}</span>
                      </h2>
                      <p className="param-active-provider-desc">{activeSelectedMeta.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                      {filteredParameters.length} parameters
                    </span>
                    {filteredParameters.filter(p => p.override_revision && p.override_revision > 0).length > 0 && (
                      <span className="badge badge-active" style={{ fontSize: '11px' }}>
                        {filteredParameters.filter(p => p.override_revision && p.override_revision > 0).length} overridden
                      </span>
                    )}
                    {canOverride && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                        onClick={() => {
                          setIsAddOpen(true);
                          setNewTool(selectedTool);
                          setAddError(null);
                        }}
                      >
                        <Plus size={12} /> Add to {activeSelectedMeta.displayName}
                      </button>
                    )}
                  </div>
                </div>

                {/* Table View */}
                {viewMode === 'table' ? (
                  <div className="param-table-container" style={{ marginTop: 14 }}>
                    <table className="param-table">
                      <thead>
                        <tr>
                          <th>Parameter Name & Description</th>
                          <th>Type</th>
                          <th>Effective Value</th>
                          <th>Status / Governance</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredParameters.map(renderTableRow)}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Cards View */
                  <div className="param-cards-grid" style={{ marginTop: 14 }}>
                    {filteredParameters.map(renderCard)}
                  </div>
                )}
              </div>
            )}

            {/* View Mode: All Providers Grouped */}
            {!loading && selectedTool === 'ALL' && filteredToolsMap.size > 0 && (
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
                      title="Click to toggle parameters"
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

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                          {toolParams.length}
                        </span>
                        {toolOverrideCount > 0 && (
                          <span className="badge badge-active" style={{ fontSize: '11px' }}>
                            {toolOverrideCount} overridden
                          </span>
                        )}
                        <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </div>

                    {/* Content when not collapsed */}
                    {!isCollapsed && (
                      viewMode === 'table' ? (
                        <div className="param-table-container">
                          <table className="param-table">
                            <thead>
                              <tr>
                                <th>Parameter Name & Description</th>
                                <th>Type</th>
                                <th>Effective Value</th>
                                <th>Status / Governance</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {toolParams.map(renderTableRow)}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="param-cards-grid">
                          {toolParams.map(renderCard)}
                        </div>
                      )
                    )}
                  </section>
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* Slide-Over Drawer Inspector (Portaled to document.body) */}
      {drawerPortal}

      {/* Add Parameter Modal (Portaled to document.body) */}
      {addParameterModal}
    </div>
  );
}
