import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  Activity,
  Wrench,
  Plus,
  RefreshCw,
  Database,
  Layers,
  Terminal,
  ShieldAlert,
  Sparkles,
  Radio,
  BookOpen,
  GitBranch,
  Search,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  ToolDefinition,
  Principal,
  ParameterDefinitionRow,
  ConnectorTemplateItem,
  ProjectConnectorInstanceItem,
  CapabilityItem,
  ConnectorsHealthResponse,
  RuntimeConfig,
} from '../types/api';
import {
  fetchTools,
  fetchConnectorTemplates,
  fetchProjectConnectors,
  fetchParameters,
  fetchProjectSetup,
  saveTemplateParameters,
  fetchCapabilities,
  fetchConnectorsHealth,
  fetchConfig,
} from '../services/api';
import {
  ConnectorsForm,
} from '../components/connectors';
import { ConnectorInstanceEditor } from '../components/ConnectorInstanceEditor';
import { IntegrationForm } from '../components/IntegrationForm';
import '../styles/connector-editor.css';
import '../styles/tools-workspace.css';
import type { ActivePage } from '../components/Sidebar';

interface ToolsProps {
  tools: ToolDefinition[];
  principal: Principal;
  onNavigate?: (page: ActivePage) => void;
}

// Unified Connector Item derived from real backend data
export interface BackendConnectorItem {
  id: string;
  system_name: string;
  name: string;
  category: string;
  description: string;
  brandColor: string;
  iconType: string;
  status: 'connected' | 'degraded' | 'not_configured' | 'planned' | 'disabled';
  template?: ConnectorTemplateItem;
  tool?: ToolDefinition;
  projectInstance?: ProjectConnectorInstanceItem;
}

// Compute brand visual tokens from system_name or category dynamically
function getConnectorVisuals(systemName: string, category: string): { brandColor: string; iconType: string } {
  const s = systemName.toLowerCase();
  const c = category.toLowerCase();

  if (s.includes('jira') || s === 'itsm' || c.includes('ticket')) {
    return { brandColor: '#0052cc', iconType: 'jira' };
  }
  if (s.includes('splunk') || s === 'log_search' || c.includes('observability') || c.includes('log')) {
    return { brandColor: '#10b981', iconType: 'splunk' };
  }
  if (s.includes('confluence') || c.includes('knowledge') || c.includes('doc')) {
    return { brandColor: '#0284c7', iconType: 'confluence' };
  }
  if (s.includes('signalfx') || c.includes('apm') || c.includes('metric')) {
    return { brandColor: '#f43f5e', iconType: 'signalfx' };
  }
  if (s.includes('qtest') || c.includes('test') || c.includes('qa')) {
    return { brandColor: '#06b6d4', iconType: 'qtest' };
  }
  if (s.includes('unix') || s.includes('linux') || s.includes('host') || s.includes('shell')) {
    return { brandColor: '#475569', iconType: 'unix' };
  }
  if (s.includes('oracle') || c.includes('database') || c.includes('sql')) {
    return { brandColor: '#dc2626', iconType: 'oracle' };
  }
  if (s.includes('kafka') || c.includes('event') || c.includes('stream')) {
    return { brandColor: '#7c3aed', iconType: 'kafka' };
  }
  if (s.includes('kube') || c.includes('container') || c.includes('orchestration')) {
    return { brandColor: '#2563eb', iconType: 'kubernetes' };
  }
  if (s.includes('git') || c.includes('devops') || c.includes('ci')) {
    return { brandColor: '#f97316', iconType: 'gitlab' };
  }

  // Dynamic deterministic hue based on string hash for custom or MCP tools
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return { brandColor: `hsl(${hue}, 65%, 48%)`, iconType: 'custom' };
}

export interface ActionRegistryRow {
  actionId: string;
  actionName: string;
  systemName: string;
  connectorName: string;
  brandColor: string;
  stages: string[];
  capabilities: { id: string; name: string }[];
  minRole: string;
  safetyProfile: string;
  policyStatus: 'enabled' | 'restricted';
  isCustom: boolean;
}

