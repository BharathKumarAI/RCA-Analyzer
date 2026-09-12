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
} from 'lucide-react';
import {
  ApiError,
  fetchCapabilities,
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

type TabKey = 'topology' | 'governance' | 'model' | 'manifest';

interface CapabilitiesProps {
  onNewInvestigation?: (capabilityId: string) => void;
}

export const Capabilities: React.FC<CapabilitiesProps> = ({ onNewInvestigation }) => {
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [connectorsHealth, setConnectorsHealth] = useState<ConnectorsHealthResponse | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCapId, setSelectedCapId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabKey>('topology');
  const [activeProfileKey, setActiveProfileKey] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copied, setCopied] = useState(false);

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

  const handleCopyManifest = async () => {
    if (!selectedCap) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedCap, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError('Unable to copy the manifest. Select and copy the JSON from the manifest tab.'); }
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
    <div className="view-container">
      {/* Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Workflow <span>Capabilities</span> & Execution Topology
          </h1>
          <p className="hero-lede">
            Declarative capability contracts loaded directly from server manifests and evaluated by the ADK capability resolver.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Layers size={13} /> <b>{capabilities.length}</b> Registered Workflows
            </span>
            <span className="hero-stat-chip">
              <Cpu size={13} /> <b>{Object.keys(config?.model_profiles?.profiles || {}).length}</b> Model Profiles
            </span>
            <span className="hero-stat-chip">
              <BookOpen size={13} /> <b>{skills.length}</b> Loaded Skills
            </span>
            <span className="hero-stat-chip">
              <b>Scope:</b> {principal ? `${principal.tenant_id} / ${principal.project_id}` : 'Local Scope'}
            </span>
            <span className="hero-stat-chip">
              <b>Mode:</b> {config?.mode || 'demo'}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadAll()}
              title="Reload from server"
              style={{ padding: '4px 10px', height: '26px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              disabled={loading}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Error alert */}
      {error && (
        <div className="card" style={{ color: 'var(--danger)', borderColor: 'var(--danger)', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadAll()}>
            Retry
          </button>
        </div>
      )}

      {/* Search and Category Filter Toolbar */}
      <div className="toolbar" style={{ marginBottom: '16px' }}>
        <div className="search-box" style={{ flex: 1 }}>
          <Search size={14} />
          <input
            type="search"
            placeholder="Search capability name, ID, category, skill, connector, or action…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn ${selectedCategory === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11.5px', padding: '6px 12px', height: '32px' }}
            onClick={() => setSelectedCategory('all')}
          >
            All Workflows ({capabilities.length})
          </button>
          {availableCategories.map(cat => (
            <button
              type="button"
              key={cat}
              className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11.5px', padding: '6px 12px', height: '32px', textTransform: 'capitalize' }}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <span className="count-badge">
          <b>{filteredCapabilities.length}</b> matches
        </span>
      </div>

      {loading && !capabilities.length ? (
        <div className="card empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px auto', color: 'var(--acc)' }} />
          <h3>Loading capability contracts from server…</h3>
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Evaluating declarative contracts and connector health.</p>
        </div>
      ) : !filteredCapabilities.length ? (
        <div className="card empty-state">
          <Workflow size={24} style={{ margin: '0 auto 12px auto', color: 'var(--muted)' }} />
          <h3>No capabilities match your search query</h3>
          <button type="button" className="btn btn-secondary" onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }} style={{ marginTop: '8px' }}>
            Reset Filters
          </button>
        </div>
      ) : (
        /* Master-Detail Explorer */
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(520px, 2fr)', gap: '16px', alignItems: 'start' }}>
          {/* Left: Capability Directory List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredCapabilities.map(cap => {
              const isSelected = selectedCap?.id === cap.id;
              const isEnabled = cap.enabled !== false;
              const isAuthorized = cap.is_authorized !== false;

              return (
                <div
                  key={cap.id}
                  onClick={() => setSelectedCapId(cap.id)}
                  className="card"
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--acc)' : 'var(--line)',
                    backgroundColor: isSelected ? 'var(--card-active)' : 'var(--card)',
                    boxShadow: isSelected ? 'var(--shadow-hover)' : 'var(--shadow)',
                    transition: 'all 0.15s ease',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className={`badge ${isEnabled ? 'badge-active' : 'badge-neutral'}`} style={{ fontSize: '10.5px' }}>
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {isAuthorized ? (
                        <span className="badge badge-active" style={{ fontSize: '10.5px' }}>
                          Authorized
                        </span>
                      ) : (
                        <span className="badge badge-error" style={{ fontSize: '10.5px' }}>
                          Unauthorized
                        </span>
                      )}
                      <span className="brand-badge" style={{ fontSize: '10.5px' }}>
                        {cap.category || 'workflow'}
                      </span>
                      {cap.version && (
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          v{cap.version}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--tx)' }}>
                    {cap.name || cap.id}
                  </h3>
                  <code style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px' }}>
                    id: {cap.id}
                  </code>

                  <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {cap.description || 'No description in manifest.'}
                  </p>

                  {cap.rejection_reason && (
                    <div style={{ fontSize: '11px', color: 'var(--acc-rose)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldAlert size={12} />
                      {cap.rejection_reason}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
                    {cap.model_profile && (
                      <span className="meta-pill" style={{ fontSize: '10.5px' }}>
                        <Cpu size={10} style={{ marginRight: 3 }} /> {cap.model_profile}
                      </span>
                    )}
                    {(cap.requires?.connectors || []).map(conn => (
                      <span className="meta-pill" key={conn} style={{ fontSize: '10.5px', color: 'var(--acc2)' }}>
                        <Plug size={10} style={{ marginRight: 3 }} /> {conn}
                      </span>
                    ))}
                    {(cap.skills || []).length > 0 && (
                      <span className="meta-pill" style={{ fontSize: '10.5px' }}>
                        <BookOpen size={10} style={{ marginRight: 3 }} /> {cap.skills?.length} {cap.skills?.length === 1 ? 'skill' : 'skills'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Deep Capability Inspector */}
          {selectedCap && (
            <article className="card" style={{ padding: '20px', minHeight: '620px' }}>
              {/* Header */}
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                        {selectedCap.name || selectedCap.id}
                      </h2>
                      <span className={`badge ${selectedCap.enabled !== false ? 'badge-active' : 'badge-neutral'}`}>
                        {selectedCap.enabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="brand-badge">{selectedCap.category || 'workflow'}</span>
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCopyManifest}
                      style={{ fontSize: '11.5px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      {copied ? <Check size={13} color="var(--acc3)" /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy JSON'}
                    </button>
                    {selectedCap.is_authorized !== false && selectedCap.enabled !== false && onNewInvestigation && (
                      <button
                        type="button"
                        onClick={() => onNewInvestigation(selectedCap.id)}
                        className="btn btn-primary"
                        style={{ fontSize: '11.5px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <Play size={12} />
                        Run Investigation
                      </button>
                    )}
                  </div>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--tx)', marginTop: '10px', lineHeight: 1.5, marginBottom: 0 }}>
                  {selectedCap.description || 'No description in manifest.'}
                </p>

                {selectedCap.rejection_reason && (
                  <div
                    style={{
                      marginTop: '12px',
                      background: 'rgba(244, 63, 94, 0.08)',
                      border: '1px solid var(--acc-rose)',
                      borderRadius: '6px',
                      padding: '8px 12px',
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

              {/* Navigation Tabs */}
              <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--line)', marginBottom: '16px' }}>
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
                      onClick={() => setActiveTab(tab.key)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        fontSize: '12px',
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? 'var(--tx)' : 'var(--muted)',
                        background: isActive ? 'var(--card-subtle)' : 'transparent',
                        border: 'none',
                        borderBottom: isActive ? '2px solid var(--acc)' : '2px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Icon size={14} color={isActive ? 'var(--acc)' : 'var(--muted)'} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab 1: Bindings & Skills */}
              {activeTab === 'topology' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Connector Dependencies Section */}
                  <div className="card" style={{ padding: '16px', border: '1px solid var(--line)', background: 'var(--card-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <Plug size={16} color="var(--acc2)" />
                      <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                        Connector Dependencies
                      </h4>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      {/* Required Connectors */}
                      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--acc-rose)', textTransform: 'uppercase', marginBottom: '8px' }}>
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
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--acc3)', textTransform: 'uppercase', marginBottom: '8px' }}>
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
                        <BookOpen size={16} color="var(--acc)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                          Bound Platform Skills ({linkedSkills.length})
                        </h4>
                      </div>
                    </div>

                    {linkedSkills.length === 0 ? (
                      <p style={{ color: 'var(--muted)', fontSize: '12px' }}>No domain skills bound to this capability.</p>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                        {linkedSkills.map(skill => (
                          <div
                            key={skill.id}
                            style={{
                              background: 'var(--card)',
                              border: '1px solid var(--line)',
                              borderRadius: '8px',
                              padding: '12px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <strong style={{ fontSize: '13px', color: 'var(--tx)' }}>{skill.name || skill.id}</strong>
                              {skill.status && (
                                <span className="badge badge-active" style={{ fontSize: '10px' }}>
                                  {skill.status}
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                              {typeof skill.immutable === 'boolean' && (
                                <span className="meta-pill" style={{ fontSize: '10px' }}>
                                  {skill.immutable ? 'Immutable' : 'Mutable'}
                                </span>
                              )}
                              {typeof skill.size_bytes === 'number' && (
                                <span className="meta-pill" style={{ fontSize: '10px' }}>
                                  {skill.size_bytes} bytes
                                </span>
                              )}
                              {typeof skill.project_override === 'boolean' && (
                                <span className="meta-pill" style={{ fontSize: '10px' }}>
                                  Project override: {skill.project_override ? 'allowed' : 'disabled'}
                                </span>
                              )}
                            </div>

                            {skill.sha256 && (
                              <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                                SHA: {skill.sha256.substring(0, 24)}…
                              </div>
                            )}

                            {skill.allowed_actions && skill.allowed_actions.length > 0 && (
                              <div style={{ marginTop: '6px', borderTop: '1px solid var(--line)', paddingTop: '6px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Declared Actions:</span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                  {skill.allowed_actions.map(act => (
                                    <code key={act} style={{ fontSize: '10px', padding: '2px 5px', background: 'var(--bg)', borderRadius: '4px' }}>
                                      {act}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 2: Governance & RBAC */}
              {activeTab === 'governance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Server Resolution Notice */}
                  <div
                    style={{
                      background: selectedCap.is_authorized !== false ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                      border: `1px solid ${selectedCap.is_authorized !== false ? 'var(--acc3)' : 'var(--acc-rose)'}`,
                      borderRadius: '8px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {selectedCap.is_authorized !== false ? (
                        <CheckCircle2 size={18} color="var(--acc3)" />
                      ) : (
                        <ShieldAlert size={18} color="var(--acc-rose)" />
                      )}
                      <div>
                        <strong style={{ fontSize: '13px', color: 'var(--tx)' }}>
                          {selectedCap.is_authorized !== false ? 'Server Evaluated: Authorized' : 'Server Evaluated: Denied'}
                        </strong>
                        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                          {selectedCap.rejection_reason || 'Principal meets all server-side entitlement checks.'}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--muted)' }}>
                      <div>Principal: <b>{principal?.subject || 'anonymous'}</b></div>
                      <div>Roles: <b>{(principal?.roles || []).join(', ') || 'none'}</b></div>
                    </div>
                  </div>

                  {/* RBAC Rules Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div className="card" style={{ padding: '16px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <Lock size={15} color="var(--acc)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>Role Entitlements</h4>
                      </div>

                      {selectedCap.permissions?.minimum_role && (
                        <div style={{ marginBottom: '10px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                            Minimum Role Required
                          </span>
                          <span className="badge badge-neutral" style={{ fontSize: '11px', fontWeight: 700 }}>
                            {selectedCap.permissions.minimum_role}
                          </span>
                        </div>
                      )}

                      {selectedCap.permissions?.allowed_roles && (
                        <div>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                            Explicit Allowed Roles
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {selectedCap.permissions.allowed_roles.map(r => (
                              <span key={r} className="badge badge-active" style={{ fontSize: '11px' }}>
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="card" style={{ padding: '16px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <ShieldCheck size={15} color="var(--acc3)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>Declared Action Permissions</h4>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {(selectedCap.permissions?.allowed_actions || []).length === 0 ? (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>No actions declared</span>
                        ) : (
                          (selectedCap.permissions?.allowed_actions || []).map(action => (
                            <code
                              key={action}
                              style={{
                                fontSize: '11px',
                                padding: '4px 8px',
                                background: 'var(--card)',
                                border: '1px solid var(--line)',
                                borderRadius: '4px',
                                color: 'var(--tx)',
                              }}
                            >
                              {action}
                            </code>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Safety Profile */}
                  {selectedCap.safety_profile && (
                    <div className="card" style={{ padding: '16px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <ShieldAlert size={15} color="var(--acc-amber)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>Declarative Safety Profile</h4>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        {selectedCap.safety_profile.tool_mutations && (
                          <div style={{ background: 'var(--card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>Tool Mutations</div>
                            <strong style={{ fontSize: '12.5px', color: selectedCap.safety_profile.tool_mutations === 'forbidden' ? 'var(--acc3)' : 'var(--acc-amber)' }}>
                              {selectedCap.safety_profile.tool_mutations}
                            </strong>
                          </div>
                        )}

                        {selectedCap.safety_profile.pii_access && (
                          <div style={{ background: 'var(--card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>PII Access Policy</div>
                            <strong style={{ fontSize: '12.5px', color: 'var(--tx)' }}>
                              {selectedCap.safety_profile.pii_access}
                            </strong>
                          </div>
                        )}

                        {selectedCap.safety_profile.raw_payload_access && (
                          <div style={{ background: 'var(--card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>Raw Payload Access</div>
                            <strong style={{ fontSize: '12.5px', color: 'var(--tx)' }}>
                              {selectedCap.safety_profile.raw_payload_access}
                            </strong>
                          </div>
                        )}

                        {selectedCap.safety_profile.external_network && (
                          <div style={{ background: 'var(--card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>External Network</div>
                            <strong style={{ fontSize: '12.5px', color: 'var(--tx)' }}>
                              {selectedCap.safety_profile.external_network}
                            </strong>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Model Pipeline */}
              {activeTab === 'model' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-subtle)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Assigned Model Profile</span>
                      <strong style={{ fontSize: '14px', color: 'var(--acc)' }}>
                        {selectedCap.model_profile || '—'}
                      </strong>
                    </div>

                    {config?.model_profiles?.profiles?.[selectedCap.model_profile || '']?.tool_call_limit && (
                      <span className="hero-stat-chip">
                        <b>Tool Call Limit:</b> {String(config.model_profiles.profiles[selectedCap.model_profile || ''].tool_call_limit)}
                      </span>
                    )}
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
                            <td style={{ fontWeight: 650, textTransform: 'capitalize' }}>{row.stage}</td>
                            <td>
                              <code style={{ fontSize: '11.5px', color: 'var(--tx)' }}>{row.model}</code>
                            </td>
                            <td>
                              <span className="meta-pill" style={{ fontSize: '10.5px' }}>
                                {row.thinking}
                              </span>
                            </td>
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
                      <div className="empty-state">
                        <Cpu size={16} /> No stage mapping resolved for profile: {selectedCap.model_profile}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 4: Raw Server Contract */}
              {activeTab === 'manifest' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                      Exact contract from <code>/api/v1/capabilities?all=true</code>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCopyManifest}
                      style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      {copied ? <Check size={12} color="var(--acc3)" /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre
                    style={{
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--tx)',
                      overflowX: 'auto',
                      maxHeight: '520px',
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(selectedCap, null, 2)}
                  </pre>
                </div>
              )}
            </article>
          )}
        </div>
      )}

      {/* Global Model Profiles Matrix Section */}
      <div className="card" style={{ padding: 0, marginTop: '24px' }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--tx)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sliders size={16} color="var(--acc)" />
              Platform Model Profiles Matrix
            </h3>
            <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
              Configured in <code>blob_local/platform/config/model_profiles.yaml</code>
            </span>
          </div>

          {/* Profile Switcher Buttons */}
          <div style={{ display: 'flex', gap: '6px' }}>
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

        {/* Selected Profile Stats Strip */}
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--card-subtle)',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '12px',
          }}
        >
          <span>
            Active Profile: <b style={{ color: 'var(--acc)' }}>{activeProfileKey}</b>
          </span>
          {config?.model_profiles?.profiles?.[activeProfileKey]?.tool_call_limit && (
            <span>
              Tool Call Limit: <b>{String(config.model_profiles.profiles[activeProfileKey].tool_call_limit)}</b>
            </span>
          )}
          <span style={{ color: 'var(--muted)', marginLeft: 'auto', fontSize: '11px' }}>
            Updates require server reload
          </span>
        </div>

        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
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
                    <span className={`badge ${p.enabled ? 'badge-active' : 'badge-neutral'}`}>
                      {p.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!globalProfileRows.length && (
            <div className="empty-state">
              <ShieldCheck size={16} /> No model stage profile matrix reported for {activeProfileKey}.
            </div>
          )}
        </div>
      </div>

      {/* Execution Limits Strip */}
      {config?.execution && (
        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div className="card" style={{ padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Run Timeout</span>
            <b style={{ fontSize: '14px', color: 'var(--tx)' }}>{config.execution.run_timeout_seconds}s</b>
          </div>
          <div className="card" style={{ padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Max Concurrent Runs</span>
            <b style={{ fontSize: '14px', color: 'var(--tx)' }}>{config.execution.max_concurrent_runs}</b>
          </div>
          <div className="card" style={{ padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Max LLM Calls / Run</span>
            <b style={{ fontSize: '14px', color: 'var(--tx)' }}>{config.execution.max_llm_calls}</b>
          </div>
          <div className="card" style={{ padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Max Context Characters</span>
            <b style={{ fontSize: '14px', color: 'var(--tx)' }}>{config.execution.max_context_chars?.toLocaleString()}</b>
          </div>
          <div className="card" style={{ padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Retention Period</span>
            <b style={{ fontSize: '14px', color: 'var(--tx)' }}>{config.execution.retention_days} days</b>
          </div>
        </div>
      )}
    </div>
  );
};
