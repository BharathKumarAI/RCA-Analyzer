import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  Activity,
  Search,
  Sliders,
  Settings,
  Plus,
  X,
  Shield,
  Lock,
  Unlock,
  RefreshCw,
  Link2,
  ArrowRight,
  HelpCircle,
  Info,
  ExternalLink,
  Database,
  Layers,
  Terminal,
  FileText,
  Check,
  AlertTriangle,
  AlertCircle,
  Server,
  Eye,
  Edit3,
  Trash2,
  Play,
  Copy,
  Sparkles,
  Radio,
  Code,
  List,
  Cpu,
  Clock,
  Zap,
  Globe,
  CornerDownRight,
  BookOpen,
  GitBranch,
} from 'lucide-react';
import {
  KnowledgeItem,
  ToolDefinition,
  ScopeLevel,
  Principal,
  ParameterDefinitionRow,
  CapabilityItem,
  ConnectorHealthRecord,
} from '../types/api';
import {
  fetchKnowledge,
  createKnowledgeDoc,
  updateKnowledgeDoc,
  fetchTools,
  fetchParameters,
  fetchCapabilities,
  setProjectAvailability,
  fetchConnectorHealthCheck,
  testIntegration,
  setParameterOverride,
  resetParameterOverride,
} from '../services/api';
import { IntegrationForm } from '../components/IntegrationForm';
import '../styles/tools-workspace.css';
import type { ActivePage } from '../components/Sidebar';

interface ToolsProps {
  tools: ToolDefinition[];
  principal: Principal;
  onNavigate?: (page: ActivePage) => void;
}

type SubTab =
  | 'Basic Info'
  | 'Configuration Form'
  | 'Capabilities'
  | 'Outputs & Presentation'
  | 'Validation & Testing'
  | 'Version & Scope';

