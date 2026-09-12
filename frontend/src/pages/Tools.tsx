import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Activity,
  Search,
  Sliders,
  Settings,
  Plus,
  X,
  Shield,
  Database,
  Lock,
  Unlock,
  Layers,
  Key,
  RefreshCw,
  Cpu,
  Check,
  ExternalLink,
  Clock,
  Bot,
  Workflow,
  User,
} from 'lucide-react';
import { ToolDefinition, ScopeLevel, ConnectorTemplateItem, Principal } from '../types/api';
import { fetchTools, fetchConnectorTemplates, fetchConnectorHealthCheck, testIntegration } from '../services/api';
import { IntegrationForm } from '../components/IntegrationForm';

interface ToolsProps {
  tools: ToolDefinition[];
  principal: Principal;
}

export const Tools: React.FC<ToolsProps> = ({ tools: initialTools, principal }) => {
  const [toolsList, setToolsList] = useState<ToolDefinition[]>(initialTools);

  const [templates, setTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [templateFetchError, setTemplateFetchError] = useState<string | null>(null);

  // Sync live probe status if initialTools changes
  React.useEffect(() => {
    setToolsList(initialTools);
  }, [initialTools]);

  React.useEffect(() => {
    let active = true;
    fetchConnectorTemplates()
      .then(items => {
        if (active) {
          setTemplates(items);
          setTemplateFetchError(null);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTemplateFetchError(
          error instanceof Error
            ? error.message
            : 'Unable to load connector templates from backend.'
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string; latency_ms?: number } | null>(null);
  const [search, setSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState<'all' | 'platform_default' | 'project_override' | 'project_only'>('all');
  const [integrationFilter, setIntegrationFilter] = useState<'all' | 'native' | 'mcp' | 'a2a'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Modal states
  const [configuringTool, setConfiguringTool] = useState<ToolDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const canEditIntegrations = principal.roles.includes('PLATFORM_ADMIN') || principal.roles.some(role => ['TENANT_ADMIN', 'PROJECT_OWNER', 'PROJECT_MANAGER'].includes(role));


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleToggleEnabled = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    showToast(`Connector state is managed by deployment policy.`);
  };

  const handleTestConnection = (tool: ToolDefinition, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTestingId(tool.id);
    setTestResult(null);

    if (tool.registration) {
      testIntegration(tool.registration.id)
        .then(result => setTestResult({
          id: tool.id,
          success: result.status === 'reachable',
          msg: result.message,
          latency_ms: result.latency_ms,
        }))
        .catch(error => setTestResult({
          id: tool.id,
          success: false,
          msg: error instanceof Error ? error.message : 'Unable to test saved connection',
        }))
        .finally(() => setTestingId(null));
      return;
    }

    const connectorId = (tool.system_name || tool.id || '').split('.')[0].toLowerCase();
    if (!connectorId) {
      setTestingId(null);
      setTestResult({
        id: tool.id,
        success: false,
        msg: 'Connector identifier is unavailable in current tool definition.',
      });
      return;
    }

    fetchConnectorHealthCheck(connectorId)
      .then((probe) => {
        setToolsList(current =>
          current.map(item => {
            if (item.id !== tool.id) return item;
            return {
              ...item,
              status: probe.overall === 'HEALTHY'
                ? 'connected'
                : probe.overall === 'DEGRADED' || probe.overall === 'RATE_LIMITED'
                  ? 'degraded'
                  : 'disabled',
              enabled: item.enabled,
              health: probe,
              latency_ms: probe.latency_ms,
            };
          })
        );

        if (probe.overall !== 'HEALTHY') {
          setTestResult({
            id: tool.id,
            success: false,
            msg: `Deployment connector probe reported ${probe.overall.toLowerCase().replace('_', ' ')}: ${probe.message}`,
            latency_ms: probe.latency_ms,
          });
          return;
        }

        setTestResult({
          id: tool.id,
          success: true,
          msg: `Deployment reported healthy status via ${probe.connectivity.toLowerCase()} path.`,
          latency_ms: probe.latency_ms,
        });
      })
      .catch(error => {
        setTestResult({
          id: tool.id,
          success: false,
          msg: error instanceof Error ? error.message : 'Unable to probe connector',
        });
      })
      .finally(() => {
        setTestingId(null);
      });
  };

  const refreshCatalog = async () => {
    setRefreshing(true);
    try {
      setToolsList(await fetchTools());
      showToast('Integration catalog refreshed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh integration catalog.';
      showToast(message);
      throw error;
    } finally {
      setRefreshing(false);
    }
  };

  const templateTool = (template: ConnectorTemplateItem): ToolDefinition => ({
    id: `template:${template.system_name}`,
    name: template.name,
    system_name: template.system_name,
    category: template.category,
    description: template.description,
    status: 'planned',
    enabled: false,
    type: template.integration_kind === 'a2a' ? 'a2a' : 'mcp',
    integration_kind: template.integration_kind,
    scope_level: template.default_scope,
    project_can_override: template.can_override,
    inherit_platform_defaults: template.default_scope !== 'project_only',
    rate_limit: template.default_rate_limit || 'Not active',
    last_ping: 'Not configured',
    endpoint: template.default_endpoint,
    protocol: template.protocol,
  });

  const registeredTemplateItems = templates.filter(template => template.integration_kind === 'mcp' || template.integration_kind === 'a2a');

  const openIntegrationForm = (tool?: ToolDefinition) => {
    if (!canEditIntegrations) return;
    setConfiguringTool(tool || null);
    setIsCreating(!tool);
  };

  // Filter logic
  const filtered = toolsList.filter(t => {
    const matchesSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      (t.system_name && t.system_name.toLowerCase().includes(search.toLowerCase())) ||
      (t.endpoint && t.endpoint.toLowerCase().includes(search.toLowerCase()));

    const matchesScope =
      selectedScope === 'all' || t.scope_level === selectedScope;

    const matchesIntegration =
      integrationFilter === 'all' ||
      (integrationFilter === 'native' && (!t.type || t.type === 'connector' || t.type === 'parser')) ||
      (integrationFilter === 'mcp' && t.type === 'mcp') ||
      (integrationFilter === 'a2a' && t.type === 'a2a');

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' && t.enabled) ||
      (statusFilter === 'disabled' && !t.enabled);

    const matchesCategory =
      categoryFilter === 'all' || t.category === categoryFilter;

    return matchesSearch && matchesScope && matchesIntegration && matchesStatus && matchesCategory;
  });

  const categories = Array.from(new Set(toolsList.map(t => t.category)));
  const totalEnabled = toolsList.filter(t => t.enabled).length;
  const platformCount = toolsList.filter(t => t.scope_level === 'platform_default').length;
  const projectOverrideCount = toolsList.filter(t => t.scope_level === 'project_override').length;
  const projectOnlyCount = toolsList.filter(t => t.scope_level === 'project_only').length;

  const nativeCount = toolsList.filter(t => !t.type || t.type === 'connector' || t.type === 'parser').length;
  const mcpCount = toolsList.filter(t => t.type === 'mcp').length;
  const a2aCount = toolsList.filter(t => t.type === 'a2a').length;
  const firstTestableTool = toolsList.find(tool => tool.registration ? canEditIntegrations : tool.probe_available);

  return (
    <div className="view-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'var(--card)',
          color: 'var(--text)',
          border: '1px solid var(--acc)',
          borderRadius: '8px',
          padding: '12px 18px',
          boxShadow: 'var(--shadow-hover)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          fontWeight: 600
        }}>
          <CheckCircle2 size={16} style={{ color: 'var(--acc)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Clean & Elevated Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Enterprise Connectors & <span>Integration Governance</span>
          </h1>
          <p className="hero-lede">
            Inspect server-reported connectors and template-backed integrations. Templates are reference metadata only; runtime health is policy-scoped and live-only.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{totalEnabled}</b> / {toolsList.length} Enabled Integrations
            </span>
            <span className="hero-stat-chip">
              <Layers size={12} /> <b>{platformCount}</b> Platform Defaults
            </span>
            <span className="hero-stat-chip">
              <Sliders size={12} /> <b>{projectOverrideCount}</b> Overrides • <b>{projectOnlyCount}</b> Project-Only
            </span>
            <span className="hero-stat-chip">
              <Cpu size={12} /> <b>{mcpCount}</b> MCP • <b>{a2aCount}</b> A2A Bridges
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openIntegrationForm()}
              disabled={!canEditIntegrations}
              title={canEditIntegrations ? 'Add an MCP or A2A integration' : 'Requires a platform or project administrator role'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--acc)',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '12px',
                cursor: canEditIntegrations ? 'pointer' : 'not-allowed',
                border: 'none'
              }}
            >
              <Plus size={14} /> Add MCP / A2A integration
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refreshCatalog()}
              disabled={refreshing}
              title="Reload saved integrations and deployment catalog"
            >
              <RefreshCw size={13} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Refreshing…' : 'Refresh catalog'}
            </button>
            <button
              type="button"
              className="btn btn-open"
              onClick={() => firstTestableTool && handleTestConnection(firstTestableTool)}
              disabled={!firstTestableTool}
              title="Ping the first configured connector"
            >
              <Activity size={13} /> Ping Active Fleet
            </button>
          </div>
        </div>
      </section>

      {templateFetchError && (
        <div className="notice-banner" role="alert" style={{ marginBottom: '10px' }}>
          {templateFetchError}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* FULL-DETAIL GOVERNANCE & PRECEDENCE BANNER (Never Squashed)  */}
      {/* ------------------------------------------------------------- */}
      <div className="notice-banner purple">
        <h3><Shield size={16} /> Integration configuration</h3>
        <p>Saved MCP and A2A connection settings persist in the backend at platform or project scope. Registration records configuration only; agent access and live execution remain deployment-gated.</p>
        <p className="metric-meta">Native connectors continue to use deployment-provided settings. Use Refresh catalog after saving to load the current persisted configuration.</p>
      </div>

      {registeredTemplateItems.length > 0 && (
        <section className="integration-template-panel" aria-labelledby="integration-template-title">
          <div className="integration-template-heading">
            <div>
              <h2 id="integration-template-title">Available MCP &amp; A2A templates</h2>
              <p>Start with deployment catalog metadata, then save the connection for this platform or project.</p>
            </div>
            <span className="brand-badge">CATALOG</span>
          </div>
          <div className="integration-template-grid">
            {registeredTemplateItems.map(template => (
              <article className="integration-template-card" key={template.type}>
                <div>
                  <div className="integration-template-title">
                    <strong>{template.name}</strong>
                    <span className={`integration-kind-badge ${template.integration_kind}`}>{template.integration_kind.toUpperCase()}</span>
                  </div>
                  <p>{template.description}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!canEditIntegrations}
                  title={canEditIntegrations ? 'Configure this template' : 'Requires a platform or project administrator role'}
                  onClick={() => openIntegrationForm(templateTool(template))}
                >
                  <Settings size={12} /> Configure
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Controls Bar: Integration Filter + Scope Tabs + Search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        {/* Top Filter Row: Integration Kind + Scope Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          {/* Integration Kind Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            {[
              { id: 'all', label: `All Integrations (${toolsList.length})`, icon: Workflow },
              { id: 'native', label: `Native Connectors (${nativeCount})`, icon: Database },
              { id: 'mcp', label: `MCP Tool Servers (${mcpCount})`, icon: Cpu },
              { id: 'a2a', label: `A2A Agent Protocols (${a2aCount})`, icon: Bot }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setIntegrationFilter(tab.id as any)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: integrationFilter === tab.id ? 700 : 500,
                    border: integrationFilter === tab.id ? '1px solid var(--acc)' : '1px solid transparent',
                    background: integrationFilter === tab.id ? 'var(--card)' : 'transparent',
                    color: integrationFilter === tab.id ? 'var(--acc)' : 'var(--muted)',
                    cursor: 'pointer',
                    transition: 'all .15s ease'
                  }}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Scope Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            {[
              { id: 'all', label: `All Scopes` },
              { id: 'platform_default', label: `Platform Defaults (${platformCount})` },
              { id: 'project_override', label: `Project Overrides (${projectOverrideCount})` },
              { id: 'project_only', label: `Direct Project-Only (${projectOnlyCount})` }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedScope(tab.id as any)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: selectedScope === tab.id ? 700 : 500,
                  border: selectedScope === tab.id ? '1px solid var(--acc)' : '1px solid transparent',
                  background: selectedScope === tab.id ? 'var(--card)' : 'transparent',
                  color: selectedScope === tab.id ? 'var(--acc)' : 'var(--muted)',
                  cursor: 'pointer'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar: Search + Status + Category Filters */}
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input
              type="search"
              placeholder="Search connectors, MCP endpoints, A2A agents, categories, or secret refs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Status Quick Filter */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Status:</span>
            {(['all', 'enabled', 'disabled'] as const).map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: statusFilter === st ? 700 : 500,
                  textTransform: 'capitalize',
                  border: statusFilter === st ? '1px solid var(--acc)' : '1px solid var(--line)',
                  background: statusFilter === st ? 'var(--acc-subtle)' : 'var(--card)',
                  color: statusFilter === st ? 'var(--acc)' : 'var(--muted)',
                  cursor: 'pointer'
                }}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: categoryFilter === 'all' ? 700 : 500,
                border: categoryFilter === 'all' ? '1px solid var(--acc)' : '1px solid var(--line)',
                background: categoryFilter === 'all' ? 'var(--acc-subtle)' : 'var(--card)',
                color: categoryFilter === 'all' ? 'var(--acc)' : 'var(--muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              All Types
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: categoryFilter === cat ? 700 : 500,
                  border: categoryFilter === cat ? '1px solid var(--acc)' : '1px solid var(--line)',
                  background: categoryFilter === cat ? 'var(--acc-subtle)' : 'var(--card)',
                  color: categoryFilter === cat ? 'var(--acc)' : 'var(--muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="count-badge">
            <b>{filtered.length}</b> tools
          </div>
        </div>
      </div>

      {/* Connectors & Integrations Grid */}
      <div className="card-list">
        {filtered.length === 0 && (
          <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--dim)' }}>
            No connectors are currently reported by the deployment.
          </div>
        )}
        {filtered.map((tool, index) => {
          const numStr = String(index + 1).padStart(3, '0');
          const canTest = tool.registration ? canEditIntegrations : Boolean(tool.probe_available);

          return (
            <article
              key={tool.id}
              className="card"
              style={{
                opacity: tool.enabled ? 1 : 0.65,
                transition: 'all .2s ease',
                border: tool.enabled ? '1px solid var(--line)' : '1px dashed var(--line)'
              }}
            >
              <div className="card-top">
                <div className="num">{numStr}</div>

                <div className="card-main">
                  {/* Top Bar: Title, Badges, Scope & Enabled Switch */}
                  <div className="card-title-row" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <h2 className="card-title" style={{ margin: 0 }}>{tool.name}</h2>
                        
                        {/* Integration Kind Badge */}
                        {tool.type === 'mcp' && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '10px',
                            background: 'rgba(234, 179, 8, 0.15)',
                            color: '#ca8a04',
                            border: '1px solid rgba(234, 179, 8, 0.35)'
                          }}>
                            <Cpu size={10} /> MCP SERVER
                          </span>
                        )}
                        {tool.type === 'a2a' && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '10px',
                            background: 'rgba(168, 85, 247, 0.15)',
                            color: '#9333ea',
                            border: '1px solid rgba(168, 85, 247, 0.35)'
                          }}>
                            <Bot size={10} /> A2A BRIDGE
                          </span>
                        )}
                        <span className="brand-badge">{tool.category}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--muted)' }}>
                        <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>
                          {tool.system_name || tool.id}
                        </code>
                        <span>•</span>
                        <span>{tool.protocol || 'HTTPS'}</span>
                        {tool.mcp_config?.transport && (
                          <>
                            <span>•</span>
                            <span style={{ color: 'var(--acc)' }}>transport: {tool.mcp_config.transport}</span>
                          </>
                        )}
                        {tool.a2a_config?.delegation_protocol && (
                          <>
                            <span>•</span>
                            <span style={{ color: '#9333ea' }}>delegation: {tool.a2a_config.delegation_protocol}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Scope & Enabled Pill Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Scope Badge */}
                      {tool.scope_level === 'platform_default' && (
                        <span
                          title="Platform-wide baseline default"
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: 'rgba(99,102,241,0.12)',
                            color: 'var(--acc)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            textTransform: 'uppercase'
                          }}
                        >
                          Platform Default
                        </span>
                      )}
                      {tool.scope_level === 'project_override' && (
                        <span
                          title="Custom override active at project level"
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: 'rgba(234,179,8,0.12)',
                            color: '#ca8a04',
                            border: '1px solid rgba(234,179,8,0.3)',
                            textTransform: 'uppercase'
                          }}
                        >
                          Project Override
                        </span>
                      )}
                      {tool.scope_level === 'project_only' && (
                        <span
                          title="Direct project level configuration with no platform default"
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: 'rgba(168,85,247,0.12)',
                            color: '#9333ea',
                            border: '1px solid rgba(168,85,247,0.3)',
                            textTransform: 'uppercase'
                          }}
                        >
                          Project-Only
                        </span>
                      )}

                      {/* Enable/Disable Toggle Switch */}
                      <button
                        type="button"
                        onClick={(e) => handleToggleEnabled(tool.id, e)}
                        disabled
                        title="Connector state is managed by the deployment"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '3px 8px',
                          borderRadius: '16px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: tool.enabled ? '1px solid rgba(16,185,129,0.35)' : '1px solid var(--line)',
                          background: tool.enabled ? 'rgba(16,185,129,0.12)' : 'var(--bg)',
                          color: tool.enabled ? '#10b981' : 'var(--muted)',
                          transition: 'all .15s ease'
                        }}
                      >
                        <span style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: tool.enabled ? '#10b981' : 'var(--muted)'
                        }} />
                        {tool.status.toUpperCase()}
                      </button>
                    </div>
                  </div>

                  <p className="card-desc" style={{ marginTop: '8px', marginBottom: '10px' }}>
                    {tool.description}
                  </p>

                  {/* Pills */}
                  <div className="card-meta-pills" style={{ marginBottom: '10px' }}>
                    {tool.project_can_override ? (
                      <span className="meta-pill" title="Project admins can customize or override this connector">
                        <Unlock size={11} style={{ color: '#10b981' }} /> Overridable by Project
                      </span>
                    ) : (
                      <span className="meta-pill" title="Locked platform default; project cannot override">
                        <Lock size={11} style={{ color: '#ef4444' }} /> Locked by Platform
                      </span>
                    )}
                    <span className="meta-pill highlight">{tool.rate_limit}</span>
                    {tool.service_user && (
                      <span className="meta-pill" title={`Service account user: ${tool.service_user}`}>
                        <User size={11} style={{ color: 'var(--acc)' }} /> {tool.service_user}
                      </span>
                    )}
                    {tool.secret_reference && (
                      <span className="meta-pill">
                        <Key size={11} /> {tool.secret_reference}
                      </span>
                    )}
                    {tool.endpoint && (
                      <span className="meta-pill" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                        {tool.endpoint}
                      </span>
                    )}
                    {tool.ui_base_url && (
                      <a
                        href={tool.ui_base_url}
                        target="_blank"
                        rel="noreferrer"
                        className="meta-pill"
                        title={`Open Web Portal: ${tool.ui_base_url}`}
                        style={{ textDecoration: 'none', color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <ExternalLink size={10} /> Web Portal
                      </a>
                    )}
                    {(tool.timeout_seconds !== undefined || tool.retry_attempts !== undefined) && (
                      <span className="meta-pill" title="Connection timeouts & retry boundaries">
                        <Clock size={11} /> {tool.timeout_seconds ?? 30}s • {tool.retry_attempts ?? 0} retries
                      </span>
                    )}
                  </div>

                  {/* MCP Exposed Tools Badges */}
                  {tool.mcp_config?.tools_exposed && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '11px',
                      background: 'rgba(234, 179, 8, 0.06)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(234, 179, 8, 0.2)',
                      marginBottom: '8px'
                    }}>
                      <span style={{ fontWeight: 600, color: '#ca8a04' }}>MCP Tools:</span>
                      {tool.mcp_config.tools_exposed.map(tName => (
                        <code key={tName} style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: '3px', fontSize: '10px' }}>
                          {tName}
                        </code>
                      ))}
                    </div>
                  )}

                  {/* A2A Agent Delegation Details */}
                  {tool.a2a_config && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                      fontSize: '11px',
                      background: 'rgba(168, 85, 247, 0.06)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(168, 85, 247, 0.2)',
                      marginBottom: '8px'
                    }}>
                      <span><b>Target Agent:</b> <code>{tool.a2a_config.target_agent_id}</code></span>
                      <span><b>Capability:</b> <code>{tool.a2a_config.target_capability}</code></span>
                      {tool.a2a_config.dual_custody_approved && (
                        <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                          <Check size={12} /> Dual-Custody Approved
                        </span>
                      )}
                    </div>
                  )}

                  {/* Dynamic Custom Config Badges */}
                  {tool.custom_config && Object.keys(tool.custom_config).length > 0 && (
                    <div style={{
                      display: 'flex',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '11px',
                      background: 'var(--bg)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      marginBottom: '8px'
                    }}>
                      {(tool.custom_config.project_key || tool.project_key) && (
                        <span><b>Project:</b> <code>{tool.custom_config.project_key || tool.project_key}</code></span>
                      )}
                      {tool.custom_config.polling_cron && (
                        <span><b>Poll:</b> <code>{tool.custom_config.polling_cron}</code></span>
                      )}
                      {tool.custom_config.reporting_cron && (
                        <span><b>Report:</b> <code>{tool.custom_config.reporting_cron}</code></span>
                      )}
                      {tool.custom_config.process_attachments && (
                        <span style={{ color: '#10b981' }}><b>Attachments:</b> Ingested</span>
                      )}
                      {tool.custom_config.allowed_indexes && (
                        <span><b>Indexes:</b> {tool.custom_config.allowed_indexes.join(', ')}</span>
                      )}
                      {tool.custom_config.monitored_namespaces && (
                        <span><b>Namespaces:</b> {tool.custom_config.monitored_namespaces.length} active</span>
                      )}
                      {tool.custom_config.monitored_topics && (
                        <span><b>Topics:</b> {tool.custom_config.monitored_topics.join(', ')}</span>
                      )}
                      {tool.custom_config.bootstrap_servers && (
                        <span><b>Brokers:</b> <code>{tool.custom_config.bootstrap_servers}</code></span>
                      )}
                      {tool.custom_config.spaces && (
                        <span><b>Spaces:</b> {tool.custom_config.spaces.join(', ')}</span>
                      )}
                      {tool.custom_config.projects && (
                        <span><b>Repos:</b> {tool.custom_config.projects.join(', ')}</span>
                      )}
                      {tool.custom_config.schema && (
                        <span><b>Schema:</b> <code>{tool.custom_config.schema}</code></span>
                      )}
                      {tool.custom_config.sid && (
                        <span><b>SID:</b> <code>{tool.custom_config.sid}</code></span>
                      )}
                      {tool.custom_config.cluster_name && (
                        <span><b>Cluster:</b> {tool.custom_config.cluster_name}</span>
                      )}
                      {tool.custom_config.domain_id && (
                        <span><b>Domain:</b> <code>{tool.custom_config.domain_id}</code></span>
                      )}
                      {tool.custom_config.allowed_hosts && (
                        <span><b>Hosts:</b> {tool.custom_config.allowed_hosts.length} configured</span>
                      )}
                    </div>
                  )}

                  {/* Test Ping Result */}
                  {testResult?.id === tool.id && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        background: testResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(244, 63, 94, 0.12)',
                        color: testResult.success ? '#10b981' : 'var(--acc-rose)',
                        border: `1px solid ${testResult.success ? 'rgba(16,185,129,0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        <span>{testResult.msg}</span>
                      </div>
                      {testResult.latency_ms && (
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                          {testResult.latency_ms}ms
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => tool.registration ? openIntegrationForm(tool) : setConfiguringTool(tool)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      background: 'var(--acc)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <Settings size={12} /> {tool.registration ? 'Configure' : 'View catalog'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-open"
                    onClick={(e) => handleTestConnection(tool, e)}
                    disabled={!canTest || testingId === tool.id}
                    title={canTest ? 'Test the configured connection' : 'No runtime provider is available, or your role cannot test this integration'}
                  >
                    <Activity size={12} />
                    {testingId === tool.id ? 'Testing…' : tool.registration ? 'Test connection' : canTest ? 'Test Ping' : 'Test unavailable'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {configuringTool && (
        configuringTool.registration || configuringTool.type === 'mcp' || configuringTool.type === 'a2a'
          ? <IntegrationForm
              tool={configuringTool}
              principal={principal}
              onClose={() => setConfiguringTool(null)}
              onSaved={async () => { await refreshCatalog(); setIsCreating(false); }}
            />
          : <ConnectorConfigModal
              tool={configuringTool}
              onClose={() => setConfiguringTool(null)}
              onTest={handleTestConnection}
              testingId={testingId}
            />
      )}

      {isCreating && (
        <IntegrationForm
          principal={principal}
          onClose={() => setIsCreating(false)}
          onSaved={async () => { await refreshCatalog(); setIsCreating(false); }}
        />
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// ConnectorConfigModal Component
// ----------------------------------------------------------------------
interface ModalProps {
  tool: ToolDefinition;
  onClose: () => void;
  onTest: (tool: ToolDefinition) => void;
  testingId: string | null;
}

const ConnectorConfigModal: React.FC<ModalProps> = ({
  tool,
  onClose,
  onTest,
  testingId
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'endpoints' | 'auth' | 'params' | 'mcp_a2a' | 'custom'>('general');
  const [form, setForm] = useState<ToolDefinition>({ ...tool });
  const [customConfigStr, setCustomConfigStr] = useState<string>(
    tool.custom_config ? JSON.stringify(tool.custom_config, null, 2) : '{}'
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleCustomJsonChange = (val: string) => {
    setCustomConfigStr(val);
    try {
      const parsed = JSON.parse(val);
      setForm(prev => ({ ...prev, custom_config: parsed }));
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const updateCustomParam = (key: string, value: any) => {
    setForm(prev => {
      const nextCustom = { ...(prev.custom_config || {}), [key]: value };
      setCustomConfigStr(JSON.stringify(nextCustom, null, 2));
      return { ...prev, custom_config: nextCustom };
    });
  };

  const updateNestedCustomParam = (section: string, key: string, value: any) => {
    setForm(prev => {
      const sectionObj = (prev.custom_config && prev.custom_config[section]) || {};
      const nextCustom = {
        ...(prev.custom_config || {}),
        [section]: {
          ...sectionObj,
          [key]: value
        }
      };
      setCustomConfigStr(JSON.stringify(nextCustom, null, 2));
      return { ...prev, custom_config: nextCustom };
    });
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '820px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow-hover)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--card)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} style={{ color: 'var(--acc)' }} />
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                Configure {form.type === 'mcp' ? 'MCP Server' : form.type === 'a2a' ? 'A2A Agent Bridge' : 'Connector'}: {form.name}
              </h2>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              System: <code>{form.system_name || form.id}</code> • Type: {form.type?.toUpperCase()} • Category: {form.category}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--acc-amber)' }}>Deployment-managed catalog · read only</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Tabs */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '8px 20px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          overflowX: 'auto'
        }}>
          {[
            { id: 'general', label: 'General & Scope' },
            { id: 'endpoints', label: 'Endpoints & Limits' },
            { id: 'auth', label: 'Auth & Secrets' },
            { id: 'params', label: 'Connector Parameters' },
            ...(form.type === 'mcp' || form.type === 'a2a' ? [{ id: 'mcp_a2a', label: form.type === 'mcp' ? 'MCP Protocol Settings' : 'A2A Agent Delegation' }] : []),
            { id: 'custom', label: 'Raw JSON Config' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: activeTab === tab.id ? 700 : 500,
                border: activeTab === tab.id ? '1px solid var(--acc)' : '1px solid transparent',
                background: activeTab === tab.id ? 'var(--card)' : 'transparent',
                color: activeTab === tab.id ? 'var(--acc)' : 'var(--muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <fieldset disabled style={{ padding: '20px', overflowY: 'auto', flex: 1, border: 0, margin: 0 }}>
          <p className="metric-meta">Only values supplied by the server describe this connection. Unspecified fields display template defaults and are not active deployment settings.</p>
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Enabled Switch */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: form.enabled ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                    Integration State
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    When disabled, all orchestrator steps and specialist agents skip calling this integration.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, enabled: !p.enabled, status: !p.enabled ? 'connected' : 'disabled' }))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    border: form.enabled ? '1px solid #10b981' : '1px solid var(--line)',
                    background: form.enabled ? '#10b981' : 'var(--bg)',
                    color: form.enabled ? '#fff' : 'var(--muted)'
                  }}
                >
                  {form.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              {/* Scoping Precedence Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  Configuration Scope Level
                </label>
                <select
                  value={form.scope_level}
                  onChange={e => setForm(p => ({ ...p, scope_level: e.target.value as ScopeLevel }))}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '12px'
                  }}
                >
                  <option value="platform_default">Platform Default (Baseline for all projects)</option>
                  <option value="project_override">Project Override (Overrides inherited platform default)</option>
                  <option value="project_only">Direct Project-Only (Configured in project level, no platform default)</option>
                </select>
              </div>

              {/* Project Can Override Rule Toggle */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: 'var(--bg)'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {form.project_can_override ? <Unlock size={14} style={{ color: '#10b981' }} /> : <Lock size={14} style={{ color: '#ef4444' }} />}
                    Allow Project-Level Overrides (<code>project_can_override</code>)
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                    If disabled, platform administrators lock this connector. Project owners cannot alter endpoints or secrets.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={form.project_can_override}
                  onChange={e => setForm(p => ({ ...p, project_can_override: e.target.checked }))}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>

              {/* Connector Display Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    System Identifier (system_name)
                  </label>
                  <input
                    type="text"
                    value={form.system_name || ''}
                    onChange={e => setForm(p => ({ ...p, system_name: e.target.value }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>
              </div>

              {/* Description */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  Description & Scope Notes
                </label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '12px',
                    resize: 'vertical'
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === 'endpoints' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  Primary Endpoint / API URL / Command
                </label>
                <input
                  type="text"
                  value={form.endpoint || ''}
                  onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))}
                  placeholder="https://api.internal:8089 or mcp://host:9090"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  UI Presentation URL (Portal / Console Link)
                </label>
                <input
                  type="text"
                  value={form.ui_base_url || ''}
                  onChange={e => setForm(p => ({ ...p, ui_base_url: e.target.value }))}
                  placeholder="https://splunk-ui.internal:8000 or https://company.atlassian.net"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Protocol
                  </label>
                  <select
                    value={form.protocol || 'HTTPS'}
                    onChange={e => setForm(p => ({ ...p, protocol: e.target.value }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  >
                    <option value="HTTPS">HTTPS (REST)</option>
                    <option value="MCP (SSE)">MCP (SSE)</option>
                    <option value="MCP (Streamable HTTP)">MCP (Streamable HTTP)</option>
                    <option value="MCP (Stdio)">MCP (Stdio)</option>
                    <option value="ADK AgentTool">ADK AgentTool</option>
                    <option value="A2A REST Protocol">A2A REST Protocol</option>
                    <option value="Oracle Net (TNS/OCI)">Oracle Net (TNS/OCI)</option>
                    <option value="SSH">SSH / CLI</option>
                    <option value="Kafka Native (TCP)">Kafka Native (TCP)</option>
                    <option value="Tuxedo /WS">Tuxedo /WS</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Timeout (Seconds)
                  </label>
                  <input
                    type="number"
                    value={form.timeout_seconds || 30}
                    onChange={e => setForm(p => ({ ...p, timeout_seconds: parseInt(e.target.value) || 30 }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Retry Attempts
                  </label>
                  <input
                    type="number"
                    value={form.retry_attempts || 3}
                    onChange={e => setForm(p => ({ ...p, retry_attempts: parseInt(e.target.value) || 0 }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Retry Backoff (Seconds)
                  </label>
                  <input
                    type="number"
                    value={form.retry_backoff_seconds ?? 5}
                    onChange={e => setForm(p => ({ ...p, retry_backoff_seconds: parseInt(e.target.value) || 0 }))}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Max Response Bytes
                  </label>
                  <input
                    type="number"
                    value={form.max_response_bytes ?? 10485760}
                    onChange={e => setForm(p => ({ ...p, max_response_bytes: parseInt(e.target.value) || 0 }))}
                    placeholder="10485760 (10 MB)"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Rate Limit Policy
                  </label>
                  <input
                    type="text"
                    value={form.rate_limit || ''}
                    onChange={e => setForm(p => ({ ...p, rate_limit: e.target.value }))}
                    placeholder="e.g. 300 req / min"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'auth' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                background: 'rgba(99,102,241,0.06)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(99,102,241,0.2)',
                fontSize: '12px',
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Shield size={16} style={{ color: 'var(--acc)' }} />
                <span><b>Zero Plaintext Guarantee:</b> Plaintext credentials are strictly prohibited. Store secrets in Secret Manager or environment variables and bind via secret reference name.</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Authentication Method
                  </label>
                  <input
                    type="text"
                    value={form.auth_method || ''}
                    onChange={e => setForm(p => ({ ...p, auth_method: e.target.value }))}
                    placeholder="Bearer Token, MCP Bearer Token, Mutual TLS, Kubeconfig"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Secret Reference Name
                  </label>
                  <input
                    type="text"
                    value={form.secret_reference || ''}
                    onChange={e => setForm(p => ({ ...p, secret_reference: e.target.value }))}
                    placeholder="e.g. JIRA_API_TOKEN, SPLUNK_HEC_TOKEN, SAMSON_DB_PASSWORD"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Service Account / User Identity (service_user)
                  </label>
                  <input
                    type="text"
                    value={form.service_user || ''}
                    onChange={e => setForm(p => ({ ...p, service_user: e.target.value }))}
                    placeholder="e.g. svc-rca-jira@corp.internal, splunk-api-svc"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                    Token Header Format
                  </label>
                  <input
                    type="text"
                    value={form.token_header_format || ''}
                    onChange={e => setForm(p => ({ ...p, token_header_format: e.target.value }))}
                    placeholder="e.g. Bearer {token} or Splunk {token}"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: 'var(--bg)'
              }}>
                <input
                  type="checkbox"
                  id="modal-verify-ssl"
                  checked={form.verify_ssl ?? true}
                  onChange={e => setForm(p => ({ ...p, verify_ssl: e.target.checked }))}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="modal-verify-ssl" style={{ fontSize: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Verify TLS/SSL Certificates (verify_ssl)</span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Enforce strict certificate authority verification. Disable only for private sandbox self-signed certificates.</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'params' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                background: 'rgba(59,130,246,0.06)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(59,130,246,0.2)',
                fontSize: '12px',
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Sliders size={16} style={{ color: 'var(--acc)' }} />
                <span><b>Live Connector Parameters:</b> Structured parameters configured here synchronize directly with the connector runtime engine and raw JSON configuration.</span>
              </div>

              {/* Jira Incident Triage Specific Params */}
              {(form.system_name === 'jira' || form.category === 'Ticketing') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Jira Cloud / Server Incident Settings
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Primary Project Key</label>
                      <input
                        type="text"
                        value={form.custom_config?.project_key || form.project_key || ''}
                        onChange={e => {
                          updateCustomParam('project_key', e.target.value);
                          setForm(p => ({ ...p, project_key: e.target.value }));
                        }}
                        placeholder="e.g. SAG, PROD_CORE"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Timezone</label>
                      <input
                        type="text"
                        value={form.custom_config?.timezone || 'America/Chicago'}
                        onChange={e => updateCustomParam('timezone', e.target.value)}
                        placeholder="America/Chicago or UTC"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Polling Cron Schedule</label>
                      <input
                        type="text"
                        value={form.custom_config?.polling_cron || '*/15 * * * *'}
                        onChange={e => updateCustomParam('polling_cron', e.target.value)}
                        placeholder="*/15 * * * *"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Reporting Cron Schedule</label>
                      <input
                        type="text"
                        value={form.custom_config?.reporting_cron || '0 17 * * 5'}
                        onChange={e => updateCustomParam('reporting_cron', e.target.value)}
                        placeholder="0 17 * * 5 (Friday 5PM)"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <input
                      type="checkbox"
                      id="jira-process-attachments"
                      checked={form.custom_config?.process_attachments ?? true}
                      onChange={e => updateCustomParam('process_attachments', e.target.checked)}
                    />
                    <label htmlFor="jira-process-attachments" style={{ fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      Automatically extract and summarize ticket file attachments
                    </label>
                  </div>

                  {/* Jira Custom Field ID Mapping */}
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', marginTop: '8px' }}>
                    Jira Custom Field ID Mappings:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { key: 'severity', label: 'Severity' },
                      { key: 'environment', label: 'Environment' },
                      { key: 'fix_team', label: 'Fix Team' },
                      { key: 'fix_application', label: 'Fix Application' },
                      { key: 'rca', label: 'RCA Field' },
                      { key: 'reporting_team', label: 'Reporting Team' }
                    ].map(f => (
                      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{f.label}</label>
                        <input
                          type="text"
                          value={form.custom_config?.customfields?.[f.key] || ''}
                          onChange={e => updateNestedCustomParam('customfields', f.key, e.target.value)}
                          placeholder="customfield_..."
                          style={{ padding: '5px 7px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Splunk Specific Params */}
              {(form.system_name === 'splunk' || form.name.toLowerCase().includes('splunk')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Splunk Search & Log Mining Settings
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                      Allowed Indexes (Comma-separated)
                    </label>
                    <input
                      type="text"
                      value={Array.isArray(form.custom_config?.allowed_indexes) ? form.custom_config.allowed_indexes.join(', ') : form.custom_config?.allowed_indexes || ''}
                      onChange={e => updateCustomParam('allowed_indexes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="adms, billing, system, metrics, security_audit, gateway_logs"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Max Event Results</label>
                      <input
                        type="number"
                        value={form.custom_config?.max_results ?? 100}
                        onChange={e => updateCustomParam('max_results', parseInt(e.target.value) || 100)}
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Max Query Window (Seconds)</label>
                      <input
                        type="number"
                        value={form.custom_config?.max_window_seconds ?? 86400}
                        onChange={e => updateCustomParam('max_window_seconds', parseInt(e.target.value) || 86400)}
                        placeholder="86400 (24h)"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.custom_config?.wild_card_allowed ?? true}
                        onChange={e => updateCustomParam('wild_card_allowed', e.target.checked)}
                      />
                      <span>Allow Wildcard Searches</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.custom_config?.data_sources?.metrics ?? true}
                        onChange={e => updateNestedCustomParam('data_sources', 'metrics', e.target.checked)}
                      />
                      <span>Metrics</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.custom_config?.data_sources?.logs ?? true}
                        onChange={e => updateNestedCustomParam('data_sources', 'logs', e.target.checked)}
                      />
                      <span>Logs</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.custom_config?.data_sources?.events ?? true}
                        onChange={e => updateNestedCustomParam('data_sources', 'events', e.target.checked)}
                      />
                      <span>Events</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Database / Samson DB Specific Params */}
              {(form.category === 'Databases' || form.system_name?.includes('oracle') || form.system_name?.includes('db')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Database Connection & Sandbox Isolation Settings
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Database Host / Cluster</label>
                      <input
                        type="text"
                        value={form.custom_config?.host || form.custom_config?.database?.host || ''}
                        onChange={e => updateCustomParam('host', e.target.value)}
                        placeholder="db-samson-prd01.corp.internal"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Port</label>
                      <input
                        type="number"
                        value={form.custom_config?.port || form.custom_config?.database?.port || 1521}
                        onChange={e => updateCustomParam('port', parseInt(e.target.value) || 1521)}
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Service Name / SID</label>
                      <input
                        type="text"
                        value={form.custom_config?.sid || form.custom_config?.service_name || ''}
                        onChange={e => updateCustomParam('sid', e.target.value)}
                        placeholder="SAMSONPRD.CORP"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Default Schema</label>
                      <input
                        type="text"
                        value={form.custom_config?.schema || ''}
                        onChange={e => updateCustomParam('schema', e.target.value)}
                        placeholder="PROD_CORE"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Statement Timeout (Seconds)</label>
                      <input
                        type="number"
                        value={form.custom_config?.statement_timeout_seconds ?? 15}
                        onChange={e => updateCustomParam('statement_timeout_seconds', parseInt(e.target.value) || 15)}
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Max Query Result Rows</label>
                      <input
                        type="number"
                        value={form.custom_config?.max_row_limit ?? 500}
                        onChange={e => updateCustomParam('max_row_limit', parseInt(e.target.value) || 500)}
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Kafka Message Streaming Specific Params */}
              {(form.category === 'Message Streaming' || form.system_name?.includes('kafka')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Kafka Event Stream & Consumer Settings
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Cluster ID</label>
                      <input
                        type="text"
                        value={form.custom_config?.cluster_id || ''}
                        onChange={e => updateCustomParam('cluster_id', e.target.value)}
                        placeholder="lks-prod-corp"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Consumer Group</label>
                      <input
                        type="text"
                        value={form.custom_config?.consumer_group || ''}
                        onChange={e => updateCustomParam('consumer_group', e.target.value)}
                        placeholder="rca-analyzer-inspector"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Allowed Topics (Comma-separated)</label>
                    <input
                      type="text"
                      value={Array.isArray(form.custom_config?.allowed_topics) ? form.custom_config.allowed_topics.join(', ') : form.custom_config?.allowed_topics || ''}
                      onChange={e => updateCustomParam('allowed_topics', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="orders.events.v1, payments.deadletter.v1, notifications.stream"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              )}

              {/* Kubernetes Specific Params */}
              {(form.category === 'Container Orchestration' || form.system_name?.includes('k8s') || form.system_name?.includes('kubernetes')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Kubernetes Cluster Inspection Settings
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Cluster Context</label>
                      <input
                        type="text"
                        value={form.custom_config?.cluster_context || ''}
                        onChange={e => updateCustomParam('cluster_context', e.target.value)}
                        placeholder="gke-prod-cluster-us-central1"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Pod Log Tail Lines</label>
                      <input
                        type="number"
                        value={form.custom_config?.pod_log_tail_lines || 200}
                        onChange={e => updateCustomParam('pod_log_tail_lines', parseInt(e.target.value) || 200)}
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Allowed Namespaces (Comma-separated)</label>
                    <input
                      type="text"
                      value={Array.isArray(form.custom_config?.allowed_namespaces) ? form.custom_config.allowed_namespaces.join(', ') : form.custom_config?.allowed_namespaces || ''}
                      onChange={e => updateCustomParam('allowed_namespaces', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="production, istio-system, ingress-nginx, payment-services"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              )}

              {/* Confluence Knowledge Specific Params */}
              {(form.category === 'Knowledge & RAG' || form.system_name?.includes('confluence')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Confluence Knowledge Base Settings
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Allowed Spaces (Comma-separated)</label>
                    <input
                      type="text"
                      value={Array.isArray(form.custom_config?.allowed_spaces) ? form.custom_config.allowed_spaces.join(', ') : form.custom_config?.allowed_spaces || ''}
                      onChange={e => updateCustomParam('allowed_spaces', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="ENG, SRE, POSTMORTEM, ARCH"
                      style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              )}

              {/* Unix Host / Tuxedo Specific Params */}
              {(form.category === 'Host & Runtime Health' || form.system_name?.includes('unix') || form.system_name?.includes('tuxedo')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                    Host & Runtime Execution Settings
                  </div>

                  {form.custom_config?.tuxdir !== undefined ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>TUXDIR</label>
                        <input
                          type="text"
                          value={form.custom_config?.tuxdir || ''}
                          onChange={e => updateCustomParam('tuxdir', e.target.value)}
                          placeholder="/opt/oracle/tuxedo12c"
                          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Domain ID</label>
                        <input
                          type="text"
                          value={form.custom_config?.domain_id || ''}
                          onChange={e => updateCustomParam('domain_id', e.target.value)}
                          placeholder="TUX_CORE_PRD"
                          style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Target Hosts (Comma-separated)</label>
                      <input
                        type="text"
                        value={Array.isArray(form.custom_config?.target_hosts) ? form.custom_config.target_hosts.join(', ') : form.custom_config?.target_hosts || ''}
                        onChange={e => updateCustomParam('target_hosts', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        placeholder="app-srv-01.corp.internal, app-srv-02.corp.internal"
                        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'mcp_a2a' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {form.type === 'mcp' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                      MCP Transport
                    </label>
                    <select
                      value={form.mcp_config?.transport || 'sse'}
                      onChange={e => setForm(p => ({
                        ...p,
                        mcp_config: { ...p.mcp_config, transport: e.target.value as any }
                      }))}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        color: 'var(--text)',
                        fontSize: '12px'
                      }}
                    >
                      <option value="sse">SSE (Server-Sent Events over HTTP)</option>
                      <option value="streamable_http">Streamable HTTP</option>
                      <option value="stdio">Stdio (Local Command / Process)</option>
                      <option value="websocket">WebSocket</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                      Exposed MCP Tools (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={form.mcp_config?.tools_exposed?.join(', ') || ''}
                      onChange={e => setForm(p => ({
                        ...p,
                        mcp_config: {
                          ...p.mcp_config,
                          transport: p.mcp_config?.transport || 'sse',
                          tools_exposed: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        }
                      }))}
                      placeholder="e.g. scan_messages, check_consumer_lag, measure_throughput"
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        color: 'var(--text)',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                </>
              )}

              {form.type === 'a2a' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                        Target Specialist Agent ID
                      </label>
                      <input
                        type="text"
                        value={form.a2a_config?.target_agent_id || ''}
                        onChange={e => setForm(p => ({
                          ...p,
                          a2a_config: { ...p.a2a_config!, target_agent_id: e.target.value }
                        }))}
                        placeholder="agent-jira-triage-specialist"
                        style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          background: 'var(--bg)',
                          color: 'var(--text)',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                        Target Capability
                      </label>
                      <input
                        type="text"
                        value={form.a2a_config?.target_capability || ''}
                        onChange={e => setForm(p => ({
                          ...p,
                          a2a_config: { ...p.a2a_config!, target_capability: e.target.value }
                        }))}
                        placeholder="jira_triage_classification"
                        style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          background: 'var(--bg)',
                          color: 'var(--text)',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                      Expected Content Hash (SHA-256 Dual-Custody)
                    </label>
                    <input
                      type="text"
                      value={form.a2a_config?.content_hash || ''}
                      onChange={e => setForm(p => ({
                        ...p,
                        a2a_config: { ...p.a2a_config!, content_hash: e.target.value }
                      }))}
                      placeholder="sha256:7f92ac3910eb..."
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        color: 'var(--text)',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.a2a_config?.dual_custody_approved || false}
                      onChange={e => setForm(p => ({
                        ...p,
                        a2a_config: { ...p.a2a_config!, dual_custody_approved: e.target.checked }
                      }))}
                    />
                    <span style={{ fontWeight: 600 }}>Dual-Custody Approved by Administrator</span>
                  </label>
                </>
              )}
            </div>
          )}

          {activeTab === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  Connector-Specific Parameters (JSON Configuration)
                </label>
                {jsonError && (
                  <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
                    Invalid JSON: {jsonError}
                  </span>
                )}
              </div>

              <textarea
                rows={14}
                value={customConfigStr}
                onChange={e => handleCustomJsonChange(e.target.value)}
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  border: `1px solid ${jsonError ? '#ef4444' : 'var(--line)'}`,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  resize: 'vertical'
                }}
              />
            </div>
          )}
        </fieldset>

        {/* Modal Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--card)'
        }}>
          <button
            type="button"
            className="btn btn-open"
            onClick={() => onTest(form)}
            disabled={testingId === form.id}
          >
            <Activity size={13} />
            {testingId === form.id ? 'Pinging…' : 'Test Ping'}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--muted)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { onClose(); window.location.hash = 'parameters'; }}
            >
              Edit in Parameter Studio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
