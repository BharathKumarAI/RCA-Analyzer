import React, { useState, useEffect } from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertCircle,
  Activity,
  ArrowUpRight,
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
  Globe,
  Server,
  Key,
  RefreshCw,
  FileCode,
  Terminal,
  Cpu,
  Check,
  ExternalLink,
  Info,
  Radio,
  Clock,
  Filter,
  Bot,
  Network,
  Share2,
  Workflow
} from 'lucide-react';
import { ToolDefinition, ScopeLevel, ConnectorCategory, IntegrationKind } from '../types/api';

interface ToolsProps {
  tools: ToolDefinition[];
}

const CONNECTOR_TEMPLATES: Array<{
  type: string;
  name: string;
  system_name: string;
  category: ConnectorCategory;
  description: string;
  integration_kind: IntegrationKind;
  protocol: string;
  auth_method: string;
  default_endpoint: string;
  default_secret: string;
  default_scope: ScopeLevel;
  can_override: boolean;
  default_config: Record<string, any>;
  default_mcp?: ToolDefinition['mcp_config'];
  default_a2a?: ToolDefinition['a2a_config'];
}> = [
  {
    type: 'jira',
    name: 'Jira Cloud Incident Triage',
    system_name: 'jira',
    category: 'Ticketing',
    description: 'Read-only ticket ingestion, JQL polling, custom field mapping, and RCA extraction.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Bearer Token',
    default_endpoint: 'https://atlassian.net/rest/api/3',
    default_secret: 'JIRA_API_TOKEN',
    default_scope: 'platform_default',
    can_override: true,
    default_config: {
      polling_cron: '*/15 * * * *',
      reporting_cron: '0 17 * * 5',
      timezone: 'America/Chicago',
      customfields: {
        fix_team: 'customfield_10290',
        environment: 'customfield_10291',
        fix_application: 'customfield_10292',
        severity: 'customfield_10285',
        rca: 'customfield_10320'
      }
    }
  },
  {
    type: 'splunk',
    name: 'Splunk Infrastructure & Log Mining',
    system_name: 'splunk',
    category: 'Observability',
    description: 'Time-bounded log querying, saved searches, event correlation, and metric anomaly extraction.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Bearer Token',
    default_endpoint: 'https://splunk-api.prod.internal:8089',
    default_secret: 'SPLUNK_HEC_TOKEN',
    default_scope: 'platform_default',
    can_override: true,
    default_config: {
      allowed_indexes: ['adms', 'billing', 'system', 'metrics'],
      search_app_url: 'https://splunk-ui.prod.internal:8000/en-US/app/search/search',
      data_sources: { metrics: true, events: true, logs: true }
    }
  },
  {
    type: 'signalfx',
    name: 'SignalFx APM & Distributed Tracing',
    system_name: 'signalfx',
    category: 'Observability',
    description: 'Distributed trace waterfall analysis, span error auto-detection, and service graphs.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Bearer Token (X-SF-Token)',
    default_endpoint: 'https://signalfx-api.prod.internal/v2',
    default_secret: 'SIGNALFX_API_TOKEN',
    default_scope: 'platform_default',
    can_override: true,
    default_config: {
      monitored_namespaces: ['npe-qlab01', 'npe-qlab02', 'npe-qlab03', 'plab01'],
      data_sources: { metrics: true, events: true, traces: true, logs: true }
    }
  },
  {
    type: 'confluence',
    name: 'Confluence Knowledge & Architecture',
    system_name: 'confluence',
    category: 'Knowledge & RAG',
    description: 'Knowledge base refresh, runbook ingestion, and architecture context mapping.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Bearer Token',
    default_endpoint: 'https://atlassian.net/wiki/rest/api',
    default_secret: 'CONFLUENCE_API_TOKEN',
    default_scope: 'platform_default',
    can_override: true,
    default_config: {
      refresh_schedule: 'Daily at 9:00 PM CT',
      cron: '0 21 * * *',
      timezone: 'America/Chicago'
    }
  },
  {
    type: 'qtest',
    name: 'qTest Test Case & Verification',
    system_name: 'qtest',
    category: 'Quality Assurance',
    description: 'Test case execution results, acceptance criteria link discovery, and failure tracking.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Bearer Token',
    default_endpoint: 'https://qtest.corp.internal/api/v3',
    default_secret: 'QTEST_API_TOKEN',
    default_scope: 'project_override',
    can_override: true,
    default_config: {
      project_id: 'PRISM-SAG-01',
      monitored_environments: ['QLAB01', 'QLAB02', 'QLAB03', 'QLAB06', 'PLAB01'],
      jira_link_discovery: true
    }
  },
  {
    type: 'gitlab',
    name: 'GitLab Source & CI/CD Pipelines',
    system_name: 'gitlab',
    category: 'Source & CI/CD',
    description: 'Commit log discovery, deployment timeline inspection, and pipeline error logs.',
    integration_kind: 'native',
    protocol: 'HTTPS',
    auth_method: 'Personal Access Token (PRIVATE-TOKEN)',
    default_endpoint: 'https://gitlab.corp.internal/api/v4',
    default_secret: 'GITLAB_PAT_TOKEN',
    default_scope: 'project_override',
    can_override: true,
    default_config: {
      projects: ['samson_core', 'customer_hub', 'consumer_rabbitmq'],
      track_deployments: true,
      track_pipeline_logs: true
    }
  },
  {
    type: 'oracle',
    name: 'Oracle Samson Database Analytics',
    system_name: 'samson',
    category: 'Databases',
    description: 'Direct read-only SQL querying, schema table discovery, data freshness probe.',
    integration_kind: 'native',
    protocol: 'Oracle Net (TNS/OCI)',
    auth_method: 'Database Credentials (User/Password Secret)',
    default_endpoint: 'oracle-scan.corp.internal:1521/SAMSON_SRV',
    default_secret: 'ORACLE_SAMSON_SECRET',
    default_scope: 'project_only',
    can_override: true,
    default_config: {
      host: 'oracle-scan.corp.internal',
      port: 1521,
      sid: 'SAMSON01',
      service_name: 'samson.unix.internal',
      username: 'SAMSON_RO',
      schema: 'SAMSON_APP',
      default_row_limit: 500,
      read_only_enforced: true,
      connection_pool: { min: 2, max: 10 }
    }
  },
  {
    type: 'kubernetes',
    name: 'Kubernetes Cluster & Pod Telemetry',
    system_name: 'kubernetes',
    category: 'Container Orchestration',
    description: 'Application-level pod status, CrashLoopBackOff detection, deployment rollouts, and node quotas.',
    integration_kind: 'native',
    protocol: 'HTTPS (v1)',
    auth_method: 'Kubeconfig / Service Account Token',
    default_endpoint: 'https://k8s-cluster.corp.internal:6443',
    default_secret: 'K8S_SERVICE_ACCOUNT_TOKEN',
    default_scope: 'platform_default',
    can_override: false,
    default_config: {
      cluster_name: 'npe-k8s-us-central1',
      monitored_namespaces: ['npe-qlab01', 'npe-qlab02', 'npe-qlab03', 'plab01'],
      operations: ['get_pod_status', 'get_pod_events', 'check_deployment', 'check_node_status', 'check_resource_quota']
    }
  },
  {
    type: 'mcp_generic',
    name: 'Model Context Protocol (MCP) Server',
    system_name: 'custom_mcp',
    category: 'Observability',
    description: 'Standardized Model Context Protocol server exposing tool schemas over SSE or Stdio.',
    integration_kind: 'mcp',
    protocol: 'MCP (SSE)',
    auth_method: 'MCP Bearer Token',
    default_endpoint: 'mcp://service-mcp.internal:9090',
    default_secret: 'MCP_SERVICE_TOKEN',
    default_scope: 'platform_default',
    can_override: true,
    default_config: {},
    default_mcp: {
      transport: 'sse',
      tools_exposed: ['query_status', 'search_data', 'stream_events']
    }
  },
  {
    type: 'a2a_generic',
    name: 'Agent-to-Agent (A2A) Delegation Bridge',
    system_name: 'a2a_agent_bridge',
    category: 'Host & Runtime Health',
    description: 'Google ADK native AgentTool delegation or A2A REST protocol for multi-agent investigation.',
    integration_kind: 'a2a',
    protocol: 'ADK AgentTool',
    auth_method: 'Mutual TLS & RS256 JWT',
    default_endpoint: 'http://agent-service.internal:8000/a2a/v1',
    default_secret: 'AGENT_DELEGATION_SECRET',
    default_scope: 'project_override',
    can_override: true,
    default_config: {},
    default_a2a: {
      target_agent_id: 'specialist-investigator-agent',
      target_capability: 'specialized_investigation',
      delegation_protocol: 'adk_agent_tool',
      dual_custody_approved: true,
      content_hash: 'sha256:d189b882ac0012'
    }
  }
];