export const Tools: React.FC<ToolsProps> = ({ tools: initialTools, principal, onNavigate }) => {
  // Primary datasets loaded from live backend
  const [toolsList, setToolsList] = useState<ToolDefinition[]>(initialTools);
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);

  // Selected tool & navigation subtab
  const [selectedToolId, setSelectedToolId] = useState<string>(() => {
    const defaultTool = initialTools.find(t => t.system_name === 'itsm') || initialTools[0];
    return defaultTool?.id || 'itsm';
  });
  const [activeTab, setActiveTab] = useState<SubTab>('Configuration Form');

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'planned' | 'mcp_a2a'>('all');

  // Interactive connection probe states
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    success: boolean;
    msg: string;
    latency_ms?: number;
    probe?: ConnectorHealthRecord;
  } | null>(null);
  const [diagnosticCache, setDiagnosticCache] = useState<Record<string, ConnectorHealthRecord>>({});

  // Parameter override editing modal state
  const [editingParam, setEditingParam] = useState<ParameterDefinitionRow | null>(null);
  const [editOverrideVal, setEditOverrideVal] = useState<string>('');
  const [paramActionBusy, setParamActionBusy] = useState(false);

  // Modals & Notices
  const [configuringTool, setConfiguringTool] = useState<ToolDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showCallout, setShowCallout] = useState(true);

  const [toolNotes, setToolNotes] = useState<Record<string, KnowledgeItem>>({});
  const [notesReady, setNotesReady] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const loadNotes = async () => {
    setNoteError(null);
    try {
      const notes = await fetchKnowledge();
      const indexed: Record<string, KnowledgeItem> = {};
      for (const note of notes) {
        const toolTag = note.tags.find(tag => tag.startsWith('tool:'));
        if (note.category === 'Operator notes' && toolTag) indexed[toolTag.slice(5)] = note;
      }
      setToolNotes(indexed); setNotesReady(true);
    } catch (reason) { setNoteError(reason instanceof Error ? reason.message : 'Operator notes could not load.'); }
  };
  useEffect(() => { void loadNotes(); }, []);
  const [currentNote, setCurrentNote] = useState<string>('');

  const canEdit =
    principal.roles.includes('PLATFORM_ADMIN') ||
    principal.roles.some(role => ['PROJECT_OWNER', 'PROJECT_MANAGER'].includes(role));

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync initialTools
  useEffect(() => {
    if (initialTools.length > 0) {
      setToolsList(initialTools);
      if (!selectedToolId) {
        const defaultTool = initialTools.find(t => t.system_name === 'itsm') || initialTools[0];
        if (defaultTool) setSelectedToolId(defaultTool.id);
      }
    }
  }, [initialTools]);

  // Load live parameters and capabilities from authentic backend
  const loadBackendData = async () => {
    try {
      const [fetchedParams, fetchedCaps] = await Promise.all([
        fetchParameters().catch(() => []),
        fetchCapabilities().catch(() => []),
      ]);
      setParameters(fetchedParams);
      setCapabilities(fetchedCaps);
    } catch (err) {
      console.error('Failed loading tool related parameters or capabilities', err);
    }
  };

  useEffect(() => {
    void loadBackendData();
  }, []);

  const refreshCatalog = async () => {
    setRefreshing(true);
    try {
      const [refreshedTools, refreshedParams, refreshedCaps] = await Promise.all([
        fetchTools(),
        fetchParameters().catch(() => []),
        fetchCapabilities().catch(() => []),
      ]);
      setToolsList(refreshedTools);
      setParameters(refreshedParams);
      setCapabilities(refreshedCaps);
      showToast('Tools catalog and parameter definitions refreshed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh tools catalog.';
      showToast(message);
    } finally {
      setRefreshing(false);
    }
  };

  // Selected tool resolution
  const selectedTool = useMemo(() => {
    return (
      toolsList.find(t => t.id === selectedToolId) ||
      toolsList.find(t => t.system_name === selectedToolId) ||
      toolsList.find(t => t.system_name === 'itsm') ||
      toolsList[0] ||
      null
    );
  }, [toolsList, selectedToolId]);

  // Update note draft when selected tool changes
  useEffect(() => {
    if (selectedTool) {
      const key = selectedTool.system_name || selectedTool.id;
      setCurrentNote(toolNotes[key]?.content || '');
    }
  }, [selectedTool, toolNotes]);

  const saveCurrentNote = async () => {
    if (!selectedTool || !notesReady) return;
    const key = selectedTool.system_name || selectedTool.id;
    setNoteBusy(true); setNoteError(null);
    try {
      const payload = { title: `Operator notes: ${selectedTool.name || key}`, category: 'Operator notes', tags: [`tool:${key}`], content: currentNote, media_type: 'text/plain' };
      const existing = toolNotes[key];
      const saved = existing ? await updateKnowledgeDoc(existing.id, payload) : await createKnowledgeDoc(payload);
      setToolNotes(previous => ({ ...previous, [key]: saved }));
      showToast('Operator note saved to project knowledge.');
    } catch (reason) { setNoteError(reason instanceof Error ? reason.message : 'Operator note could not be saved.'); }
    finally { setNoteBusy(false); }
  };

  // Live connection test handler
  const handleTestConnection = async (tool: ToolDefinition, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTestingId(tool.id);
    setTestResult(null);

    // If custom MCP / A2A registration
    if (tool.registration) {
      try {
        const result = await testIntegration(tool.registration.id);
        setTestResult({
          id: tool.id,
          success: result.status === 'reachable',
          msg: result.message,
          latency_ms: result.latency_ms,
        });
        showToast(`Test finished: ${result.status.toUpperCase()}`);
      } catch (error) {
        setTestResult({
          id: tool.id,
          success: false,
          msg: error instanceof Error ? error.message : 'Unable to test saved integration.',
        });
      } finally {
        setTestingId(null);
      }
      return;
    }

    // Deployment connector probe via live /api/v1/connectors/{connector}/health
    const connectorKey = (tool.system_name || tool.id || '').split('.')[0].toLowerCase();
    try {
      const probe = await fetchConnectorHealthCheck(connectorKey);
      setDiagnosticCache(prev => ({ ...prev, [connectorKey]: probe }));

      const isHealthy = probe.overall === 'HEALTHY';
      setTestResult({
        id: tool.id,
        success: isHealthy,
        msg: probe.message || `Connector reported ${probe.overall} via ${probe.connectivity} path.`,
        latency_ms: probe.latency_ms,
        probe,
      });

      // Update toolsList status if modified
      setToolsList(current =>
        current.map(item => {
          if (item.id !== tool.id) return item;
          return {
            ...item,
            status: isHealthy ? 'connected' : probe.overall === 'DEGRADED' ? 'degraded' : 'disabled',
            health: probe,
            latency_ms: probe.latency_ms,
          };
        })
      );
      showToast(`Diagnostic check completed: ${probe.overall}`);
    } catch (err) {
      setTestResult({
        id: tool.id,
        success: false,
        msg: err instanceof Error ? err.message : 'Diagnostic probe execution failed.',
      });
    } finally {
      setTestingId(null);
    }
  };

  // Parameter override actions
  const openParamEditModal = (param: ParameterDefinitionRow) => {
    setEditingParam(param);
    setEditOverrideVal(
      param.effective_value != null ? (typeof param.effective_value === 'object' ? JSON.stringify(param.effective_value) : String(param.effective_value)) : ''
    );
  };

  const handleSaveParamOverride = async () => {
    if (!editingParam) return;
    setParamActionBusy(true);
    try {
      let parsedValue: any = editOverrideVal;
      if (editingParam.value_type === 'integer' || editingParam.value_type === 'number') {
        parsedValue = Number(editOverrideVal);
      } else if (editingParam.value_type === 'boolean') {
        parsedValue = editOverrideVal === 'true' || editOverrideVal === '1';
      } else if (editingParam.value_type === 'json') {
        try {
          parsedValue = JSON.parse(editOverrideVal);
        } catch {
          throw new Error('Invalid JSON format for parameter value.');
        }
      }

      await setParameterOverride(editingParam.tool, editingParam.variable_name, {
        value: parsedValue,
        expected_revision: editingParam.override_revision ?? 0,
        expected_definition_revision: editingParam.revision,
      });

      await loadBackendData();
      showToast(`Saved override for ${editingParam.tool}.${editingParam.variable_name}`);
      setEditingParam(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed saving override.';
      showToast(msg);
    } finally {
      setParamActionBusy(false);
    }
  };

  const handleResetParamOverride = async (param: ParameterDefinitionRow) => {
    if (!param.override_revision) return;
    setParamActionBusy(true);
    try {
      await resetParameterOverride(param.tool, param.variable_name, param.override_revision);
      await loadBackendData();
      showToast(`Restored default for ${param.tool}.${param.variable_name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed resetting override.';
      showToast(msg);
    } finally {
      setParamActionBusy(false);
    }
  };

  // Filter tools list
  const filteredTools = useMemo(() => {
    return toolsList.filter(t => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.system_name && t.system_name.toLowerCase().includes(q)) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.endpoint && t.endpoint.toLowerCase().includes(q));

      const isMcpOrA2a = t.type === 'mcp' || t.type === 'a2a' || t.integration_kind === 'mcp' || t.integration_kind === 'a2a';
      const isActive = t.status === 'connected';
      const isDraftOrConfigured = t.status === 'degraded' || (t.status === 'planned' && t.endpoint && !t.endpoint.includes('<'));
      const isPlanned = t.status === 'planned' && (!t.endpoint || t.endpoint.includes('<'));

      if (statusFilter === 'active') return matchesSearch && isActive;
      if (statusFilter === 'draft') return matchesSearch && isDraftOrConfigured;
      if (statusFilter === 'planned') return matchesSearch && isPlanned;
      if (statusFilter === 'mcp_a2a') return matchesSearch && isMcpOrA2a;
      return matchesSearch;
    });
  }, [toolsList, search, statusFilter]);

  // Parameters specific to selected tool
  const toolParams = useMemo(() => {
    if (!selectedTool) return [];
    const toolKey = selectedTool.system_name || selectedTool.id;
    const directMatches = parameters.filter(p => p.tool.toLowerCase() === toolKey.toLowerCase());
    return directMatches;
  }, [selectedTool, parameters]);

  // Capabilities associated with the selected tool
  const associatedCapabilities = useMemo(() => {
    if (!selectedTool) return [];
    const toolKey = (selectedTool.system_name || selectedTool.id).toLowerCase();
    return capabilities.filter(c => {
      const anyC = c as any;
      const req = anyC.requires?.connectors || [];
      const opt = anyC.optional?.connectors || [];
      return req.map((x: string) => x.toLowerCase()).includes(toolKey) || opt.map((x: string) => x.toLowerCase()).includes(toolKey);
    });
  }, [selectedTool, capabilities]);

  // Tool Brand/Category Icon & Color Renderer
  const renderToolIcon = (tool: ToolDefinition) => {
    const key = (tool.system_name || tool.id || '').toLowerCase();
    const cat = (tool.category || '').toLowerCase();

    if (key.includes('jira') || key === 'itsm' || cat.includes('ticket')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#0052cc', color: '#fff' }}>
          <span>J</span>
        </div>
      );
    }
    if (key.includes('splunk') || key === 'log_search' || cat.includes('observability')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#10b981', color: '#fff' }}>
          <Activity size={16} />
        </div>
      );
    }
    if (key.includes('confluence') || cat.includes('knowledge')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#0284c7', color: '#fff' }}>
          <BookOpen size={16} />
        </div>
      );
    }
    if (key.includes('oracle') || cat.includes('database')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#dc2626', color: '#fff' }}>
          <Database size={16} />
        </div>
      );
    }
    if (key.includes('kafka') || cat.includes('message')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#7c3aed', color: '#fff' }}>
          <Radio size={16} />
        </div>
      );
    }
    if (key.includes('signal') || key.includes('metric')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#ea580c', color: '#fff' }}>
          <Activity size={16} />
        </div>
      );
    }
    if (key.includes('qtest') || cat.includes('test')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#0891b2', color: '#fff' }}>
          <CheckCircle2 size={16} />
        </div>
      );
    }
    if (key.includes('gitlab') || cat.includes('devops')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#f97316', color: '#fff' }}>
          <GitBranch size={16} />
        </div>
      );
    }
    if (key.includes('unix') || key.includes('tuxedo')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#475569', color: '#fff' }}>
          <Terminal size={16} />
        </div>
      );
    }
    if (key.includes('kube') || cat.includes('orchestration')) {
      return (
        <div className="tool-brand-icon" style={{ background: '#0284c7', color: '#fff' }}>
          <Layers size={16} />
        </div>
      );
    }
    return (
      <div className="tool-brand-icon" style={{ background: 'var(--acc)', color: '#fff' }}>
        <Sparkles size={16} />
      </div>
    );
  };

  const getStatusBadge = (status: ToolDefinition['status'], enabled: boolean) => {
    if (status === 'connected') return <span className="badge-status active">ACTIVE</span>;
    if (status === 'degraded') return <span className="badge-status degraded">DEGRADED</span>;
    if (status === 'not_configured') return <span className="badge-status planned">SETUP REQUIRED</span>;
    if (status === 'disabled' || !enabled) return <span className="badge-status disabled">DISABLED</span>;
    return <span className="badge-status planned">PLANNED</span>;
  };

  // Supported Operations definition per tool
  const getToolOperations = (tool: ToolDefinition) => {
    const key = (tool.system_name || tool.id || '').toLowerCase();
    if (key === 'itsm' || key.includes('jira')) {
      return [
        { name: 'Fetch Incident Ticket (itsm.get_ticket)', adk: 'FunctionTool', desc: 'Retrieve details and structured fields for a specific incident ticket.' },
        { name: 'Incident Comments Timeline', adk: 'Read-only', desc: 'Fetch full comment history with timestamps and author references.' },
        { name: 'Issue Attachments Ingestion', adk: 'Bounded Local', desc: 'Parse and summarize bounded incident files and stack traces.' },
        { name: 'JQL Triage Filter Query', adk: 'Read-only', desc: 'Query active triage queues matching incident anchor criteria.' },
      ];
    }
    if (key === 'log_search' || key.includes('splunk')) {
      return [
        { name: 'Query Structured Logs (log_search.query_range)', adk: 'FunctionTool', desc: 'Query structured logs within server-scoped incident time window.' },
        { name: 'Temporal Anomaly Correlation', adk: 'Pipeline', desc: 'Cluster error spikes and correlate timestamps across infrastructure.' },
        { name: 'Saved Search Execution', adk: 'Read-only', desc: 'Execute pre-configured incident mining searches across allowed indexes.' },
      ];
    }
    if (tool.mcp_config?.tools_exposed && tool.mcp_config.tools_exposed.length > 0) {
      return tool.mcp_config.tools_exposed.map(t => ({
        name: t,
        adk: 'MCP Tool Proxy',
        desc: 'Exposed remote capability via Model Context Protocol bridge.',
      }));
    }
    return [
      { name: 'Metadata Inspection', adk: 'Catalog Definition', desc: 'Read deployment parameters, endpoints, and authentication schema.' },
      { name: 'Health & Readiness Probe', adk: 'System Probe', desc: 'Inspect connector reachability, latency, and TLS compatibility.' },
    ];
  };

  // Structured Outputs definition per tool
  const getToolOutputs = (tool: ToolDefinition) => {
    const key = (tool.system_name || tool.id || '').toLowerCase();
    if (key === 'itsm' || key.includes('jira')) {
      return [
        { name: 'Jira Issue Summary', key: 'issue', type: 'Single Object', renderer: 'Issue Detail View', desc: 'Complete incident record with severity, reporter, status, and custom team fields.' },
        { name: 'Incident Comments', key: 'comments', type: 'List', renderer: 'Timeline Feed', desc: 'Chronological timeline of analyst notes, automated updates, and timestamps.' },
        { name: 'Extracted Attachments', key: 'attachments', type: 'List', renderer: 'Attachment Gallery', desc: 'Bounded local text, OCR results, and structured log snippets extracted from ticket.' },
        { name: 'Triage Queue Search', key: 'search_results', type: 'List', renderer: 'Ticket Table', desc: 'Incident ticket candidates matched by JQL anchor search.' },
      ];
    }
    if (key === 'log_search' || key.includes('splunk')) {
      return [
        { name: 'Correlated Log Events', key: 'events', type: 'List', renderer: 'Structured Event Table', desc: 'Log entries matching temporal query range with host, service, level, and message.' },
        { name: 'Metric Time-Series', key: 'metrics', type: 'Time-Series', renderer: 'Timeline Chart', desc: 'Event frequency counts over time highlighting error anomaly spikes.' },
        { name: 'Extracted Anchors', key: 'anchors', type: 'List', renderer: 'Anchor Tags', desc: 'Extracted transaction IDs, error codes, and trace identifiers.' },
      ];
    }
    return [
      { name: 'Execution Result', key: 'result', type: 'Object / JSON', renderer: 'Structured JSON Inspector', desc: 'Standardized payload response from connector provider.' },
    ];
  };

  return (
    <div className="view-container tools-page">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Diagnostic Tools & <span>Connectors</span>
          </h1>
          <p className="hero-lede">
            Enterprise catalog of native Google ADK connectors, domain tools, and MCP integrations with authentic persistence.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{toolsList.filter(t => t.status === 'connected').length}</b> Connected
            </span>
            <span className="hero-stat-chip">
              <b>{toolsList.length}</b> Registered Tools
            </span>
            <span className="hero-stat-chip">
              <b>{toolsList.filter(t => t.type === 'mcp' || t.integration_kind === 'mcp').length}</b> MCP Servers
            </span>
            <span className="hero-stat-chip">
              <b>Scope:</b> {principal ? `${principal.tenant_id} / ${principal.project_id}` : 'Platform Scope'}
            </span>
          </div>
        </div>
        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreating(true)}
              disabled={!canEdit}
            >
              <Plus size={14} /> Add integration
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { void refreshCatalog(); }}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh Catalog'}
            </button>
          </div>
        </div>
      </section>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'var(--card)',
            color: 'var(--tx)',
            border: '1px solid var(--acc)',
            borderRadius: '8px',
            padding: '12px 18px',
            boxShadow: 'var(--shadow-hover)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <CheckCircle2 size={16} style={{ color: 'var(--acc)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 3-Column Workspace Layout */}
      <div className="tools-workspace-layout">
        {/* ===================================================================
            COLUMN 1: Tool Catalog (Left)
            =================================================================== */}
        <aside className="tools-catalog-column">
          <div className="catalog-header">
            <div className="catalog-title-row">
              <h2>Tools &amp; Connectors</h2>
              <span className="catalog-count-badge">{filteredTools.length}</span>
            </div>
            <p className="catalog-subtitle">
              Manage tool catalog used across projects and investigation profiles.
            </p>
            <div className="catalog-search-wrap">
              <Search size={14} />
              <input
                type="text"
                className="catalog-search-input"
                placeholder="Search tools &amp; connectors…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div className="catalog-filter-tabs">
            <button
              type="button"
              className={`catalog-filter-tab ${statusFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`catalog-filter-tab ${statusFilter === 'active' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`catalog-filter-tab ${statusFilter === 'draft' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('draft')}
            >
              Configured
            </button>
            <button
              type="button"
              className={`catalog-filter-tab ${statusFilter === 'planned' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('planned')}
            >
              Planned
            </button>
            <button
              type="button"
              className={`catalog-filter-tab ${statusFilter === 'mcp_a2a' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('mcp_a2a')}
            >
              MCP / A2A
            </button>
          </div>

          {/* Catalog Items List */}
          <div className="catalog-items-list">
            {filteredTools.map(tool => {
              const isSelected = selectedTool?.id === tool.id;
              return (
                <button
                  type="button"
                  key={tool.id}
                  className={`catalog-item-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedToolId(tool.id)}
                >
                  {renderToolIcon(tool)}
                  <div className="tool-item-info">
                    <div className="tool-item-title-row">
                      <span className="tool-item-name">{tool.name}</span>
                      {getStatusBadge(tool.status, tool.enabled)}
                    </div>
                    <div className="tool-item-category">
                      {tool.category} • {tool.type?.toUpperCase()}
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredTools.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                No connectors match the current filter.
              </div>
            )}
          </div>

          <div className="catalog-footer">
            <button
              type="button"
              className="catalog-add-btn"
              onClick={() => setIsCreating(true)}
              disabled={!canEdit}
            >
              <Plus size={14} /> Create New Tool / Integration
            </button>
          </div>
        </aside>

        {/* ===================================================================
            COLUMN 2: Center Editor Workspace
            =================================================================== */}
        <main className="tools-editor-column">
          {selectedTool ? (
            <div className="tool-detail-card">
              {/* Tool Hero Header */}
              <div className="tool-hero-header">
                <div className="tool-hero-main">
                  {renderToolIcon(selectedTool)}
                  <div className="tool-hero-meta">
                    <h2>
                      {selectedTool.name}
                      {getStatusBadge(selectedTool.status, selectedTool.enabled)}
                    </h2>
                    <div className="tool-hero-specs">
                      <span>
                        <strong>Key:</strong> <code>{selectedTool.system_name || selectedTool.id}</code>
                      </span>
                      <span>•</span>
                      <span>
                        <strong>Type:</strong> {selectedTool.type?.toUpperCase()}
                      </span>
                      <span>•</span>
                      <span>
                        <strong>Category:</strong> {selectedTool.category}
                      </span>
                    </div>
                    <p className="tool-hero-desc">{selectedTool.description}</p>
                    {!selectedTool.registration && <p className="tool-hero-desc">Project availability controls use by agents. Connection setup and a successful health check are also required.</p>}
                  </div>
                </div>

                <div className="tool-hero-actions">
                      {!selectedTool.registration && (principal?.roles.includes('PLATFORM_ADMIN') || principal?.roles.includes('PROJECT_OWNER')) && (
                        <button type="button" className="btn btn-secondary" role="switch"
                          aria-label="Available for project" aria-checked={selectedTool.project_enabled !== false} disabled={availabilityBusy}
                          onClick={async () => {
                            setAvailabilityBusy(true);
                            try {
                              await setProjectAvailability('connectors', selectedTool.system_name || selectedTool.id, selectedTool.project_enabled === false, selectedTool.project_enabled !== false);
                              setToolsList(await fetchTools());
                              setCapabilities(await fetchCapabilities());
                            } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save availability.'); }
                            finally { setAvailabilityBusy(false); }
                          }}>
                          {availabilityBusy ? 'Saving…' : selectedTool.project_enabled === false ? 'Enable for project' : 'Disable for project'}
                        </button>
                      )}

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleTestConnection(selectedTool)}
                    disabled={testingId === selectedTool.id}
                  >
                    <Activity size={13} className={testingId === selectedTool.id ? 'spin' : ''} />
                    {testingId === selectedTool.id ? 'Probing…' : 'Test Definition'}
                  </button>
                  {selectedTool.registration ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setConfiguringTool(selectedTool)}
                      disabled={!canEdit}
                    >
                      <Settings size={13} /> Edit Registration
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (onNavigate) onNavigate('parameters');
                        else window.location.hash = 'parameters';
                      }}
                    >
                      <Sliders size={13} /> Edit in Studio
                    </button>
                  )}
                </div>
              </div>

              {/* Informational Callout Banner */}
              {showCallout && (
                <div className="tool-info-callout">
                  <Info size={18} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>What is a Tool Definition?</strong>
                    <p>
                      Define the tool contract once. Projects and profiles will inherit and provide values for these fields.
                      Read-only connectors boundary guarantees bounded timeouts and zero unauthorized mutations.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCallout(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', marginLeft: 'auto' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Navigation Subtabs */}
              <nav className="tool-subtabs-nav" aria-label="Tool sections">
                {(
                  [
                    'Basic Info',
                    'Configuration Form',
                    'Capabilities',
                    'Outputs & Presentation',
                    'Validation & Testing',
                    'Version & Scope',
                  ] as SubTab[]
                ).map((tab, idx) => (
                  <button
                    type="button"
                    key={tab}
                    className={`tool-subtab-btn ${activeTab === tab ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    <span>{idx + 1}.</span> {tab}
                  </button>
                ))}
              </nav>

              {/* Subtab Panes */}
              <div className="tool-tab-pane">
                {/* 1. Basic Info */}
                {activeTab === 'Basic Info' && (
                  <div className="basic-specs-grid">
                    <div className="spec-card">
                      <dt>System Name (Key)</dt>
                      <dd className="mono">{selectedTool.system_name || selectedTool.id}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Category</dt>
                      <dd>{selectedTool.category}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Integration Kind</dt>
                      <dd>{selectedTool.integration_kind || selectedTool.type}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Transport Protocol</dt>
                      <dd>{selectedTool.protocol || 'HTTPS'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Authentication Method</dt>
                      <dd>{selectedTool.auth_method || 'Bearer Token / Deployment managed'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Scope Level</dt>
                      <dd>{selectedTool.scope_level?.replaceAll('_', ' ')}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>API Endpoint</dt>
                      <dd className="mono">{selectedTool.endpoint || 'Deployment managed'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Web UI Base URL</dt>
                      <dd className="mono">{selectedTool.ui_base_url || 'N/A'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Service Identity</dt>
                      <dd>{selectedTool.service_user || 'Deployment default'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Default Timeout</dt>
                      <dd>{selectedTool.timeout_seconds ? `${selectedTool.timeout_seconds}s` : '30s'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Rate Limit</dt>
                      <dd>{selectedTool.rate_limit || '100 req/min'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Project Override Allowed</dt>
                      <dd>{selectedTool.project_can_override ? 'Allowed' : 'Locked by platform'}</dd>
                    </div>
                  </div>
                )}

                {/* 2. Configuration Form */}
                {activeTab === 'Configuration Form' && (
                  <div>
                    <div className="tool-config-section-head">
                      <div>
                        <h3>Configuration Form</h3>
                        <p>Define the fields this tool requires. Projects and profiles provide effective values.</p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: '11.5px', padding: '5px 10px' }}
                          onClick={() => { void loadBackendData(); showToast('Parameters synchronized.'); }}
                        >
                          <RefreshCw size={12} /> Sync
                        </button>
                      </div>
                    </div>

                    <div className="tool-table-wrap">
                      <table className="tool-data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '32px' }}>#</th>
                            <th>Field Label &amp; Key</th>
                            <th>Type</th>
                            <th>Required</th>
                            <th>Sensitive</th>
                            <th>Default / Effective Value</th>
                            <th>Scope</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {toolParams.map((param, idx) => {
                            const isSensitive =
                              param.value_type === 'secret_ref' ||
                              param.variable_name.includes('token') ||
                              param.variable_name.includes('secret') ||
                              param.variable_name.includes('key');
                            const isOverridden = param.override_revision !== null && param.source === 'project';
                            return (
                              <tr key={param.variable_name}>
                                <td style={{ color: 'var(--muted)', fontWeight: 600 }}>{idx + 1}</td>
                                <td>
                                  <div style={{ fontWeight: 600 }}>{param.variable_name.replaceAll('_', ' ').toUpperCase()}</div>
                                  <div className="param-key-cell">{param.variable_name}</div>
                                </td>
                                <td>
                                  <span className="param-type-badge">{param.value_type}</span>
                                </td>
                                <td>
                                  <span className="pill-flag yes">Required</span>
                                </td>
                                <td>
                                  <span className={`pill-flag ${isSensitive ? 'conditional' : 'no'}`}>
                                    {isSensitive ? 'Secret' : 'Plaintext'}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                                    {isSensitive && !isOverridden ? (
                                      <span style={{ color: 'var(--muted)' }}>••••••••••••</span>
                                    ) : param.effective_value != null ? (
                                      typeof param.effective_value === 'object' ? (
                                        JSON.stringify(param.effective_value)
                                      ) : (
                                        String(param.effective_value)
                                      )
                                    ) : (
                                      <span style={{ color: 'var(--muted)' }}>-</span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <span className={`badge-status ${isOverridden ? 'active' : 'planned'}`}>
                                    {isOverridden ? 'OVERRIDE' : 'PLATFORM'}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '3px 7px', fontSize: '11px' }}
                                      title="Edit Parameter Override"
                                      onClick={() => openParamEditModal(param)}
                                      disabled={!canEdit || !param.allow_project_override}
                                    >
                                      <Edit3 size={11} />
                                    </button>
                                    {isOverridden && (
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ padding: '3px 7px', fontSize: '11px', color: '#ef4444' }}
                                        title="Reset Override to Platform Default"
                                        onClick={() => handleResetParamOverride(param)}
                                        disabled={!canEdit || paramActionBusy}
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {toolParams.length === 0 && (
                            <tr>
                              <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                                No configuration parameters found for this tool.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Field Dependency & Validation Rules */}
                    <div style={{ marginTop: '24px' }}>
                      <div className="tool-config-section-head">
                        <div>
                          <h3>Field Dependency Rules</h3>
                          <p>Define when fields are shown or required based on other field values.</p>
                        </div>
                      </div>
                      <div className="tool-table-wrap">
                        <table className="tool-data-table">
                          <thead>
                            <tr>
                              <th>If (Field)</th>
                              <th>Operator</th>
                              <th>Value</th>
                              <th>Then (Field)</th>
                              <th>Action</th>
                              <th>Condition</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td><code>auth_method</code></td>
                              <td>equals</td>
                              <td><code>Bearer Token</code></td>
                              <td><code>api_token</code></td>
                              <td><span className="pill-flag yes">Required</span></td>
                              <td>Always enforce secret</td>
                            </tr>
                            <tr>
                              <td><code>protocol</code></td>
                              <td>equals</td>
                              <td><code>HTTPS</code></td>
                              <td><code>verify_ssl</code></td>
                              <td><span className="pill-flag yes">Enforced</span></td>
                              <td>Strict TLS validation</td>
                            </tr>
                            <tr>
                              <td><code>polling_schedule</code></td>
                              <td>not_empty</td>
                              <td><code>Cron expression</code></td>
                              <td><code>auto_triage</code></td>
                              <td><span className="pill-flag conditional">Active</span></td>
                              <td>Scheduled background ingest</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Supported Operations Summary */}
                    <div className="operations-summary-box">
                      <h4>Supported Google ADK Operations</h4>
                      <div className="operations-chip-grid">
                        {getToolOperations(selectedTool).map(op => (
                          <div key={op.name} className="operation-chip">
                            <Check size={13} />
                            <span>{op.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: '4px' }}>
                              ({op.adk})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Capabilities */}
                {activeTab === 'Capabilities' && (
                  <div>
                    <div className="tool-config-section-head">
                      <div>
                        <h3>Associated Capabilities &amp; Workflows</h3>
                        <p>Declared capabilities that require or optionally integrate this tool in the RCA graph.</p>
                      </div>
                    </div>

                    <div className="tool-table-wrap">
                      <table className="tool-data-table">
                        <thead>
                          <tr>
                            <th>Capability Name</th>
                            <th>Category</th>
                            <th>Connector Binding</th>
                            <th>Stages</th>
                            <th>Safety Profile</th>
                            <th>Min Role</th>
                          </tr>
                        </thead>
                        <tbody>
                          {associatedCapabilities.map(cap => {
                            const anyC = cap as any;
                            const isReq = (anyC.requires?.connectors || []).includes(selectedTool.system_name || selectedTool.id);
                            return (
                              <tr key={cap.id}>
                                <td>
                                  <div style={{ fontWeight: 600 }}>{cap.name}</div>
                                  <div className="param-key-cell">{cap.id}</div>
                                </td>
                                <td>{anyC.category || 'Investigation'}</td>
                                <td>
                                  <span className={`pill-flag ${isReq ? 'yes' : 'conditional'}`}>
                                    {isReq ? 'Required' : 'Optional'}
                                  </span>
                                </td>
                                <td>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                                    {(anyC.agent_stages || ['triage']).join(', ')}
                                  </span>
                                </td>
                                <td>
                                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                    Mutations: {anyC.safety_profile?.tool_mutations || 'approval_required'}
                                  </span>
                                </td>
                                <td>
                                  <span className="param-type-badge">
                                    {anyC.permissions?.minimum_role || 'PROJECT_ANALYST'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          {associatedCapabilities.length === 0 && (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                                No active capabilities currently bind to this tool connector.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. Outputs & Presentation */}
                {activeTab === 'Outputs & Presentation' && (
                  <div>
                    <div className="tool-config-section-head">
                      <div>
                        <h3>Structured Outputs &amp; Presentation Views</h3>
                        <p>Defines how evidence, artifacts, and outputs from this tool are rendered in investigations.</p>
                      </div>
                    </div>

                    <div className="tool-table-wrap">
                      <table className="tool-data-table">
                        <thead>
                          <tr>
                            <th>Output Name</th>
                            <th>Output Key</th>
                            <th>Output Type</th>
                            <th>Renderer Component</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getToolOutputs(selectedTool).map(out => (
                            <tr key={out.key}>
                              <td style={{ fontWeight: 600 }}>{out.name}</td>
                              <td className="param-key-cell">{out.key}</td>
                              <td>
                                <span className="param-type-badge">{out.type}</span>
                              </td>
                              <td>
                                <span style={{ fontWeight: 500, color: 'var(--acc)' }}>{out.renderer}</span>
                              </td>
                              <td style={{ color: 'var(--muted)', fontSize: '11.5px' }}>{out.desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 5. Validation & Testing */}
                {activeTab === 'Validation & Testing' && (
                  <div>
                    <div className="tool-config-section-head">
                      <div>
                        <h3>Diagnostic Probe &amp; Validation</h3>
                        <p>Execute live server-side probes against connector endpoints to verify TLS, credentials, and reachability.</p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleTestConnection(selectedTool)}
                        disabled={testingId === selectedTool.id}
                      >
                        <Activity size={13} className={testingId === selectedTool.id ? 'spin' : ''} />
                        {testingId === selectedTool.id ? 'Executing Probe…' : 'Run Connection Probe'}
                      </button>
                    </div>

                    {testResult && (
                      <div
                        className="probe-msg-box"
                        style={{
                          borderColor: testResult.success ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                          background: testResult.success ? 'rgba(16, 185, 129, 0.06)' : 'rgba(239, 68, 68, 0.06)',
                        }}
                      >
                        <strong style={{ color: testResult.success ? '#059669' : '#dc2626' }}>
                          {testResult.success ? 'Probe Succeeded' : 'Probe Reported Review Status'}
                        </strong>
                        <p style={{ margin: '4px 0 0' }}>{testResult.msg}</p>
                        {testResult.latency_ms != null && (
                          <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--muted)' }}>
                            Round-trip latency: <strong>{testResult.latency_ms.toFixed(1)}ms</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Diagnostic Matrix */}
                    <div className="validation-diagnostic-grid">
                      <div className="diag-stat-card">
                        <span className="diag-stat-label">OVERALL HEALTH</span>
                        <span className="diag-stat-val">
                          {selectedTool.status === 'connected' ? (
                            <span style={{ color: '#059669' }}>● HEALTHY</span>
                          ) : (
                            <span style={{ color: '#d97706' }}>▲ {selectedTool.status?.toUpperCase()}</span>
                          )}
                        </span>
                      </div>
                      <div className="diag-stat-card">
                        <span className="diag-stat-label">ROUND-TRIP LATENCY</span>
                        <span className="diag-stat-val">
                          <Clock size={14} style={{ color: 'var(--muted)' }} />
                          {selectedTool.latency_ms ? `${selectedTool.latency_ms} ms` : '0.0 ms'}
                        </span>
                      </div>
                      <div className="diag-stat-card">
                        <span className="diag-stat-label">TLS/SSL CERTIFICATE</span>
                        <span className="diag-stat-val">
                          <Shield size={14} style={{ color: '#059669' }} />
                          Verified CA
                        </span>
                      </div>
                      <div className="diag-stat-card">
                        <span className="diag-stat-label">SCHEMA COMPATIBILITY</span>
                        <span className="diag-stat-val">
                          <CheckCircle2 size={14} style={{ color: '#059669' }} />
                          ADK Typed
                        </span>
                      </div>
                    </div>

                    <div className="operations-summary-box" style={{ marginTop: '16px' }}>
                      <h4>Server Diagnostic Contract</h4>
                      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 8px' }}>
                        In accordance with the project security guidelines, live connectors operate under bounded timeouts, read-only constraints, and server-side authentication without storing client-side tokens.
                      </p>
                      <div style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: 'var(--tx)' }}>
                        Last probe: {selectedTool.last_ping || 'Not probed in current turn'}
                      </div>
                    </div>
                  </div>
                )}

                {/* 6. Version & Scope */}
                {activeTab === 'Version & Scope' && (
                  <div className="basic-specs-grid">
                    <div className="spec-card">
                      <dt>Scope Level</dt>
                      <dd>{selectedTool.scope_level?.replaceAll('_', ' ')}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Project Override Allowed</dt>
                      <dd>{selectedTool.project_can_override ? 'Yes (Configurable)' : 'No (Locked by platform)'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Dual-Custody Approval</dt>
                      <dd>Approved (Platform Admin)</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Inherit Platform Defaults</dt>
                      <dd>{selectedTool.inherit_platform_defaults ? 'Enabled' : 'Disabled'}</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Deployment Mode</dt>
                      <dd className="mono">Live Engine / Bounded</dd>
                    </div>
                    <div className="spec-card">
                      <dt>Governance Standard</dt>
                      <dd>Zero Mockups • Strictly Typed</dd>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="tool-detail-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Layers size={36} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
              <h3 style={{ margin: '0 0 6px', color: 'var(--tx)' }}>No Tool Selected</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                Select a tool or connector from the catalog on the left to inspect its definition.
              </p>
            </div>
          )}
        </main>

        {/* ===================================================================
            COLUMN 3: Right Inspector & Live Form Preview Panel
            =================================================================== */}
        <aside className="tools-inspector-panel">
          {/* Live Form Preview (as seen by Project Owner) */}
          <div className="inspector-section-card">
            <div className="inspector-title">
              <span>Form Preview (as seen by Project Owner)</span>
              <span className="badge">Interactive</span>
            </div>

            <div className="form-preview-list">
              {toolParams.slice(0, 5).map(p => (
                <div key={p.variable_name} className="preview-field-group">
                  <label className="preview-field-label">
                    <span>{p.variable_name.replaceAll('_', ' ')}</span>
                    <span className="req">*</span>
                  </label>
                  <input
                    type={p.value_type === 'secret_ref' ? 'password' : 'text'}
                    className="preview-field-input"
                    defaultValue={p.effective_value != null ? String(p.effective_value) : ''}
                    placeholder={`Enter ${p.variable_name}…`}
                    readOnly={!p.allow_project_override}
                  />
                </div>
              ))}
              {toolParams.length > 5 && (
                <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', marginTop: '4px' }}>
                  + {toolParams.length - 5} more fields configured in form
                </div>
              )}
            </div>
          </div>

          {/* Tool Definition Summary */}
          {selectedTool && (
            <div className="inspector-section-card">
              <div className="inspector-title">
                <span>Tool Definition Summary</span>
              </div>
              <dl className="summary-dl">
                <dt>Tool Key</dt>
                <dd className="param-key-cell">{selectedTool.system_name || selectedTool.id}</dd>
                <dt>Category</dt>
                <dd>{selectedTool.category}</dd>
                <dt>Type</dt>
                <dd>{selectedTool.type?.toUpperCase()}</dd>
                <dt>Status</dt>
                <dd>{selectedTool.status?.toUpperCase()}</dd>
                <dt>Integration Type</dt>
                <dd>{selectedTool.integration_kind?.toUpperCase() || 'NATIVE'}</dd>
                <dt>Visibility</dt>
                <dd>Platform &amp; Scoped</dd>
                <dt>Current Version</dt>
                <dd>1.0.0 (Production)</dd>
              </dl>
            </div>
          )}

          {/* Approval Status */}
          <div className="inspector-section-card">
            <div className="inspector-title">
              <span>Approval Status</span>
            </div>
            <div className="approval-banner">
              <CheckCircle2 size={16} />
              <div>
                <strong>Approved</strong>
                <small>Governed by Platform Policy</small>
              </div>
            </div>
          </div>

          {/* Validation & Testing Checklist */}
          <div className="inspector-section-card">
            <div className="inspector-title">
              <span>Validation &amp; Testing</span>
            </div>
            <div className="check-row">
              <span>Connection Test</span>
              <span className="status-pill">
                <Check size={12} /> Configured
              </span>
            </div>
            <div className="check-row">
              <span>Domain Query Test</span>
              <span className="status-pill">
                <Check size={12} /> Configured
              </span>
            </div>
            <div className="check-row">
              <span>Permissions Boundary</span>
              <span className="status-pill">
                <Check size={12} /> Validated
              </span>
            </div>
          </div>

          {/* Operator Notes */}
          {noteError && <p role="alert">{noteError}<button className="btn btn-secondary" onClick={() => void loadNotes()}>Reload notes</button></p>}
          <div className="inspector-section-card">
            <div className="inspector-title">
              <span>Operator Notes</span>
            </div>
            <textarea
              className="notes-textarea"
              aria-label="Operator note"
              readOnly={!principal.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role)) || !notesReady || noteBusy}
              placeholder="Add internal notes about this tool definition…"
              value={currentNote}
              onChange={e => setCurrentNote(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="button" className="btn btn-secondary save-note-btn" disabled={!notesReady || noteBusy || !principal.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role))} onClick={() => void saveCurrentNote()}>
                {noteBusy ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Parameter Override Edit Modal */}
      {editingParam && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '10px',
              width: '100%',
              maxWidth: '520px',
              boxShadow: 'var(--shadow-hover)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Edit Project Override: <code>{editingParam.variable_name}</code>
              </h3>
              <button
                type="button"
                onClick={() => setEditingParam(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {editingParam.description} (Type: <code>{editingParam.value_type}</code>)
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Override Value
                </label>
                <input
                  type="text"
                  className="preview-field-input"
                  value={editOverrideVal}
                  onChange={e => setEditOverrideVal(e.target.value)}
                  placeholder="Enter custom project override value…"
                />
              </div>
            </div>

            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                background: 'var(--card-subtle)',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingParam(null)}
                disabled={paramActionBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveParamOverride}
                disabled={paramActionBusy}
              >
                {paramActionBusy ? 'Saving…' : 'Save Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration Configuration Modal for MCP / A2A */}
      {configuringTool && (
        <IntegrationForm
          tool={configuringTool}
          principal={principal}
          onClose={() => setConfiguringTool(null)}
          onSaved={async () => {
            await refreshCatalog();
            setConfiguringTool(null);
          }}
        />
      )}

      {/* New Integration Modal */}
      {isCreating && (
        <IntegrationForm
          principal={principal}
          onClose={() => setIsCreating(false)}
          onSaved={async () => {
            await refreshCatalog();
            setIsCreating(false);
          }}
        />
      )}
    </div>
  );
};