export const Tools: React.FC<ToolsProps> = ({ tools: initialTools, principal }) => {
  // Live Backend Datasets
  const [toolsList, setToolsList] = useState<ToolDefinition[]>(initialTools);
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [projectConnectors, setProjectConnectors] = useState<ProjectConnectorInstanceItem[]>([]);
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [capabilitiesList, setCapabilitiesList] = useState<CapabilityItem[]>([]);
  const [connectorsHealth, setConnectorsHealth] = useState<ConnectorsHealthResponse | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);

  // Selected Connector Key & UI Filter States
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'restricted' | 'saved' | 'custom'>('all');
  const [actionsScope, setActionsScope] = useState<'selected' | 'all'>('selected');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProjectConnectorInstanceItem | 'new' | null>(null);
  const [environments, setEnvironments] = useState<{id: string; name: string}[]>([]);
  const [dirty, setDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const canManage = principal.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role));
  const leaveEdits = () => (!dirty && !templateDirty) || window.confirm('Discard unsaved template changes?');

  const isPlatformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const canEdit = isPlatformAdmin;

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  const handleSyncCatalog = async () => {
    if (!leaveEdits()) return;
    setIsSyncing(true);
    try {
      await loadBackendData();
      setRefreshRevision(revision => revision + 1);
      setDirty(false); setTemplateDirty(false);
      showToast('Synchronized with live connector templates and parameters.');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to refresh connectors.');
    } finally {
      setIsSyncing(false);
    }
  };

  const loadBackendData = useCallback(async () => {
    const [fetchedParams, fetchedTemplates, fetchedTools, connections, setup, fetchedCaps, fetchedHealth, fetchedCfg] = await Promise.all([
      fetchParameters(isPlatformAdmin ? 'template' : undefined),
      fetchConnectorTemplates(),
      fetchTools(),
      fetchProjectConnectors(principal.project_id),
      fetchProjectSetup(),
      fetchCapabilities(true).catch(() => []),
      fetchConnectorsHealth().catch(() => null),
      fetchConfig().catch(() => null),
    ]);
    setParameters(fetchedParams);
    setConnectorTemplates(fetchedTemplates);
    setToolsList(fetchedTools);
    setProjectConnectors(connections);
    setEnvironments((setup.runtime.environments || []).filter(env => env.enabled !== false));
    setCapabilitiesList(fetchedCaps);
    setConnectorsHealth(fetchedHealth);
    setRuntimeConfig(fetchedCfg);
    setLoadError(null);
  }, [isPlatformAdmin, principal.project_id]);

  useEffect(() => {
    void loadBackendData().catch(error => setLoadError(error instanceof Error ? error.message : 'Unable to load connectors.'))
      .finally(() => setIsSyncing(false));
  }, [loadBackendData]);

  // Dynamically derive all connectors from the real backend templates & tools
  const backendConnectors = useMemo<BackendConnectorItem[]>(() => {
    const map = new Map<string, BackendConnectorItem>();

    // 1. Add all platform connector templates loaded from backend
    for (const tmpl of connectorTemplates) {
      const sys = tmpl.system_name || tmpl.template_id || tmpl.type;
      const matchingTool = toolsList.find(t => (t.system_name || t.id).toLowerCase() === sys.toLowerCase());
      const matchingInstance = projectConnectors.find(
        c => (c.system_name || c.instance_id).toLowerCase() === sys.toLowerCase() || c.template_id === tmpl.template_id
      );
      const visuals = getConnectorVisuals(sys, tmpl.category || '');

      let status: BackendConnectorItem['status'] = 'not_configured';
      if (tmpl.is_enabled_by_policy === false) {
        status = 'disabled';
      } else if (matchingTool) {
        status = matchingTool.status;
      }

      map.set(sys.toLowerCase(), {
        id: sys.toLowerCase(),
        system_name: sys,
        name: tmpl.name || sys.toUpperCase(),
        category: tmpl.category || 'Connector',
        description: tmpl.description || '',
        brandColor: visuals.brandColor,
        iconType: visuals.iconType,
        status,
        template: tmpl,
        tool: matchingTool,
        projectInstance: matchingInstance,
      });
    }

    // 2. Add any tools from toolsList not yet in map (e.g. MCP / A2A custom tools)
    for (const tool of toolsList) {
      const sys = (tool.system_name || tool.id).toLowerCase();
      if (!map.has(sys)) {
        const visuals = getConnectorVisuals(sys, tool.category || '');
        map.set(sys, {
          id: sys,
          system_name: tool.system_name || tool.id,
          name: tool.name || sys.toUpperCase(),
          category: tool.category || 'Tool',
          description: tool.description || '',
          brandColor: visuals.brandColor,
          iconType: visuals.iconType,
          status: tool.status,
          tool,
        });
      }
    }

    // Dynamic sort: policy-enabled first, then alphabetical by name
    return Array.from(map.values()).sort((a, b) => {
      const aDisabled = a.template?.is_enabled_by_policy === false;
      const bDisabled = b.template?.is_enabled_by_policy === false;
      if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [connectorTemplates, toolsList, projectConnectors]);

  // Derived filter counts for status chips
  const enabledCount = useMemo(() => backendConnectors.filter(c => c.template?.is_enabled_by_policy !== false).length, [backendConnectors]);
  const restrictedCount = useMemo(() => backendConnectors.filter(c => c.template?.is_enabled_by_policy === false).length, [backendConnectors]);
  const withSavedCount = useMemo(() => backendConnectors.filter(c =>
    projectConnectors.some(inst => inst.system_name.toLowerCase() === c.system_name.toLowerCase() || inst.template_id === c.template?.template_id)
  ).length, [backendConnectors, projectConnectors]);
  const customCount = useMemo(() => backendConnectors.filter(c => !c.template).length, [backendConnectors]);

  // Filtered connectors based on search query and status filter
  const visibleConnectors = useMemo(() => {
    const query = search.toLowerCase().trim();
    return backendConnectors.filter(conn => {
      if (query && !`${conn.name} ${conn.category} ${conn.system_name}`.toLowerCase().includes(query)) {
        return false;
      }
      if (statusFilter === 'enabled') {
        return conn.template?.is_enabled_by_policy !== false;
      }
      if (statusFilter === 'restricted') {
        return conn.template?.is_enabled_by_policy === false;
      }
      if (statusFilter === 'saved') {
        return projectConnectors.some(inst =>
          inst.system_name.toLowerCase() === conn.system_name.toLowerCase() ||
          inst.template_id === conn.template?.template_id
        );
      }
      if (statusFilter === 'custom') {
        return !conn.template;
      }
      return true;
    });
  }, [backendConnectors, search, statusFilter, projectConnectors]);

  // Selected connector item
  const selectedConnector = useMemo<BackendConnectorItem | null>(() => {
    return (
      backendConnectors.find(c => c.id === selectedConnectorId) ||
      backendConnectors.find(c => c.system_name.toLowerCase() === selectedConnectorId.toLowerCase()) ||
      backendConnectors[0] ||
      null
    );
  }, [backendConnectors, selectedConnectorId]);

  // Shared parameters declared for the selected connector
  const currentSharedParams = useMemo<ParameterDefinitionRow[]>(() => {
    if (!selectedConnector) return [];
    const sys = selectedConnector.system_name.toLowerCase();
    if (selectedConnector.template?.shared_parameters && selectedConnector.template.shared_parameters.length > 0) {
      return selectedConnector.template.shared_parameters;
    }
    return parameters.filter(p => p.tool.toLowerCase() === sys);
  }, [selectedConnector, parameters]);

  const sharedParamMap = useMemo<Map<string, ParameterDefinitionRow>>(() => {
    const map = new Map<string, ParameterDefinitionRow>();
    for (const p of currentSharedParams) {
      map.set(p.variable_name, p);
    }
    return map;
  }, [currentSharedParams]);

  // Unified ConnectorsForm Template Adapter
  const selectedConnectorRevision = currentSharedParams.map(row => `${row.variable_name}:${row.revision}`).join('|');

  const handleFormSave = async (data: FormData) => {
    if (!selectedConnector) return;
    const targetTool = selectedConnector.system_name.toLowerCase();
    const targetName = selectedConnector.name;
    const fields = selectedConnector.template?.parameter_fields || [];
    try {
      const changes: Record<string, { value: unknown; expected_revision: number }> = {};
      for (const field of fields) {
        if (!field.template_editable || field.value_type === 'secret_ref') continue;
        const parameter = sharedParamMap.get(field.variable_name);
        if (!parameter) continue;

        const raw = data.get(field.variable_name);
        let value: unknown = raw === null ? (field.value_type === 'boolean' ? false : '') : String(raw);
        if (field.value_type === 'boolean') value = value === true || value === 'true';
        else if (field.value_type === 'integer') value = Number(value);
        else if (field.value_type === 'number') value = Number(value);
        else if (field.value_type === 'json') {
          try {
            value = JSON.parse(String(value));
          } catch {
            throw new Error(`${field.label || field.variable_name} must contain valid JSON.`);
          }
        }

        const currentValue = parameter.active_value !== undefined
          ? parameter.active_value
          : parameter.effective_value !== undefined
            ? parameter.effective_value
            : parameter.default_value;
        if (JSON.stringify(value) !== JSON.stringify(currentValue)) {
          changes[field.variable_name] = { value, expected_revision: parameter.revision };
        }
      }

      if (Object.keys(changes).length > 0) {
        await saveTemplateParameters(targetTool, { changes });
        await loadBackendData();
        showToast(`Connector template '${targetName}' saved successfully.`);
      } else {
        showToast('No template parameter changes detected to save.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setLoadError(`Save failed: ${msg}`);
      throw err;
    }
  };

  // Dynamic Avatar renderer
  const renderConnectorAvatar = (conn: BackendConnectorItem, size = 44) => {
    const { brandColor, iconType } = conn;
    if (iconType === 'jira') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <span style={{ fontSize: size * 0.5, fontWeight: 800 }}>J</span>
        </div>
      );
    }
    if (iconType === 'splunk') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Activity size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'confluence') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <BookOpen size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'signalfx') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Activity size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'qtest') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <CheckCircle2 size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'unix') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Terminal size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'oracle') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Database size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'kafka') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Radio size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'kubernetes') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Layers size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'gitlab') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <GitBranch size={size * 0.5} />
        </div>
      );
    }
    return (
      <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
        <Sparkles size={size * 0.5} />
      </div>
    );
  };

  // KPI telemetry metrics
  const isDemoMode = (runtimeConfig?.mode || connectorsHealth?.mode || 'demo').toLowerCase() === 'demo';
  const savedConnectionsCount = projectConnectors.length;
  const allEnvConnections = useMemo(() => projectConnectors.flatMap(c => c.environment_connections || []), [projectConnectors]);
  const testPassedCount = useMemo(() => allEnvConnections.filter(ec => ec.test_status === 'passed').length, [allEnvConnections]);
  const testFailedCount = useMemo(() => allEnvConnections.filter(ec => ec.test_status === 'failed').length, [allEnvConnections]);
  const testNotTestedCount = useMemo(() => allEnvConnections.filter(ec => !ec.test_status || ec.test_status === 'not_tested').length, [allEnvConnections]);

  // Derived inventory of all ADK actions mapped to capability stages
  const allActionRows = useMemo<ActionRegistryRow[]>(() => {
    const rows: ActionRegistryRow[] = [];
    const seenActions = new Set<string>();

    for (const conn of backendConnectors) {
      const sys = conn.system_name.toLowerCase();
      const actionsForConn: string[] = [];
      if (conn.tool?.actions && conn.tool.actions.length > 0) {
        actionsForConn.push(...conn.tool.actions);
      }
      for (const cap of capabilitiesList) {
        const req = (cap.required_connectors || []).map(c => c.toLowerCase());
        const opt = (cap.optional_connectors || []).map(c => c.toLowerCase());
        if (req.includes(sys) || opt.includes(sys)) {
          for (const act of cap.permissions?.allowed_actions || []) {
            if (act.startsWith(`${sys}.`) && !actionsForConn.includes(act)) {
              actionsForConn.push(act);
            }
          }
        }
      }
      if (actionsForConn.length === 0 && conn.tool?.id && conn.tool.id.includes('.')) {
        actionsForConn.push(conn.tool.id);
      }

      for (const actionId of actionsForConn) {
        if (seenActions.has(actionId)) continue;
        seenActions.add(actionId);

        const matchingCaps = capabilitiesList.filter(cap =>
          (cap.permissions?.allowed_actions || []).includes(actionId) ||
          ((cap.required_connectors || []).map(c => c.toLowerCase()).includes(sys)) ||
          ((cap.requires?.connectors || []).map(c => c.toLowerCase()).includes(sys)) ||
          ((cap.optional_connectors || []).map(c => c.toLowerCase()).includes(sys)) ||
          ((cap.optional?.connectors || []).map(c => c.toLowerCase()).includes(sys))
        );

        // Stages directly from live backend capability definition
        const stages = Array.from(new Set(matchingCaps.flatMap(c => c.agent_stages || [])));

        const caps = matchingCaps.map(c => ({ id: c.id, name: c.name }));
        const minRole = matchingCaps[0]?.permissions?.minimum_role || '';

        // Safety profile directly derived from capability safety_profile
        const safety = matchingCaps[0]?.safety_profile;
        const safetyParts: string[] = [];
        if (safety?.tool_mutations) {
          safetyParts.push(safety.tool_mutations === 'forbidden' ? 'Read-Only (Mutations Forbidden)' : `Mutations: ${safety.tool_mutations}`);
        }
        if (safety?.pii_access) {
          safetyParts.push(`PII: ${safety.pii_access.replace(/_/g, ' ')}`);
        }
        if (safety?.external_network) {
          safetyParts.push(`Network: ${safety.external_network.replace(/_/g, ' ')}`);
        }
        const safetyProfile = safetyParts.length > 0 ? safetyParts.join(' · ') : 'Standard Execution';

        const isRestricted = conn.template?.is_enabled_by_policy === false;
        const parts = actionId.split('.');
        const method = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
        const actionLabel = method.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        rows.push({
          actionId,
          actionName: actionLabel,
          systemName: conn.system_name,
          connectorName: conn.name,
          brandColor: conn.brandColor,
          stages,
          capabilities: caps,
          minRole,
          safetyProfile,
          policyStatus: isRestricted ? 'restricted' : 'enabled',
          isCustom: !conn.template,
        });
      }
    }
    return rows;
  }, [backendConnectors, capabilitiesList]);

  const displayedActionRows = useMemo(() => {
    if (actionsScope === 'all') return allActionRows;
    if (!selectedConnector) return [];
    const sys = selectedConnector.system_name.toLowerCase();
    return allActionRows.filter(r => r.systemName.toLowerCase() === sys);
  }, [allActionRows, actionsScope, selectedConnector]);

  const selectedInstances = projectConnectors.filter(instance =>
    instance.system_name === selectedConnector?.system_name || instance.template_id === selectedConnector?.template?.template_id);
  const blocked = selectedConnector?.template?.is_enabled_by_policy === false;

  return (
    <div className="view-container tools-page connector-workspace">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            <Wrench size={22} color="var(--acc)" />
            Connectors & <span>Telemetry Integrations</span>
          </h1>
          <p className="hero-lede">
            Manage shared templates, candidate connection testing, and active project integrations.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Activity size={12} /> <b>{backendConnectors.length}</b> Templates
            </span>
            <span className="hero-stat-chip highlight">
              <span className={`dot ${isDemoMode ? '' : 'pulse'}`} /> <b>{enabledCount}</b> Active
            </span>
            <span className="hero-stat-chip">
              <ShieldCheck size={12} /> <b>{restrictedCount}</b> Restricted
            </span>
            <span className="hero-stat-chip">
              Mode: <b>{isDemoMode ? 'Demo' : 'Live'}</b>
            </span>
          </div>
        </div>
        <div className="hero-actions">
          <div className="hero-actions-row">
            <button className="btn btn-secondary" onClick={handleSyncCatalog} disabled={isSyncing}>
              <RefreshCw size={13} aria-hidden="true" className={isSyncing ? 'spin' : ''} /> {isSyncing ? 'Refreshing…' : 'Refresh'}
            </button>
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setIsCreatingCustom(true)}>
                <Plus size={13} aria-hidden="true" /> Custom integration
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Accurate Health & Telemetry Summary Strip */}
      <div className="connector-telemetry-strip" role="region" aria-label="Connector telemetry summaries">
        <div className="connector-stat-card">
          <div className="connector-stat-card-header">
            <span className="connector-stat-card-title"><Activity size={14} aria-hidden="true" /> Deployment Mode</span>
            <span className={`telemetry-badge ${isDemoMode ? 'demo' : 'live'}`}>
              {isDemoMode ? 'Demo Offline' : 'Live Active'}
            </span>
          </div>
          <div className="connector-stat-card-value">
            {runtimeConfig?.mode?.toUpperCase() || connectorsHealth?.mode?.toUpperCase() || (isDemoMode ? 'DEMO MODE' : 'LIVE MODE')}
          </div>
          <div className="connector-stat-card-meta">
            {isDemoMode
              ? (connectorsHealth?.connectors && Object.values(connectorsHealth.connectors)[0]?.message) ||
                'External network calls simulated offline by architectural configuration.'
              : 'Live network connectivity active for authenticated connectors.'}
          </div>
        </div>

        <div className="connector-stat-card">
          <div className="connector-stat-card-header">
            <span className="connector-stat-card-title"><ShieldCheck size={14} aria-hidden="true" /> Policy Availability</span>
            <span className={`telemetry-badge ${restrictedCount > 0 ? 'restricted' : 'active'}`}>
              {restrictedCount > 0 ? `${restrictedCount} Restricted` : 'All Permitted'}
            </span>
          </div>
          <div className="connector-stat-card-value">
            <span>{enabledCount}</span>
            <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>of {backendConnectors.length} active</span>
          </div>
          <div className="connector-stat-card-meta">
            {connectorsHealth?.disabled && connectorsHealth.disabled.length > 0
              ? `Restricted by policy: ${connectorsHealth.disabled.join(', ')}.`
              : 'All registered platform connectors permitted under active project policy.'}
          </div>
        </div>

        <div className="connector-stat-card">
          <div className="connector-stat-card-header">
            <span className="connector-stat-card-title"><CheckCircle2 size={14} aria-hidden="true" /> Connection Tests</span>
            <span className="telemetry-badge" style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>
              {savedConnectionsCount} Saved
            </span>
          </div>
          <div className="connector-stat-card-value">
            <span style={{ color: '#166534' }}>{testPassedCount} Passed</span>
            {testFailedCount > 0 && <span style={{ color: '#991b1b', margin: '0 6px' }}>· {testFailedCount} Failed</span>}
            <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>({testNotTestedCount} untested)</span>
          </div>
          <div className="connector-stat-card-meta">
            {savedConnectionsCount > 0
              ? `${allEnvConnections.length} environment endpoint configurations tested for candidate reachability.`
              : 'No saved connection instances configured for this project yet.'}
          </div>
        </div>

        <div className="connector-stat-card">
          <div className="connector-stat-card-header">
            <span className="connector-stat-card-title"><Lock size={14} aria-hidden="true" /> Credential Binding</span>
            <span className="telemetry-badge" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
              env:// Scoped
            </span>
          </div>
          <div className="connector-stat-card-value" style={{ fontSize: '14px' }}>
            <span>{parameters.length} Parameters</span>
            <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>declared</span>
          </div>
          <div className="connector-stat-card-meta">
            Environment variables resolve credentials securely at runtime; secrets avoid plaintext database persistence.
          </div>
        </div>
      </div>

      {loadError && <NotificationBanner type="error" message={loadError} autoCloseMs={0} onClose={() => setLoadError(null)} />}
      {toastMessage && <NotificationBanner type="success" message={toastMessage} onClose={() => setToastMessage(null)} />}

      {/* Modern Master-Detail Studio Layout */}
      <div className="connector-studio-layout" aria-busy={isSyncing}>
        {/* LEFT SIDEBAR: Master Connector Catalog */}
        <aside className="connector-studio-sidebar" aria-label="Connector catalog navigation">
          <div className="connector-sidebar-header">
            <div className="connector-sidebar-heading-row">
              <div className="connector-sidebar-title">
                <Layers size={16} className="connector-sidebar-icon" />
                <span>Connectors</span>
              </div>
              <span className="connector-sidebar-badge">{backendConnectors.length} total</span>
            </div>

            {/* Compact Search Bar */}
            <div className="connector-sidebar-search-wrap">
              <Search size={14} className="connector-sidebar-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="connector-sidebar-search-input"
                placeholder="Filter connectors…"
                value={search}
                onChange={event => setSearch(event.target.value)}
                aria-label="Search connectors"
              />
              {search && (
                <button
                  type="button"
                  className="connector-sidebar-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Status Filter Tabs / Chips inside sidebar */}
            <div className="connector-sidebar-filter-tabs" role="group" aria-label="Filter connectors by status">
              <button
                type="button"
                className={`sidebar-filter-tab ${statusFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All <span className="tab-count">{backendConnectors.length}</span>
              </button>
              <button
                type="button"
                className={`sidebar-filter-tab ${statusFilter === 'enabled' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('enabled')}
              >
                Enabled <span className="tab-count">{enabledCount}</span>
              </button>
              <button
                type="button"
                className={`sidebar-filter-tab ${statusFilter === 'restricted' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('restricted')}
              >
                Restricted <span className="tab-count">{restrictedCount}</span>
              </button>
              <button
                type="button"
                className={`sidebar-filter-tab ${statusFilter === 'saved' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('saved')}
              >
                Saved <span className="tab-count">{withSavedCount}</span>
              </button>
              {customCount > 0 && (
                <button
                  type="button"
                  className={`sidebar-filter-tab ${statusFilter === 'custom' ? 'is-active' : ''}`}
                  onClick={() => setStatusFilter('custom')}
                >
                  MCP <span className="tab-count">{customCount}</span>
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Connector Cards List */}
          <div className="connector-sidebar-items" role="listbox" aria-label="Available connectors">
            {visibleConnectors.length === 0 ? (
              <div className="connector-sidebar-empty-state">
                <p>No connectors match the filter criteria.</p>
              </div>
            ) : (
              visibleConnectors.map(conn => {
                const isSelected = conn.id === selectedConnector?.id;
                const isRestricted = conn.template?.is_enabled_by_policy === false;
                const savedInstancesForConn = projectConnectors.filter(
                  c => c.system_name === conn.system_name || c.template_id === conn.template?.template_id
                );

                return (
                  <button
                    key={conn.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`connector-sidebar-item ${isSelected ? 'is-selected' : ''} ${isRestricted ? 'is-restricted' : ''}`}
                    onClick={() => {
                      if (isSelected) return;
                      if (leaveEdits()) {
                        setDirty(false);
                        setTemplateDirty(false);
                        setEditing(null);
                        setSelectedConnectorId(conn.id);
                      }
                    }}
                  >
                    <div className="sidebar-item-avatar">
                      {renderConnectorAvatar(conn, 34)}
                    </div>
                    <div className="sidebar-item-meta">
                      <div className="sidebar-item-top">
                        <span className="sidebar-item-name">{conn.name}</span>
                        <span
                          className={`sidebar-item-status-dot ${isRestricted ? 'dot-restricted' : conn.status === 'connected' ? 'dot-ready' : 'dot-available'}`}
                          title={isRestricted ? 'Restricted by policy' : conn.status}
                        />
                      </div>
                      <div className="sidebar-item-bottom">
                        <span className="sidebar-item-cat">{conn.category.replaceAll('_', ' ')}</span>
                        {savedInstancesForConn.length > 0 && (
                          <span className="sidebar-item-saved-badge">
                            {savedInstancesForConn.length} saved
                          </span>
                        )}
                        {isRestricted && (
                          <span className="sidebar-item-policy-tag">Restricted</span>
                        )}
                      </div>
                    </div>
                    {isSelected && <div className="sidebar-item-active-bar" />}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* RIGHT MAIN AREA: Selected Connector Detail & Form Workspace */}
        <main className="connector-studio-main" aria-label="Connector detail workspace">
          {selectedConnector ? (
            <div className="connector-studio-detail">
              {/* Selected Connector Hero Header */}
              <header className="connector-detail-heading connector-studio-hero">
                <div className="connector-hero-header-row">
                  <div className="connector-hero-left">
                    {renderConnectorAvatar(selectedConnector, 46)}
                    <div className="connector-hero-info">
                      <div className="connector-hero-title-row">
                        <h2>{selectedConnector.name}</h2>
                        <span className={`connector-lifecycle ${blocked ? 'restricted' : ''}`}>
                          {blocked ? 'Restricted by policy' : selectedConnector.template?.status || selectedConnector.template?.availability || selectedConnector.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <div className="connector-hero-meta-pills">
                        <span className="hero-meta-pill">Category: <strong>{selectedConnector.category.replaceAll('_', ' ')}</strong></span>
                        <span className="hero-meta-pill">Provider: <strong>{selectedConnector.system_name}</strong></span>
                        <span className="hero-meta-pill">{selectedConnector.template ? `Template v${selectedConnector.template.version}` : 'Custom Integration'}</span>
                        <span className="hero-meta-pill">Binding: <strong>env:// credentials</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Project Connection Instance Selector (Clean top-right bar) */}
                  <div className="connector-instance-selector-bar">
                    <label htmlFor="project-connection-select" className="instance-selector-label">
                      Project connection:
                    </label>
                    <div className="instance-selector-dropdown-wrap">
                      <select
                        id="project-connection-select"
                        value={editing && editing !== 'new' ? editing.instance_id : ''}
                        onChange={event => {
                          if (leaveEdits()) {
                            setDirty(false);
                            setTemplateDirty(false);
                            setEditing(selectedInstances.find(instance => instance.instance_id === event.target.value) || null);
                          }
                        }}
                        className="instance-selector-select"
                      >
                        <option value="">+ New connection draft</option>
                        {selectedInstances.map(instance => (
                          <option key={instance.instance_id} value={instance.instance_id}>
                            {instance.system_name} · {instance.status} ({instance.instance_id.slice(0, 10)}…)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <p className="connector-hero-description">{selectedConnector.description}</p>
              </header>

              {blocked && (
                <div className="connector-policy">
                  <ShieldAlert size={18} aria-hidden="true" />
                  <p>This connector is unavailable for execution under the current policy. You can review its template settings.</p>
                </div>
              )}

              {/* The Continuous Form Grid */}
              <div className="connector-continuous-workspace">
                {selectedConnector.template ? (
                  <ConnectorInstanceEditor
                    key={`${selectedConnector.id}:${editing && editing !== 'new' ? editing.instance_id : 'new'}:${refreshRevision}`}
                    projectId={principal.project_id}
                    principal={principal}
                    template={selectedConnector.template}
                    instance={editing && editing !== 'new' ? editing : undefined}
                    availableEnvironments={environments}
                    readOnly={!canManage || blocked}
                    templateDirty={templateDirty}
                    onDirtyChange={setDirty}
                    onSave={async saved => { setEditing(saved); await loadBackendData(); }}
                    onGovernanceSaved={loadBackendData}
                    templateDefaults={
                      <ConnectorsForm
                        key={`${selectedConnector.id}:${selectedConnectorRevision}:${refreshRevision}`}
                        view="defaults"
                        parameterFields={selectedConnector.template.parameter_fields || []}
                        sharedParameters={currentSharedParams}
                        fieldGovernance={selectedConnector.template.field_governance || []}
                        governanceRevision={selectedConnector.template.governance_revision || 0}
                        templateSystemName={selectedConnector.template.system_name}
                        isPlatformAdmin={isPlatformAdmin}
                        onGovernanceSaved={loadBackendData}
                        readOnly={!canEdit}
                        hideHeader
                        connectorName={selectedConnector.name}
                        onDirtyChange={setTemplateDirty}
                        onSave={handleFormSave}
                      />
                    }
                  />
                ) : (
                  <div className="connector-empty-large">
                    <h3>Custom integration</h3>
                    <p>{selectedConnector.description}</p>
                    <button className="btn btn-secondary" disabled={!canEdit} onClick={() => setIsCreatingCustom(true)}>
                      Manage custom integrations
                    </button>
                  </div>
                )}
              </div>

            {/* ADK Tool Actions & Capability Assignments Registry Table */}
            <div className="connector-actions-registry" aria-label="Tool actions and capabilities">
              <div className="connector-actions-header">
                <div className="connector-actions-title-wrap">
                  <div className="connector-actions-icon-badge">
                    <Terminal size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h3>ADK Tool Actions & Capability Assignments</h3>
                    <p>
                      Authorized tool action signatures mapped to Google ADK LlmAgent workflows, stage lifecycles, and RBAC permission boundaries.
                    </p>
                  </div>
                </div>
                <div className="connector-actions-toggle" role="group" aria-label="Toggle action scope">
                  <button
                    type="button"
                    className={actionsScope === 'selected' ? 'is-active' : ''}
                    onClick={() => setActionsScope('selected')}
                  >
                    Selected ({selectedConnector.name})
                  </button>
                  <button
                    type="button"
                    className={actionsScope === 'all' ? 'is-active' : ''}
                    onClick={() => setActionsScope('all')}
                  >
                    All Actions ({allActionRows.length})
                  </button>
                </div>
              </div>

              <div className="connector-actions-table-wrapper">
                {displayedActionRows.length > 0 ? (
                  <table className="connector-actions-table">
                    <thead>
                      <tr>
                        <th>Action Signature</th>
                        <th>Provider Connector</th>
                        <th>Assigned Stages</th>
                        <th>Bound Capabilities</th>
                        <th>Access Boundary</th>
                        <th>Safety Constraints</th>
                        <th>Policy State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedActionRows.map(row => (
                        <tr key={row.actionId}>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--tx)' }}>{row.actionName}</div>
                            <span className="action-signature-tag">{row.actionId}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: row.brandColor }} />
                              <span style={{ fontWeight: 600 }}>{row.connectorName}</span>
                              {row.isCustom && <span className="telemetry-badge demo">MCP</span>}
                            </div>
                          </td>
                          <td>
                            {row.stages.length > 0 ? (
                              row.stages.map(st => (
                                <span key={st} className={`stage-badge ${st}`}>{st}</span>
                              ))
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>Unassigned</span>
                            )}
                          </td>
                          <td>
                            {row.capabilities.length > 0 ? (
                              row.capabilities.map(cap => (
                                <span key={cap.id} className="capability-pill" title={cap.id}>
                                  {cap.name}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>Platform Specialist Bound</span>
                            )}
                          </td>
                          <td>
                            {row.minRole ? (
                              <span className="role-boundary-chip">{row.minRole}+</span>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{row.safetyProfile}</span>
                          </td>
                          <td>
                            <span className={`telemetry-badge ${row.policyStatus === 'enabled' ? 'active' : 'restricted'}`}>
                              {row.policyStatus === 'enabled' ? 'Permitted' : 'Restricted'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                    <p style={{ margin: 0 }}>
                      No ADK action signatures are bound directly to <strong>{selectedConnector.name}</strong>.
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: '11px' }}>
                      This connector operates as an external telemetry provider or planned data source. Switch to <em>All Actions</em> to review the full ADK catalog.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : (
            <div className="connector-studio-empty">
              <Layers size={36} />
              <h2>{isSyncing ? 'Loading connector library…' : 'No connector selected'}</h2>
              <p>{loadError ? 'Refresh to retry loading connectors.' : 'Choose a connector from the catalog on the left to configure settings.'}</p>
            </div>
          )}
        </main>
      </div>
      {isCreatingCustom && (
        <IntegrationForm
          principal={principal}
          onClose={() => setIsCreatingCustom(false)}
          onSaved={async () => { await loadBackendData(); setIsCreatingCustom(false); }}
        />
      )}
    </div>
  );
};