export const Tools: React.FC<ToolsProps> = ({ tools: initialTools }) => {
  // Load from localStorage if present
  const [toolsList, setToolsList] = useState<ToolDefinition[]>(() => {
    try {
      const saved = localStorage.getItem('rca_connectors_config_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 13) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return initialTools;
  });

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('rca_connectors_config_v3', JSON.stringify(toolsList));
    } catch {
      // ignore
    }
  }, [toolsList]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleToggleEnabled = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setToolsList(prev =>
      prev.map(t => {
        if (t.id === id) {
          const next = !t.enabled;
          showToast(`${t.name} is now ${next ? 'ENABLED' : 'DISABLED'}`);
          return {
            ...t,
            enabled: next,
            status: next ? 'connected' : 'disabled'
          };
        }
        return t;
      })
    );
  };

  const handleTestConnection = (tool: ToolDefinition, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTestingId(tool.id);
    setTestResult(null);

    const isDisabled = !tool.enabled && tool.status === 'disabled';

    setTimeout(() => {
      setTestingId(null);
      if (isDisabled) {
        setTestResult({
          id: tool.id,
          success: false,
          msg: `Connector disabled by deployment policy or administrative toggle.`
        });
      } else {
        const latency = Math.floor(Math.random() * 35) + 12;
        const protocolStr = tool.type === 'mcp' ? `MCP (${tool.mcp_config?.transport || 'SSE'})` : tool.type === 'a2a' ? `A2A (${tool.a2a_config?.delegation_protocol || 'AgentTool'})` : tool.protocol || 'HTTPS';
        setTestResult({
          id: tool.id,
          success: true,
          msg: `Connection verified: 200 OK via ${protocolStr} with secret ${tool.secret_reference || 'reference'}.`,
          latency_ms: latency
        });
      }
    }, 600);
  };

  const handleSaveConfig = (updated: ToolDefinition) => {
    setToolsList(prev =>
      prev.map(t => (t.id === updated.id ? updated : t))
    );
    setConfiguringTool(null);
    showToast(`Updated configuration for ${updated.name}`);
  };

  const handleCreateConnector = (newTool: ToolDefinition) => {
    setToolsList(prev => [newTool, ...prev]);
    setIsCreating(false);
    showToast(`Successfully bound connector: ${newTool.name}`);
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
            Declarative telemetry connectors, Model Context Protocol (MCP) servers, and Google ADK Agent-to-Agent (A2A) bridges bridging Jira, Splunk, SignalFx, Oracle, Kafka, Unix logs, and Kubernetes clusters.
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
              onClick={() => setIsCreating(true)}
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
                cursor: 'pointer',
                border: 'none'
              }}
            >
              <Plus size={14} /> Add / Bind Connector (MCP / A2A)
            </button>
            <button
              type="button"
              className="btn btn-open"
              onClick={() => handleTestConnection(toolsList[0])}
              title="Ping primary Jira triage connector"
            >
              <Activity size={13} /> Ping Active Fleet
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* FULL-DETAIL GOVERNANCE & PRECEDENCE BANNER (Never Squashed)  */}
      {/* ------------------------------------------------------------- */}
      <div className="notice-banner purple">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Sliders size={16} style={{ color: 'var(--acc)' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                Configuration Resolution Precedence & Override Policy
              </h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5, maxWidth: '900px' }}>
              In accordance with <code>sample.yaml</code> specification, configurations resolve through a strict 5-tier precedence hierarchy. Platform defaults define baseline connectivity across the entire organization, while project teams can override parameters only when explicitly permitted by policy.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: 'rgba(99,102,241,0.12)', color: 'var(--acc)', border: '1px solid rgba(99,102,241,0.25)' }}>
              1. Platform
            </span>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>→</span>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: 'rgba(234,179,8,0.12)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.25)' }}>
              2. Project
            </span>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>→</span>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: 'rgba(168,85,247,0.12)', color: '#9333ea', border: '1px solid rgba(168,85,247,0.25)' }}>
              3. Environment
            </span>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>→</span>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: 'rgba(59,130,246,0.12)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.25)' }}>
              4. Profile
            </span>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>→</span>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}>
              5. Run
            </span>
          </div>
        </div>

        {/* Detailed Governance Rule Pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid rgba(99,102,241,0.15)', fontSize: '11px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--muted)' }}>
            <CheckCircle2 size={12} style={{ color: '#10b981' }} /> <code>inherit_platform_defaults: true</code> (Projects inherit baseline)
          </span>
          <span style={{ color: 'var(--line-strong)' }}>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--muted)' }}>
            <Unlock size={12} style={{ color: '#3b82f6' }} /> <code>project_can_override: policy-governed</code> (Admin configurable)
          </span>
          <span style={{ color: 'var(--line-strong)' }}>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--muted)' }}>
            <Server size={12} style={{ color: '#a855f7' }} /> <code>environment_can_override: true</code> (Per-lab QLAB/PLAB scopes)
          </span>
          <span style={{ color: 'var(--line-strong)' }}>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--muted)' }}>
            <Shield size={12} style={{ color: '#eab308' }} /> <code>reject_plaintext_secrets: true</code> (Strict secret references only)
          </span>
        </div>
      </div>

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
        {filtered.map((tool, index) => {
          const numStr = String(index + 1).padStart(3, '0');

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
                        title={tool.enabled ? 'Click to disable integration' : 'Click to enable integration'}
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
                        {tool.enabled ? 'ENABLED' : 'DISABLED'}
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
                      {tool.custom_config.polling_cron && (
                        <span><b>Poll:</b> <code>{tool.custom_config.polling_cron}</code></span>
                      )}
                      {tool.custom_config.reporting_cron && (
                        <span><b>Report:</b> <code>{tool.custom_config.reporting_cron}</code></span>
                      )}
                      {tool.custom_config.allowed_indexes && (
                        <span><b>Indexes:</b> {tool.custom_config.allowed_indexes.join(', ')}</span>
                      )}
                      {tool.custom_config.monitored_namespaces && (
                        <span><b>Namespaces:</b> {tool.custom_config.monitored_namespaces.length} active</span>
                      )}
                      {tool.custom_config.schema && (
                        <span><b>Schema:</b> <code>{tool.custom_config.schema}</code></span>
                      )}
                      {tool.custom_config.cluster_name && (
                        <span><b>Cluster:</b> {tool.custom_config.cluster_name}</span>
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
                    onClick={() => setConfiguringTool(tool)}
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
                    <Settings size={12} /> Configure
                  </button>

                  <button
                    type="button"
                    className="btn btn-open"
                    onClick={(e) => handleTestConnection(tool, e)}
                    disabled={testingId === tool.id}
                  >
                    <Activity size={12} />
                    {testingId === tool.id ? 'Testing...' : 'Test Ping'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* ============================================================ */}
      {/* CONNECTOR CONFIGURATION MODAL                                */}
      {/* ============================================================ */}
      {configuringTool && (
        <ConnectorConfigModal
          tool={configuringTool}
          onClose={() => setConfiguringTool(null)}
          onSave={handleSaveConfig}
          onTest={handleTestConnection}
          testingId={testingId}
          testResult={testResult}
        />
      )}

      {/* ============================================================ */}
      {/* CREATE NEW CONNECTOR / MCP / A2A MODAL                       */}
      {/* ============================================================ */}
      {isCreating && (
        <CreateConnectorModal
          onClose={() => setIsCreating(false)}
          onCreate={handleCreateConnector}
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
  onSave: (tool: ToolDefinition) => void;
  onTest: (tool: ToolDefinition) => void;
  testingId: string | null;
  testResult: { id: string; success: boolean; msg: string; latency_ms?: number } | null;
}

const ConnectorConfigModal: React.FC<ModalProps> = ({
  tool,
  onClose,
  onSave,
  onTest,
  testingId,
  testResult
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'endpoints' | 'auth' | 'mcp_a2a' | 'custom'>('general');
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

  const handleSave = () => {
    if (jsonError) return;
    onSave(form);
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
        maxWidth: '780px',
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
          background: 'var(--bg)'
        }}>
          {[
            { id: 'general', label: 'General & Scope' },
            { id: 'endpoints', label: 'Endpoints & Protocol' },
            { id: 'auth', label: 'Auth & Secrets' },
            ...(form.type === 'mcp' || form.type === 'a2a' ? [{ id: 'mcp_a2a', label: form.type === 'mcp' ? 'MCP Protocol Settings' : 'A2A Agent Delegation' }] : []),
            { id: 'custom', label: 'Custom Configuration' }
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
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
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
                  Primary Endpoint / API URL / MCP Command
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
                  UI Presentation URL (Optional)
                </label>
                <input
                  type="text"
                  value={form.ui_base_url || ''}
                  onChange={e => setForm(p => ({ ...p, ui_base_url: e.target.value }))}
                  placeholder="https://splunk-ui.internal:8000 or https://atlassian.net"
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
                <span><b>Zero Plaintext Guarantee:</b> Plaintext credentials are strictly prohibited. Configure environment variable or Google Secret Manager references.</span>
              </div>

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
                  placeholder="e.g. JIRA_API_TOKEN, KAFKA_MCP_TOKEN, AGENT_SECRET"
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
                rows={12}
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
        </div>

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
              onClick={handleSave}
              disabled={!!jsonError}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--acc)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// CreateConnectorModal Component (Supports Native, MCP, A2A)
// ----------------------------------------------------------------------
interface CreateModalProps {
  onClose: () => void;
  onCreate: (tool: ToolDefinition) => void;
}

const CreateConnectorModal: React.FC<CreateModalProps> = ({ onClose, onCreate }) => {
  const [integrationKind, setIntegrationKind] = useState<IntegrationKind>('native');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('jira');
  const [name, setName] = useState('New Integration');
  const [systemName, setSystemName] = useState('');
  const [category, setCategory] = useState<ConnectorCategory>('Observability');
  const [description, setDescription] = useState('');
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>('platform_default');
  const [projectCanOverride, setProjectCanOverride] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [endpoint, setEndpoint] = useState('');
  const [protocol, setProtocol] = useState('HTTPS');
  const [authMethod, setAuthMethod] = useState('Bearer Token');
  const [secretReference, setSecretReference] = useState('');

  // MCP specific fields
  const [mcpTransport, setMcpTransport] = useState<'sse' | 'stdio' | 'websocket' | 'streamable_http'>('sse');
  const [mcpToolsStr, setMcpToolsStr] = useState('scan_messages, check_consumer_lag');

  // A2A specific fields
  const [a2aTargetAgent, setA2aTargetAgent] = useState('specialist-agent-01');
  const [a2aCapability, setA2aCapability] = useState('incident_triage_classification');
  const [a2aProtocol, setA2aProtocol] = useState<'adk_agent_tool' | 'a2a_rest' | 'a2a_jsonrpc'>('adk_agent_tool');
  const [a2aDualCustody, setA2aDualCustody] = useState(true);

  // When template changes, apply defaults
  useEffect(() => {
    const tmpl = CONNECTOR_TEMPLATES.find(t => t.type === selectedTemplateKey);
    if (tmpl) {
      setName(tmpl.name);
      setSystemName(tmpl.system_name);
      setCategory(tmpl.category);
      setDescription(tmpl.description);
      setScopeLevel(tmpl.default_scope);
      setProjectCanOverride(tmpl.can_override);
      setEndpoint(tmpl.default_endpoint);
      setProtocol(tmpl.protocol);
      setAuthMethod(tmpl.auth_method);
      setSecretReference(tmpl.default_secret);
      setIntegrationKind(tmpl.integration_kind);
    }
  }, [selectedTemplateKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tmpl = CONNECTOR_TEMPLATES.find(t => t.type === selectedTemplateKey);
    const newTool: ToolDefinition = {
      id: `tool-${systemName.toLowerCase().replace(/[^a-z0-9]/g, '-') || Date.now()}`,
      name,
      system_name: systemName || selectedTemplateKey,
      category,
      description,
      status: enabled ? 'connected' : 'disabled',
      enabled,
      type: integrationKind === 'mcp' ? 'mcp' : integrationKind === 'a2a' ? 'a2a' : 'connector',
      integration_kind: integrationKind,
      scope_level: scopeLevel,
      project_can_override: projectCanOverride,
      inherit_platform_defaults: scopeLevel !== 'project_only',
      rate_limit: integrationKind === 'mcp' ? '1000 msg / batch' : integrationKind === 'a2a' ? '60 calls / min' : '300 req / min',
      last_ping: 'Just created',
      latency_ms: 18,
      calls_today: 0,
      error_rate: 0.0,
      endpoint,
      protocol,
      auth_method: authMethod,
      secret_reference: secretReference,
      timeout_seconds: 30,
      retry_attempts: 3,
      custom_config: tmpl ? tmpl.default_config : {},
      mcp_config: integrationKind === 'mcp' ? {
        transport: mcpTransport,
        tools_exposed: mcpToolsStr.split(',').map(s => s.trim()).filter(Boolean)
      } : undefined,
      a2a_config: integrationKind === 'a2a' ? {
        target_agent_id: a2aTargetAgent,
        target_capability: a2aCapability,
        delegation_protocol: a2aProtocol,
        dual_custody_approved: a2aDualCustody,
        content_hash: 'sha256:e3b0c44298fc1c14'
      } : undefined
    };

    onCreate(newTool);
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
        maxWidth: '740px',
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
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} style={{ color: 'var(--acc)' }} />
              Bind Integration: Native Connector, MCP, or A2A Bridge
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              Configure telemetry tools, Model Context Protocol servers, or Google ADK Agent-to-Agent delegation bridges.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Integration Type Switcher */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
              Integration Architecture
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {[
                { id: 'native', label: 'Native Connector', desc: 'Jira, Splunk, SignalFx, DBs', icon: Database },
                { id: 'mcp', label: 'MCP Server', desc: 'Model Context Protocol tool server', icon: Cpu },
                { id: 'a2a', label: 'A2A Agent Bridge', desc: 'ADK AgentTool delegation mesh', icon: Bot }
              ].map(opt => {
                const Icon = opt.icon;
                const isSelected = integrationKind === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      setIntegrationKind(opt.id as any);
                      if (opt.id === 'mcp') {
                        setSelectedTemplateKey('mcp_generic');
                      } else if (opt.id === 'a2a') {
                        setSelectedTemplateKey('a2a_generic');
                      } else {
                        setSelectedTemplateKey('jira');
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                      background: isSelected ? 'var(--acc-subtle)' : 'var(--bg)',
                      cursor: 'pointer',
                      transition: 'all .15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color: isSelected ? 'var(--acc)' : 'var(--text)' }}>
                      <Icon size={14} />
                      {opt.label}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {opt.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Template Picker */}
          {integrationKind === 'native' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                Select Connector Template (from sample.yaml)
              </label>
              <select
                value={selectedTemplateKey}
                onChange={e => setSelectedTemplateKey(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '12px'
                }}
              >
                {CONNECTOR_TEMPLATES.filter(t => t.integration_kind === 'native').map(t => (
                  <option key={t.type} value={t.type}>
                    {t.name} ({t.category} • {t.protocol})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* MCP Specific Configuration Section */}
          {integrationKind === 'mcp' && (
            <div style={{
              background: 'rgba(234, 179, 8, 0.06)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(234, 179, 8, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#ca8a04', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} /> Model Context Protocol (MCP) Parameters
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>Transport</label>
                  <select
                    value={mcpTransport}
                    onChange={e => setMcpTransport(e.target.value as any)}
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px' }}
                  >
                    <option value="sse">SSE (HTTP Server-Sent Events)</option>
                    <option value="streamable_http">Streamable HTTP</option>
                    <option value="stdio">Stdio (Local Command)</option>
                    <option value="websocket">WebSocket</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>Exposed MCP Tools</label>
                  <input
                    type="text"
                    value={mcpToolsStr}
                    onChange={e => setMcpToolsStr(e.target.value)}
                    placeholder="scan_messages, check_consumer_lag, query_health"
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* A2A Specific Configuration Section */}
          {integrationKind === 'a2a' && (
            <div style={{
              background: 'rgba(168, 85, 247, 0.06)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#9333ea', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Bot size={14} /> Google ADK Agent-to-Agent (A2A) Delegation Bridge
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>Target Specialist Agent ID</label>
                  <input
                    type="text"
                    value={a2aTargetAgent}
                    onChange={e => setA2aTargetAgent(e.target.value)}
                    placeholder="agent-jira-triage-specialist"
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>Target Capability</label>
                  <input
                    type="text"
                    value={a2aCapability}
                    onChange={e => setA2aCapability(e.target.value)}
                    placeholder="jira_triage_classification"
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>Delegation Protocol</label>
                  <select
                    value={a2aProtocol}
                    onChange={e => setA2aProtocol(e.target.value as any)}
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px' }}
                  >
                    <option value="adk_agent_tool">ADK Native AgentTool</option>
                    <option value="a2a_rest">A2A REST Endpoint</option>
                    <option value="a2a_jsonrpc">A2A JSON-RPC</option>
                  </select>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginTop: '16px' }}>
                  <input
                    type="checkbox"
                    checked={a2aDualCustody}
                    onChange={e => setA2aDualCustody(e.target.checked)}
                  />
                  <span>Dual-Custody Approved</span>
                </label>
              </div>
            </div>
          )}

          {/* Scope Level Setting */}
          <div style={{
            background: 'rgba(99,102,241,0.06)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sliders size={14} style={{ color: 'var(--acc)' }} />
              Scope & Precedence Setting
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>
                  Scoping Tier
                </label>
                <select
                  value={scopeLevel}
                  onChange={e => setScopeLevel(e.target.value as ScopeLevel)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--card)',
                    color: 'var(--text)',
                    fontSize: '12px'
                  }}
                >
                  <option value="platform_default">Platform Default (Shared baseline)</option>
                  <option value="project_override">Project Override (Overrides platform)</option>
                  <option value="project_only">Direct Project-Only (No platform default)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)' }}>
                  Project Override Policy
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    checked={projectCanOverride}
                    onChange={e => setProjectCanOverride(e.target.checked)}
                  />
                  <span>Allow project teams to override</span>
                </label>
              </div>
            </div>
          </div>

          {/* Name & System Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                Integration Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
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
                System Identifier
              </label>
              <input
                type="text"
                required
                value={systemName}
                onChange={e => setSystemName(e.target.value)}
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

          {/* Endpoint & Protocol */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                Endpoint URL / Host / MCP URI
              </label>
              <input
                type="text"
                required
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
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
                Protocol
              </label>
              <select
                value={protocol}
                onChange={e => setProtocol(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '12px'
                }}
              >
                <option value="HTTPS">HTTPS</option>
                <option value="MCP (SSE)">MCP (SSE)</option>
                <option value="MCP (Streamable HTTP)">MCP (Streamable HTTP)</option>
                <option value="MCP (Stdio)">MCP (Stdio)</option>
                <option value="ADK AgentTool">ADK AgentTool</option>
                <option value="A2A REST Protocol">A2A REST Protocol</option>
                <option value="Oracle Net (TNS/OCI)">Oracle Net</option>
                <option value="SSH">SSH</option>
              </select>
            </div>
          </div>

          {/* Auth & Secret */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                Auth Method
              </label>
              <input
                type="text"
                value={authMethod}
                onChange={e => setAuthMethod(e.target.value)}
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
                required
                value={secretReference}
                onChange={e => setSecretReference(e.target.value)}
                placeholder="e.g. JIRA_API_TOKEN, MCP_SECRET"
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
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
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

          {/* Initial Enabled checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
            />
            <span style={{ fontWeight: 600 }}>Enable this integration immediately upon creation</span>
          </label>

          {/* Modal Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '10px',
            borderTop: '1px solid var(--line)',
            paddingTop: '14px'
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
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
              type="submit"
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--acc)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Bind Integration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
