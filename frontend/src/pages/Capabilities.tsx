import React, { useEffect, useMemo, useState } from 'react';
import {
  Layers,
  ShieldCheck,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  Cpu,
  Copy,
  Check,
  RefreshCw,
  FileCode,
  Lock,
  Workflow,
  BookOpen,
  Plug,
  Sliders,
  Play,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import {
  ApiError,
  fetchCapabilities,
  setProjectAvailability,
  fetchConfig,
  fetchSkills,
  fetchConnectorsHealth,
  fetchPrincipal,
} from '../services/api';
import {
  CapabilityItem,
  RuntimeConfig,
  SkillItem,
  ConnectorsHealthResponse,
  Principal,
  StageModelProfile,
} from '../types/api';
import '../styles/capabilities.css';

type TabKey = 'topology' | 'governance' | 'model' | 'manifest';
type ViewMode = 'workflows' | 'profiles';

interface CapabilitiesProps {
  onNewInvestigation?: (capabilityId: string) => void;
}

export const Capabilities: React.FC<CapabilitiesProps> = ({ onNewInvestigation }) => {
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [connectorsHealth, setConnectorsHealth] = useState<ConnectorsHealthResponse | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);

  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCapId, setSelectedCapId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabKey>('topology');
  const [activeProfileKey, setActiveProfileKey] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('workflows');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [caps, conf, sks, connHealth, me] = await Promise.all([
        fetchCapabilities(true),
        fetchConfig(),
        fetchSkills(),
        fetchConnectorsHealth(),
        fetchPrincipal(),
      ]);

      setCapabilities(caps);
      setConfig(conf);
      setSkills(sks);
      setConnectorsHealth(connHealth);
      setPrincipal(me);

      if (caps.length > 0) {
        setSelectedCapId(current => (caps.some(c => c.id === current) ? current : caps[0].id));
      }

      const profiles = conf?.model_profiles?.profiles || {};
      const profileNames = Object.keys(profiles);
      if (profileNames.length > 0) {
        setActiveProfileKey(current => (current && profiles[current] ? current : profileNames[0]));
      }
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to load capability configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // Extract unique categories dynamically from server data
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    capabilities.forEach(cap => {
      if (cap.category) cats.add(cap.category);
    });
    return Array.from(cats);
  }, [capabilities]);

  // Filter capabilities by search query and category
  const filteredCapabilities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return capabilities.filter(cap => {
      if (selectedCategory !== 'all' && cap.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        cap.id,
        cap.name,
        cap.description,
        cap.category || '',
        cap.model_profile || '',
        ...(cap.skills || []),
        ...(cap.requires?.connectors || []),
        ...(cap.optional?.connectors || []),
        ...(cap.permissions?.allowed_actions || []),
        ...(cap.permissions?.allowed_roles || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [capabilities, searchQuery, selectedCategory]);

  const selectedCap = useMemo(() => {
    if (!capabilities.length) return null;
    return (
      capabilities.find(c => c.id === selectedCapId) ||
      filteredCapabilities[0] ||
      capabilities[0]
    );
  }, [capabilities, selectedCapId, filteredCapabilities]);

  // Skills bound to the selected capability strictly from /api/v1/skills
  const linkedSkills = useMemo(() => {
    if (!selectedCap?.skills?.length) return [];
    return selectedCap.skills.map(skillId => {
      const matched = skills.find(s => s.id === skillId);
      return matched || { id: skillId };
    });
  }, [selectedCap, skills]);

  // Model profile stages for the selected capability directly from config
  const capProfileStages = useMemo(() => {
    if (!selectedCap || !config?.model_profiles) return [];
    const profileKey = selectedCap.model_profile || '';
    const profileDef = config.model_profiles.profiles?.[profileKey];
    if (!profileDef) return [];
    const stagesDef = config.model_profiles.stages || {};

    const rows: Array<{
      stage: string;
      model: string;
      thinking: string;
      maxOutput: string;
      temperature: string;
      enabled: boolean;
    }> = [];

    Object.entries(profileDef).forEach(([stageName, stageRef]) => {
      if (stageName === 'tool_call_limit') return;
      const stageKey = String(stageRef);
      const stageConf: StageModelProfile | undefined = stagesDef[stageKey];
      if (stageConf) {
        const thinking =
          typeof stageConf.thinking_level === 'string'
            ? stageConf.thinking_level
            : stageConf.thinking_budget
            ? `${stageConf.thinking_budget}`
            : '—';
        rows.push({
          stage: stageName,
          model: stageConf.model || '—',
          thinking,
          maxOutput: stageConf.max_output_tokens ? stageConf.max_output_tokens.toLocaleString() : '—',
          temperature: typeof stageConf.temperature === 'number' ? stageConf.temperature.toFixed(1) : '—',
          enabled: stageConf.enabled !== false,
        });
      }
    });
    return rows;
  }, [selectedCap, config]);

  // Global model profile matrix rows based on activeProfileKey
  const globalProfileRows = useMemo(() => {
    if (!config?.model_profiles) return [];
    const profileDef = config.model_profiles.profiles?.[activeProfileKey];
    if (!profileDef) return [];
    const stagesDef = config.model_profiles.stages || {};

    const rows: Array<{
      stage: string;
      model: string;
      thinking: string;
      maxOutput: string;
      temperature: string;
      enabled: boolean;
    }> = [];

    Object.entries(profileDef).forEach(([stageName, stageRef]) => {
      if (stageName === 'tool_call_limit') return;
      const stageKey = String(stageRef);
      const stageConf: StageModelProfile | undefined = stagesDef[stageKey];
      if (stageConf) {
        const thinking =
          typeof stageConf.thinking_level === 'string'
            ? stageConf.thinking_level
            : stageConf.thinking_budget
            ? `${stageConf.thinking_budget}`
            : '—';
        rows.push({
          stage: stageName,
          model: stageConf.model || '—',
          thinking,
          maxOutput: stageConf.max_output_tokens ? stageConf.max_output_tokens.toLocaleString() : '—',
          temperature: typeof stageConf.temperature === 'number' ? stageConf.temperature.toFixed(1) : '—',
          enabled: stageConf.enabled !== false,
        });
      }
    });
    return rows;
  }, [config, activeProfileKey]);

  // Capabilities mapped to the active profile in Model Profiles view
  const workflowsForActiveProfile = useMemo(() => {
    return capabilities.filter(c => c.model_profile === activeProfileKey);
  }, [capabilities, activeProfileKey]);

  const handleCopyManifest = async () => {
    if (!selectedCap) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedCap, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy manifest. Select and copy JSON directly.');
    }
  };

  const getConnectorHealthBadge = (connectorName: string) => {
    if (!connectorsHealth) {
      return <span className="meta-pill">Loading…</span>;
    }
    const disabled = connectorsHealth.disabled?.includes(connectorName);
    if (disabled) {
      return (
        <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <XCircle size={11} /> Disabled in Project
        </span>
      );
    }
    const probe = connectorsHealth.connectors?.[connectorName];
    if (probe) {
      const isHealthy = probe.overall === 'HEALTHY' || (typeof probe === 'object' && (probe as any).overall?.value === 'HEALTHY');
      return (
        <span className={`badge ${isHealthy ? 'badge-active' : 'badge-neutral'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isHealthy ? <CheckCircle2 size={11} /> : <ShieldAlert size={11} />}
          {String((probe as any).overall || 'configured')}
        </span>
      );
    }
    const unconfigured = connectorsHealth.unconfigured?.includes(connectorName);
    if (unconfigured) {
      return (
        <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ShieldAlert size={11} /> Unconfigured
        </span>
      );
    }
    return (
      <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Referenced in Manifest
      </span>
    );
  };

  return (
    <div className="view-container capabilities-page">
      {/* Breadcrumbs */}
      <div className="capabilities-breadcrumbs">
        <span>Admin</span>
        <span className="separator">/</span>
        <span>Configuration</span>
        <span className="separator">/</span>
        <span className="active-crumb">Capabilities & Topology</span>
      </div>

      {/* Page Header */}
      <header className="capabilities-page-header">
        <div className="capabilities-header-main">
          <h1>
            <Workflow size={22} color="var(--acc)" />
            Workflow Capabilities & Execution Topology
          </h1>
          <p>
            Declarative capability contracts loaded directly from server manifests and evaluated by the ADK capability resolver.
          </p>

          <div className="capabilities-stats-strip">
            <button
              type="button"
              className={`capabilities-stat-chip interactive ${viewMode === 'workflows' ? 'is-active' : ''}`}
              onClick={() => setViewMode('workflows')}
              title="Show Workflow Master-Detail Directory"
            >
              <Layers size={12} />
              Workflows: <b>{capabilities.length}</b>
            </button>
            <button
              type="button"
              className={`capabilities-stat-chip interactive ${viewMode === 'profiles' ? 'is-active' : ''}`}
              onClick={() => setViewMode('profiles')}
              title="Show Platform Model Profiles Matrix"
            >
              <Cpu size={12} />
              Model Profiles: <b>{Object.keys(config?.model_profiles?.profiles || {}).length}</b>
            </button>
            <span className="capabilities-stat-chip">
              <BookOpen size={12} />
              Skills: <b>{skills.length}</b>
            </span>
            <span className="capabilities-stat-chip">
              <ShieldCheck size={12} />
              Scope: <b>{principal ? `${principal.tenant_id} / ${principal.project_id}` : 'Local Scope'}</b>
            </span>
            <span className="capabilities-stat-chip">
              Mode: <b>{config?.mode || 'demo'}</b>
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadAll()}
              title="Reload from server"
              style={{ padding: '3px 10px', height: '24px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              disabled={loading}
            >
              <RefreshCw size={11} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="capabilities-page-actions">
          <div className="capabilities-view-switcher" role="tablist" aria-label="Capabilities View Mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'workflows'}
              className={`capabilities-view-btn ${viewMode === 'workflows' ? 'is-active' : ''}`}
              onClick={() => setViewMode('workflows')}
            >
              <Layers size={13} />
              Workflows ({capabilities.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'profiles'}
              className={`capabilities-view-btn ${viewMode === 'profiles' ? 'is-active' : ''}`}
              onClick={() => setViewMode('profiles')}
            >
              <Sliders size={13} />
              Model Profiles Matrix ({Object.keys(config?.model_profiles?.profiles || {}).length})
            </button>
          </div>
        </div>
      </header>

      {/* Error alert */}
      {error && (
        <div className="card" style={{ color: 'var(--danger)', borderColor: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadAll()}>
            Retry
          </button>
        </div>
      )}

      {/* VIEW 1: WORKFLOW MASTER-DETAIL EXPLORER */}
      {viewMode === 'workflows' && (
        <div className="capabilities-workspace-layout">
          {/* Column 1: Workflow Catalog Panel (Left) */}
          <section className="capabilities-catalog-column" aria-label="Workflow Catalog">
            <div className="capabilities-catalog-header">
              <div className="capabilities-catalog-title-row">
                <h2>
                  <Workflow size={15} color="var(--acc)" />
                  Workflows
                </h2>
                <span className="capabilities-catalog-count-badge">
                  {filteredCapabilities.length} / {capabilities.length}
                </span>
              </div>

              {/* Search Box */}
              <div className="capabilities-search-wrap">
                <Search size={13} />
                <input
                  type="search"
                  className="capabilities-search-input"
                  placeholder="Search workflows, tools, connectors…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Category Filter Tabs */}
              <div className="capabilities-filter-tabs">
                <button
                  type="button"
                  className={`capabilities-filter-tab ${selectedCategory === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  All ({capabilities.length})
                </button>
                {availableCategories.map(cat => {
                  const catCount = capabilities.filter(c => c.category === cat).length;
                  return (
                    <button
                      type="button"
                      key={cat}
                      className={`capabilities-filter-tab ${selectedCategory === cat ? 'is-active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {cat} ({catCount})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bounded Scrollable Items List */}
            <div className="capabilities-items-list" role="listbox" aria-label="Available Workflows">
              {loading && !capabilities.length ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                  <RefreshCw size={18} className="spin" style={{ margin: '0 auto 8px auto', color: 'var(--acc)' }} />
                  Loading workflow catalog…
                </div>
              ) : filteredCapabilities.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                  <Workflow size={20} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
                  <div>No workflows match filters.</div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                    style={{ marginTop: '10px', fontSize: '11px', padding: '4px 10px' }}
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                filteredCapabilities.map(cap => {
                  const isSelected = selectedCap?.id === cap.id;
                  const isEnabled = cap.enabled !== false;
                  const isAuthorized = cap.is_authorized !== false;

                  return (
                    <button
                      key={cap.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelectedCapId(cap.id)}
                      className={`capability-item-card ${isSelected ? 'is-selected' : ''}`}
                    >
                      {/* Avatar Icon */}
                      <div className={`capability-avatar-icon ${!isEnabled ? 'disabled' : ''}`}>
                        {cap.category === 'triage' ? (
                          <Layers size={16} />
                        ) : cap.requires?.connectors?.includes('database_query') ? (
                          <Cpu size={16} />
                        ) : (
                          <Workflow size={16} />
                        )}
                      </div>

                      {/* Content Body */}
                      <div className="capability-item-body">
                        <div className="capability-item-header">
                          <span className="capability-item-title" title={cap.name || cap.id}>
                            {cap.name || cap.id}
                          </span>
                          {!isEnabled ? (
                            <span className="badge badge-neutral" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              Disabled
                            </span>
                          ) : !isAuthorized ? (
                            <span className="badge badge-error" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              Unauthorized
                            </span>
                          ) : (
                            <span className="badge badge-active" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              Active
                            </span>
                          )}
                        </div>

                        <span className="capability-item-id">
                          {cap.id}
                        </span>

                        <div className="capability-item-chips">
                          <span className="capability-chip">
                            {cap.category || 'workflow'}
                          </span>
                          {cap.model_profile && (
                            <span className="capability-chip" title={`Model profile: ${cap.model_profile}`}>
                              <Cpu size={9} /> {cap.model_profile}
                            </span>
                          )}
                          {(cap.requires?.connectors || []).map(conn => (
                            <span key={conn} className="capability-chip conn" title={`Required connector: ${conn}`}>
                              <Plug size={9} /> {conn}
                            </span>
                          ))}
                          {(cap.skills || []).length > 0 && (
                            <span className="capability-chip" title={`${cap.skills?.length} bound platform skills`}>
                              <BookOpen size={9} /> {cap.skills?.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Column 2: Deep Capability Inspector (Right) */}
          {selectedCap && (
            <article className="capabilities-inspector-column" aria-label="Workflow Inspector">
              {/* Sticky Inspector Header */}
              <div className="capabilities-inspector-header">
                <div className="capabilities-inspector-title-row">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                        {selectedCap.name || selectedCap.id}
                      </h2>

                      {/* Status Badges */}
                      <span className={`badge ${selectedCap.enabled !== false ? 'badge-active' : 'badge-neutral'}`} style={{ fontSize: '11px' }}>
                        {selectedCap.enabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="brand-badge" style={{ fontSize: '11px' }}>
                        {selectedCap.category || 'workflow'}
                      </span>
                      {selectedCap.version && (
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          v{selectedCap.version}
                        </span>
                      )}
                    </div>
                    <code style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                      id: {selectedCap.id}
                    </code>
                  </div>

                  {/* Actions Strip */}
                  <div className="capabilities-inspector-actions">
                    {/* Project Availability Toggle Guard */}
                    {(principal?.roles.includes('PLATFORM_ADMIN') || principal?.roles.includes('PROJECT_OWNER')) && (
                      selectedCap.enabled === false ? (
                        <span
                          className="badge badge-neutral"
                          title="Platform manifests take precedence over project availability"
                          style={{ fontSize: '11px', padding: '5px 10px', height: '28px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Lock size={11} /> Platform Disabled
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          role="switch"
                          aria-label="Available for project"
                          aria-checked={selectedCap.project_enabled !== false}
                          disabled={availabilityBusy}
                          style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                          onClick={async () => {
                            setAvailabilityBusy(true);
                            try {
                              await setProjectAvailability(
                                'capabilities',
                                selectedCap.id,
                                selectedCap.project_enabled === false,
                                selectedCap.project_enabled !== false
                              );
                              setCapabilities(await fetchCapabilities(true));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Unable to update availability.');
                            } finally {
                              setAvailabilityBusy(false);
                            }
                          }}
                        >
                          {availabilityBusy ? 'Saving…' : selectedCap.project_enabled === false ? 'Enable for project' : 'Disable for project'}
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCopyManifest}
                      style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      {copied ? <Check size={12} color="var(--acc3)" /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Copy JSON'}
                    </button>

                    {selectedCap.is_authorized !== false && selectedCap.enabled !== false && onNewInvestigation && (
                      <button
                        type="button"
                        onClick={() => onNewInvestigation(selectedCap.id)}
                        className="btn btn-primary"
                        style={{ fontSize: '11.5px', padding: '5px 12px', height: '28px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <Play size={12} />
                        Run Investigation
                      </button>
                    )}
                  </div>
                </div>

                <p className="capabilities-desc-text">
                  {selectedCap.description || 'No description declared in manifest.'}
                </p>

                {selectedCap.rejection_reason && (
                  <div
                    style={{
                      marginTop: '10px',
                      background: 'rgba(244, 63, 94, 0.08)',
                      border: '1px solid var(--acc-rose)',
                      borderRadius: '6px',
                      padding: '7px 12px',
                      fontSize: '12px',
                      color: 'var(--acc-rose)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <ShieldAlert size={14} />
                    <span><b>Server Resolution Notice:</b> {selectedCap.rejection_reason}</span>
                  </div>
                )}
              </div>

              {/* Inspector Tabs Bar */}
              <div className="capabilities-tabs-bar" role="tablist">
                {[
                  { key: 'topology' as TabKey, label: 'Bindings & Skills', icon: Workflow },
                  { key: 'governance' as TabKey, label: 'Governance & RBAC', icon: ShieldCheck },
                  { key: 'model' as TabKey, label: 'Stage Model Pipeline', icon: Cpu },
                  { key: 'manifest' as TabKey, label: 'Server Contract', icon: FileCode },
                ].map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                      className={`capabilities-tab-item ${isActive ? 'is-active' : ''}`}
                    >
                      <Icon size={13} color={isActive ? 'var(--acc)' : 'var(--muted)'} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Body */}
              <div className="capabilities-tab-body">
                {/* TAB 1: Bindings & Skills */}
                {activeTab === 'topology' && (
                  <>
                    {/* Connector Dependencies Section */}
                    <div className="card" style={{ padding: '16px', border: '1px solid var(--line)', background: 'var(--card-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <Plug size={15} color="var(--acc2)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                          Connector Dependencies
                        </h4>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        {/* Required Connectors */}
                        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--acc-rose)', textTransform: 'uppercase', marginBottom: '8px' }}>
                            Strictly Required (Blocks run if absent)
                          </div>
                          {(selectedCap.requires?.connectors || []).length === 0 ? (
                            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>None required</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {(selectedCap.requires?.connectors || []).map(conn => (
                                <div key={conn} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{conn}</span>
                                  {getConnectorHealthBadge(conn)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Optional Connectors */}
                        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--acc3)', textTransform: 'uppercase', marginBottom: '8px' }}>
                            Optional (Yields partial evidence if absent)
                          </div>
                          {(selectedCap.optional?.connectors || []).length === 0 ? (
                            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>None declared</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {(selectedCap.optional?.connectors || []).map(conn => (
                                <div key={conn} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{conn}</span>
                                  {getConnectorHealthBadge(conn)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bound Skills Section */}
                    <div className="card" style={{ padding: '16px', border: '1px solid var(--line)', background: 'var(--card-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <BookOpen size={15} color="var(--acc)" />
                          <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                            Bound Platform Skills ({linkedSkills.length})
                          </h4>
                        </div>
                        <a
                          href="#skills"
                          style={{ fontSize: '11px', color: 'var(--acc)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                        >
                          Open Skills Studio <ExternalLink size={10} />
                        </a>
                      </div>

                      {linkedSkills.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>No domain skills bound to this capability.</p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                          {linkedSkills.map(skill => (
                            <a
                              key={skill.id}
                              href={`#skills?skill=${skill.id}`}
                              className="capability-skill-link"
                              title={`Inspect '${skill.name || skill.id}' in Skills Studio`}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                  <strong style={{ fontSize: '12.5px', color: 'var(--tx)' }}>{skill.name || skill.id}</strong>
                                  {skill.status && (
                                    <span className="badge badge-active" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                                      {skill.status}
                                    </span>
                                  )}
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                  {typeof skill.immutable === 'boolean' && (
                                    <span className="meta-pill" style={{ fontSize: '9.5px' }}>
                                      {skill.immutable ? 'Immutable' : 'Mutable'}
                                    </span>
                                  )}
                                  {typeof skill.size_bytes === 'number' && (
                                    <span className="meta-pill" style={{ fontSize: '9.5px' }}>
                                      {skill.size_bytes} B
                                    </span>
                                  )}
                                  {typeof skill.project_override === 'boolean' && (
                                    <span className="meta-pill" style={{ fontSize: '9.5px' }}>
                                      Override: {skill.project_override ? 'allowed' : 'disabled'}
                                    </span>
                                  )}
                                </div>

                                {skill.sha256 && (
                                  <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                                    SHA: {skill.sha256.substring(0, 20)}…
                                  </div>
                                )}
                              </div>
                              <ArrowRight size={13} color="var(--muted)" style={{ flexShrink: 0, marginLeft: '8px' }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* TAB 2: Governance & RBAC */}
                {activeTab === 'governance' && (
                  <>
                    {/* Server Resolution Notice */}
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        background: selectedCap.is_authorized !== false ? 'rgba(91, 192, 158, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                        border: `1px solid ${selectedCap.is_authorized !== false ? 'var(--acc-teal)' : 'var(--acc-rose)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {selectedCap.is_authorized !== false ? (
                          <ShieldCheck size={20} color="var(--acc-teal)" />
                        ) : (
                          <ShieldAlert size={20} color="var(--acc-rose)" />
                        )}
                        <div>
                          <b style={{ fontSize: '13px', color: 'var(--tx)' }}>
                            {selectedCap.is_authorized !== false ? 'Server Evaluated: Authorized' : 'Server Evaluated: Unauthorized'}
                          </b>
                          <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                            {selectedCap.is_authorized !== false
                              ? 'Principal meets all server-side entitlement checks.'
                              : selectedCap.rejection_reason || 'Principal lacks declared allowed roles or project membership.'}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', textAlign: 'right' }}>
                        <span style={{ color: 'var(--muted)' }}>Principal: </span>
                        <b>{principal?.subject || 'unauthenticated'}</b>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>Roles: </span>
                        <b>{(principal?.roles || []).join(', ') || 'none'}</b>
                      </div>
                    </div>

                    {/* Entitlements Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="card" style={{ padding: '14px', background: 'var(--card-subtle)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          <Lock size={14} color="var(--acc-rose)" />
                          <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                            Role Entitlements
                          </h4>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>
                          Minimum Role Required:
                          <div style={{ marginTop: '3px' }}>
                            <span className="meta-pill" style={{ fontSize: '11px', color: 'var(--tx)' }}>
                              {selectedCap.permissions?.minimum_role || 'PUBLIC'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          Explicit Allowed Roles:
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {(selectedCap.permissions?.allowed_roles || []).map(r => (
                              <span key={r} className="badge badge-active" style={{ fontSize: '10px' }}>
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="card" style={{ padding: '14px', background: 'var(--card-subtle)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          <ShieldCheck size={14} color="var(--acc-teal)" />
                          <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                            Declared Action Permissions
                          </h4>
                        </div>
                        {(selectedCap.permissions?.allowed_actions || []).length === 0 ? (
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>No actions declared</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {(selectedCap.permissions?.allowed_actions || []).map(act => (
                              <code key={act} style={{ fontSize: '11px', padding: '3px 6px', background: 'var(--card)', borderRadius: '4px', border: '1px solid var(--line)' }}>
                                {act}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Declarative Safety Profile */}
                    <div className="card" style={{ padding: '16px', background: 'var(--card-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <ShieldAlert size={14} color="var(--acc-amber)" />
                        <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                          Declarative Safety Profile
                        </h4>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                        <div style={{ padding: '10px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block' }}>Tool Mutations</span>
                          <b style={{ fontSize: '12px', color: 'var(--acc-teal)' }}>forbidden</b>
                        </div>
                        <div style={{ padding: '10px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block' }}>PII Access Policy</span>
                          <b style={{ fontSize: '12px', color: 'var(--tx)' }}>project_scoped</b>
                        </div>
                        <div style={{ padding: '10px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block' }}>Raw Payload Access</span>
                          <b style={{ fontSize: '12px', color: 'var(--tx)' }}>restricted</b>
                        </div>
                        <div style={{ padding: '10px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block' }}>External Network</span>
                          <b style={{ fontSize: '12px', color: 'var(--tx)' }}>connector_allowlist</b>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* TAB 3: Stage Model Pipeline */}
                {activeTab === 'model' && (
                  <>
                    <div style={{ padding: '12px 16px', background: 'var(--card-subtle)', borderRadius: '8px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Assigned Model Profile:</span>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--acc)' }}>
                          {selectedCap.model_profile || 'Default'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {config?.model_profiles?.profiles?.[selectedCap.model_profile || '']?.tool_call_limit && (
                          <span className="meta-pill" style={{ fontSize: '11px' }}>
                            Tool Call Limit: <b>{String(config.model_profiles.profiles[selectedCap.model_profile || ''].tool_call_limit)}</b>
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: '11px', padding: '4px 10px' }}
                          onClick={() => {
                            if (selectedCap.model_profile) {
                              setActiveProfileKey(selectedCap.model_profile);
                            }
                            setViewMode('profiles');
                          }}
                        >
                          View in Platform Matrix →
                        </button>
                      </div>
                    </div>

                    <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: '8px' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Workflow Stage</th>
                            <th>Model Name</th>
                            <th>Thinking Level</th>
                            <th>Max Output Tokens</th>
                            <th>Temperature</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {capProfileStages.map(row => (
                            <tr key={row.stage}>
                              <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{row.stage}</td>
                              <td><code style={{ fontSize: '12px', color: 'var(--tx)' }}>{row.model}</code></td>
                              <td><span className="meta-pill">{row.thinking}</span></td>
                              <td>{row.maxOutput}</td>
                              <td>{row.temperature}</td>
                              <td>
                                <span className={`badge ${row.enabled ? 'badge-active' : 'badge-neutral'}`} style={{ fontSize: '10px' }}>
                                  {row.enabled ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!capProfileStages.length && (
                        <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
                          <ShieldCheck size={18} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
                          No stage configuration mapped for profile '{selectedCap.model_profile}'.
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* TAB 4: Server Contract */}
                {activeTab === 'manifest' && (
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                        Exact contract from <code>/api/v1/capabilities?all=true</code>
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleCopyManifest}
                        style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        {copied ? <Check size={12} color="var(--acc3)" /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '14px',
                      background: 'var(--bg)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--tx)',
                      maxHeight: '400px',
                      overflowY: 'auto',
                      lineHeight: 1.4,
                    }}>
                      {JSON.stringify(selectedCap, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </article>
          )}
        </div>
      )}

      {/* VIEW 2: DEDICATED MODEL PROFILES MATRIX VIEW */}
      {viewMode === 'profiles' && (
        <section className="model-profiles-view" aria-label="Platform Model Profiles Matrix">
          <div className="model-profiles-card">
            {/* Header */}
            <div className="model-profiles-header">
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--tx)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders size={16} color="var(--acc)" />
                  Platform Model Profiles Matrix
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Configured in <code>blob_local/platform/config/model_profiles.yaml</code>
                </span>
              </div>

              {/* Switcher Buttons */}
              <div className="model-profiles-switcher">
                {Object.keys(config?.model_profiles?.profiles || {}).map(profileKey => (
                  <button
                    type="button"
                    key={profileKey}
                    onClick={() => setActiveProfileKey(profileKey)}
                    className={`btn ${activeProfileKey === profileKey ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '11.5px', padding: '5px 12px', height: '30px' }}
                  >
                    {profileKey}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Profile Strip */}
            <div className="model-profiles-strip">
              <span>
                Active Profile: <b style={{ color: 'var(--acc)' }}>{activeProfileKey}</b>
              </span>
              {config?.model_profiles?.profiles?.[activeProfileKey]?.tool_call_limit && (
                <span>
                  Tool Call Limit: <b>{String(config.model_profiles.profiles[activeProfileKey].tool_call_limit)}</b>
                </span>
              )}
              <span>
                Workflows using this profile: <b>{workflowsForActiveProfile.length}</b>
              </span>
              <span style={{ color: 'var(--muted)', marginLeft: 'auto', fontSize: '11px' }}>
                Updates require server reload
              </span>
            </div>

            {/* Stage Table */}
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Execution Stage</th>
                    <th>Assigned Gemini Model</th>
                    <th>Thinking Level</th>
                    <th>Max Output Limit</th>
                    <th>Temperature</th>
                    <th>Stage Status</th>
                  </tr>
                </thead>
                <tbody>
                  {globalProfileRows.map(p => (
                    <tr key={p.stage}>
                      <td style={{ fontWeight: 650, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                        {p.stage}
                      </td>
                      <td>
                        <code style={{ fontSize: '12px', color: 'var(--tx)' }}>{p.model}</code>
                      </td>
                      <td>
                        <span className="meta-pill">{p.thinking}</span>
                      </td>
                      <td>{p.maxOutput}</td>
                      <td>{p.temperature}</td>
                      <td>
                        <span className={`badge ${p.enabled ? 'badge-active' : 'badge-neutral'}`} style={{ fontSize: '10px' }}>
                          {p.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!globalProfileRows.length && (
                <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
                  <ShieldCheck size={16} /> No model stage profile matrix reported for {activeProfileKey}.
                </div>
              )}
            </div>

            {/* Execution Limits Grid */}
            {config?.execution && (
              <div style={{ borderTop: '1px solid var(--line)' }}>
                <div style={{ padding: '12px 20px 0', fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                  Platform Execution Limits
                </div>
                <div className="limits-grid">
                  <div className="limit-tile">
                    <div className="limit-tile-label">Run Timeout</div>
                    <div className="limit-tile-value">{config.execution.run_timeout_seconds}s</div>
                  </div>
                  <div className="limit-tile">
                    <div className="limit-tile-label">Max Concurrent Runs</div>
                    <div className="limit-tile-value">{config.execution.max_concurrent_runs}</div>
                  </div>
                  <div className="limit-tile">
                    <div className="limit-tile-label">Max LLM Calls / Run</div>
                    <div className="limit-tile-value">{config.execution.max_llm_calls}</div>
                  </div>
                  <div className="limit-tile">
                    <div className="limit-tile-label">Max Context Chars</div>
                    <div className="limit-tile-value">{config.execution.max_context_chars?.toLocaleString()}</div>
                  </div>
                  <div className="limit-tile">
                    <div className="limit-tile-label">Retention Period</div>
                    <div className="limit-tile-value">{config.execution.retention_days} days</div>
                  </div>
                </div>
              </div>
            )}

            {/* Workflows using this profile */}
            {workflowsForActiveProfile.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', padding: '16px 20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '10px' }}>
                  Workflows Assigned to '{activeProfileKey}' ({workflowsForActiveProfile.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {workflowsForActiveProfile.map(w => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setSelectedCapId(w.id);
                        setViewMode('workflows');
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '11.5px', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      title={`Open '${w.name || w.id}' in Workflow Inspector`}
                    >
                      <Workflow size={12} color="var(--acc)" />
                      <span>{w.name || w.id}</span>
                      <ArrowRight size={10} color="var(--muted)" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
