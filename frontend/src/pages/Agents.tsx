import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot, Plus, Search, CheckCircle2, XCircle, Sliders, FileCode,
  Shield, Activity, X, AlertTriangle, ArrowUpRight, Copy, Check,
  BookOpen, Layers, Wrench, RefreshCw, Send, Lock, ExternalLink,
  Cpu, Terminal
} from 'lucide-react';
import { AgentConfiguration, Principal, HarnessResponse } from '../types/api';
import { approveAgent, rejectAgent, revokeAgent, submitAgentYaml, fetchHarnessLibrary } from '../services/api';
import type { ActivePage } from '../components/Sidebar';
import '../styles/agents-workspace.css';

interface UnifiedAgentItem extends AgentConfiguration {
  source: 'platform' | 'custom';
  capability?: string;
  stage_model?: string;
}

interface AgentsProps {
  agents: AgentConfiguration[];
  principal: Principal | null;
  onRefresh: () => void;
  onNavigate?: (page: ActivePage) => void;
}

export const Agents: React.FC<AgentsProps> = ({ agents, principal, onRefresh, onNavigate }) => {
  const [harnessData, setHarnessData] = useState<HarnessResponse | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<UnifiedAgentItem | null>(null);
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isAdmin = Boolean(principal?.roles.some(role => role === 'PLATFORM_ADMIN' || role === 'PROJECT_OWNER'));

  // Critical reviewer eligibility check required by test suite
  const canReview = (agent: AgentConfiguration) => isAdmin && principal?.subject !== agent.author && agent.status === 'pending' && Boolean(agent.content_hash) && Boolean(reviewReason.trim()) && !submitting;

  const [yamlContent, setYamlContent] = useState(`id: incident_specialist
version: 1.0.0
name: Incident specialist
description: Investigates incident evidence within the configured capability.
capability: incident_triage
model_profile: balanced-investigation
stage_model: logs
tools:
  - itsm.get_ticket
instruction: Investigate the supplied incident evidence and report bounded findings.`);

  // Load platform catalog agents from harness library to sync across workspaces
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const loadHarness = async () => {
    setCatalogError(null);
    try {
      const res = await fetchHarnessLibrary();
      setHarnessData(res);
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : "Platform agents could not load.");
    }
  };

  useEffect(() => {
    void loadHarness();
  }, []);

  const handleRefreshAll = () => {
    onRefresh();
    void loadHarness();
  };

  // Merge registered agent configurations with platform catalog templates
  const unifiedAgents = useMemo<UnifiedAgentItem[]>(() => {
    const list: UnifiedAgentItem[] = agents.map(a => ({
      ...a,
      source: 'custom' as const,
    }));

    const existingIds = new Set(list.map(a => a.id));

    const platformCatalog = harnessData?.document?.agents || [];

    for (const entry of platformCatalog) {
      if (!existingIds.has(entry.definition.id)) {
        const isEffective = harnessData ? harnessData.effective_agents.includes(entry.definition.id) : true;
        list.push({
          id: entry.definition.id,
          name: entry.definition.name,
          role: 'Specialist',
          description: entry.definition.description || '',
          status: isEffective ? 'active' : ('draft' as any),
          model: entry.definition.model_profile || 'balanced-investigation',
          temperature: 0,
          thinking_budget: 0,
          max_steps: 0,
          tools: entry.definition.tools || [],
          permissions: [],
          rag_sources: [],
          prompt: entry.definition.instruction || '',
          accuracy: 0,
          hallucination_rate: 0,
          avg_latency_sec: 0,
          version: entry.definition.version || '1.0.0',
          updated_at: '',
          author: 'Platform Catalog',
          content_hash: harnessData?.revision || 'platform-catalog',
          source: 'platform' as const,
          capability: entry.definition.capability,
          stage_model: entry.definition.stage_model,
        });
      } else {
        const existing = list.find(a => a.id === entry.definition.id);
        if (existing) {
          if (!existing.capability) existing.capability = entry.definition.capability;
          if (!existing.stage_model) existing.stage_model = entry.definition.stage_model;
        }
      }
    }

    return list;
  }, [agents, harnessData]);

  // Sync candidate from URL hash query
  useEffect(() => {
    const candidate = new URLSearchParams(window.location.hash.split('?')[1]).get('candidate');
    if (candidate) {
      setSelectedAgent(unifiedAgents.find(agent => agent.id === candidate) || null);
    }
  }, [unifiedAgents]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const togglePrompt = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPromptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAgents = useMemo(() => {
    return unifiedAgents.filter(agent => {
      const matchesSearch =
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.prompt.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return agent.status === 'active';
      if (statusFilter === 'pending') return agent.status === 'pending';
      if (statusFilter === 'platform') return agent.source === 'platform';
      if (statusFilter === 'deprecated') return agent.status === 'deprecated';
      return true;
    });
  }, [unifiedAgents, searchQuery, statusFilter]);

  // Fleet metrics
  const metrics = useMemo(() => {
    const total = unifiedAgents.length;
    const active = unifiedAgents.filter(a => a.status === 'active').length;
    const pending = unifiedAgents.filter(a => a.status === 'pending').length;
    const platformCount = unifiedAgents.filter(a => a.source === 'platform').length;
    const deprecated = unifiedAgents.filter(a => a.status === 'deprecated').length;
    return { total, active, pending, platformCount, deprecated };
  }, [unifiedAgents]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await submitAgentYaml(yamlContent);
      setIsRegisterOpen(false);
      handleRefreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to submit configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (agent: UnifiedAgentItem) => {
    if (!canReview(agent)) return;
    setSubmitting(true);
    setActionError(null);
    try {
      if (!agent.content_hash) throw new Error('This configuration has no review hash. Refresh and try again.');
      await approveAgent(agent.id, agent.content_hash, reviewReason.trim());
      setSelectedAgent(null);
      handleRefreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to approve configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (agent: UnifiedAgentItem) => {
    if (!canReview(agent)) return;
    setSubmitting(true);
    setActionError(null);
    try {
      if (!agent.content_hash) throw new Error('This configuration has no review hash. Refresh and try again.');
      await rejectAgent(agent.id, agent.content_hash, reviewReason.trim());
      setSelectedAgent(null);
      handleRefreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to reject configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (agent: UnifiedAgentItem) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await revokeAgent(agent.id, reviewReason || 'Configuration revoked');
      setSelectedAgent(null);
      handleRefreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to revoke configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNavigate = (page: ActivePage) => {
    if (onNavigate) {
      onNavigate(page);
    } else {
      window.location.hash = `#${page}`;
    }
  };

  return (
    <div className="view-container agents-page">
      {catalogError && <div className="notice-banner" role="alert">{catalogError}<button className="btn btn-secondary" onClick={() => void loadHarness()}>Retry platform agents</button></div>}
      {/* Breadcrumbs */}
      <nav className="agents-breadcrumbs" aria-label="Breadcrumb">
        <span>Admin</span>
        <span className="separator">/</span>
        <span>Configuration</span>
        <span className="separator">/</span>
        <span className="active-crumb">Agent Fleet & Specialists</span>
      </nav>

      {/* Hero Banner */}
      <section className="agents-hero">
        <div className="agents-hero-main">
          <h1>
            Agent Fleet & <span>Specialists</span>
          </h1>
          <p className="agents-hero-lede">
            Declarative ADK specialist agent configurations, dual-custody review gates, and cryptographic content-hash integrity verification.
            Fully synced across the platform catalog and scoped project inheritance.
          </p>
          <div className="agents-meta-strip">
            <span className="agents-stat-chip highlight">
              <CheckCircle2 size={13} /> <b>{metrics.active}</b> Active in Workflow
            </span>
            {metrics.pending > 0 && (
              <span className="agents-stat-chip amber">
                <AlertTriangle size={13} /> <b>{metrics.pending}</b> Pending Review
              </span>
            )}
            <span className="agents-stat-chip">
              <Shield size={13} /> Dual-Custody Review Enforced
            </span>
            {harnessData?.revision && (
              <span
                className="agents-stat-chip interactive"
                onClick={() => copyToClipboard(harnessData.revision, 'hash_hero')}
                title="Click to copy catalog revision SHA-256"
              >
                {copiedKey === 'hash_hero' ? <Check size={12} style={{ color: 'var(--acc3)' }} /> : <Copy size={12} />}
                Revision: <code>{harnessData.revision.slice(0, 16)}…</code>
              </span>
            )}
          </div>
        </div>

        <div className="agents-hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setActionError(null); setReviewReason(''); setIsRegisterOpen(true); }}
            title="Submit declarative specialist configuration"
          >
            <Plus size={13} strokeWidth={2.5} /> Register Specialist
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefreshAll}
            title="Refresh specialist registry and harness catalog"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </section>

      {/* Metric Cards Grid */}
      <section className="agents-stats-grid">
        <div className="agents-stat-card">
          <div className="agents-stat-icon purple">
            <Bot size={18} />
          </div>
          <div className="agents-stat-info">
            <span className="agents-stat-label">Total Fleet</span>
            <div className="agents-stat-value-row">
              <span className="agents-stat-value">{metrics.total}</span>
              <span className="agents-stat-subtext">specialists</span>
            </div>
            <span className="agents-stat-subtext" style={{ marginTop: 2 }}>
              {metrics.platformCount} platform · {metrics.total - metrics.platformCount} custom
            </span>
          </div>
        </div>

        <div className="agents-stat-card">
          <div className="agents-stat-icon emerald">
            <CheckCircle2 size={18} />
          </div>
          <div className="agents-stat-info">
            <span className="agents-stat-label">Active in Workflow</span>
            <div className="agents-stat-value-row">
              <span className="agents-stat-value">{metrics.active}</span>
              <span className="agents-stat-subtext">live</span>
            </div>
            <span className="agents-stat-subtext" style={{ marginTop: 2 }}>
              Bound to root incident orchestrator
            </span>
          </div>
        </div>

        <div className="agents-stat-card">
          <div className="agents-stat-icon amber">
            <AlertTriangle size={18} />
          </div>
          <div className="agents-stat-info">
            <span className="agents-stat-label">Review Queue</span>
            <div className="agents-stat-value-row">
              <span className="agents-stat-value">{metrics.pending}</span>
              <span className="agents-stat-subtext">pending</span>
            </div>
            <span className="agents-stat-subtext" style={{ marginTop: 2 }}>
              Dual-custody approval required
            </span>
          </div>
        </div>

        <div className="agents-stat-card">
          <div className="agents-stat-icon indigo">
            <Shield size={18} />
          </div>
          <div className="agents-stat-info">
            <span className="agents-stat-label">Integrity State</span>
            <div className="agents-stat-value-row">
              <span className="agents-stat-value" style={{ fontSize: 16 }}>SHA-256 Verified</span>
            </div>
            <span className="agents-stat-subtext" style={{ marginTop: 2 }}>
              Immutable configuration hash
            </span>
          </div>
        </div>
      </section>

      {/* Controls Panel */}
      <section className="agents-controls-panel">
        <div className="agents-controls-top">
          <div className="agents-search-group">
            <Search size={14} className="search-icon" />
            <input
              type="search"
              className="agents-search-input"
              placeholder="Search by name, ID, capability, or prompt…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              spellCheck={false}
            />
            {searchQuery && (
              <button
                type="button"
                className="harness-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="agents-filter-pills">
            <button
              type="button"
              className={`agents-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              <span>All Specialists</span>
              <span className="agents-filter-count">{metrics.total}</span>
            </button>
            <button
              type="button"
              className={`agents-filter-pill ${statusFilter === 'active' ? 'active' : ''}`}
              onClick={() => setStatusFilter('active')}
            >
              <CheckCircle2 size={11} />
              <span>Active Fleet</span>
              <span className="agents-filter-count">{metrics.active}</span>
            </button>
            <button
              type="button"
              className={`agents-filter-pill ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              <AlertTriangle size={11} />
              <span>Pending Review</span>
              <span className="agents-filter-count">{metrics.pending}</span>
            </button>
            <button
              type="button"
              className={`agents-filter-pill ${statusFilter === 'platform' ? 'active' : ''}`}
              onClick={() => setStatusFilter('platform')}
            >
              <Layers size={11} />
              <span>Platform Templates</span>
              <span className="agents-filter-count">{metrics.platformCount}</span>
            </button>
          </div>

          <div className="agents-quick-shortcuts">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('harness-library')}
              title="Open Harness Library to manage project inheritance"
            >
              <BookOpen size={13} />
              Harness Library
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('tools')}
              title="Open Tools & Connectors"
            >
              <Wrench size={13} />
              Tools
            </button>
          </div>
        </div>
      </section>

      {/* Fluid Cards Grid */}
      <div className="agents-cards-grid">
        {filteredAgents.map(agent => {
          const isExpanded = expandedPromptIds.has(agent.id);
          const isPending = agent.status === 'pending';
          const isActive = agent.status === 'active';
          const isPlatform = agent.source === 'platform';

          return (
            <article
              key={agent.id}
              className={`agents-card status-${agent.status}`}
              onClick={() => {
                setActionError(null);
                setReviewReason('');
                setSelectedAgent(agent);
              }}
            >
              <div className="agents-card-content">
                <header className="agents-card-header">
                  <div className="agents-card-title-group">
                    <div className="agents-card-icon-badge">
                      <Bot size={17} />
                    </div>

                    <div className="agents-card-title-text">
                      <h2 className="agents-card-title">
                        <span>{agent.name}</span>
                        {agent.version && (
                          <span className="agents-card-version-tag">v{agent.version}</span>
                        )}
                      </h2>

                      <button
                        type="button"
                        className="agents-card-id-chip"
                        onClick={e => {
                          e.stopPropagation();
                          copyToClipboard(agent.id, `id_${agent.id}`);
                        }}
                        title="Click to copy agent ID"
                      >
                        <code>{agent.id}</code>
                        {copiedKey === `id_${agent.id}` ? <Check size={10} style={{ color: 'var(--acc3)' }} /> : <Copy size={10} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    {isPending ? (
                      <span className="agents-card-status-badge pending">
                        <AlertTriangle size={10} /> Pending Review
                      </span>
                    ) : isActive ? (
                      <span className="agents-card-status-badge active">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    ) : (
                      <span className="agents-card-status-badge template">
                        <Layers size={10} /> Template
                      </span>
                    )}
                  </div>
                </header>

                <p className="agents-card-desc">
                  {agent.description || 'Specialist agent configured for root ADK workflow execution.'}
                </p>

                <div className="agents-card-meta-list">
                  <span className="agents-card-pill highlight" title="Configured Foundation Model Profile">
                    {agent.model}
                  </span>

                  {agent.capability && (
                    <span className="agents-card-pill capability" title={`Capability Workflow: ${agent.capability}`}>
                      {agent.capability}
                    </span>
                  )}

                  <span className="agents-card-pill" title={`Assigned Domain Tools: ${agent.tools.join(', ')}`}>
                    <Wrench size={10} /> {agent.tools.length} tool{agent.tools.length === 1 ? '' : 's'}
                  </span>

                  <span className="agents-card-pill">
                    {isPlatform ? 'Platform Catalog' : 'Project Specialist'}
                  </span>
                </div>
              </div>

              {/* Expandable In-Card Prompt */}
              {isExpanded && (
                <div className="agents-inline-prompt" onClick={e => e.stopPropagation()}>
                  <div className="agents-inline-prompt-header">
                    <span>Autonomous Directive & System Prompt</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '2px 6px', fontSize: 10 }}
                      onClick={() => copyToClipboard(agent.prompt, `prompt_${agent.id}`)}
                    >
                      {copiedKey === `prompt_${agent.id}` ? <Check size={10} style={{ color: 'var(--acc3)' }} /> : <Copy size={10} />}
                      Copy Prompt
                    </button>
                  </div>
                  <pre className="agents-inline-prompt-text">{agent.prompt}</pre>
                </div>
              )}

              <footer className="agents-card-footer" onClick={e => e.stopPropagation()}>
                <div className="agents-card-footer-author">
                  <span>Author: {agent.author || 'Platform Catalog'}</span>
                </div>

                <div className="agents-card-actions">
                  {isPending && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '4px 9px' }}
                      onClick={() => {
                        setActionError(null);
                        setReviewReason('');
                        setSelectedAgent(agent);
                      }}
                    >
                      <AlertTriangle size={11} /> Review
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '4px 9px' }}
                    onClick={() => {
                      setActionError(null);
                      setReviewReason('');
                      setSelectedAgent(agent);
                    }}
                    title="Open configuration drawer"
                  >
                    <Sliders size={11} /> Inspect
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '4px 9px' }}
                    aria-expanded={isExpanded}
                    onClick={e => togglePrompt(agent.id, e)}
                    title="Toggle inline prompt instructions"
                  >
                    <FileCode size={11} /> Prompt
                  </button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>

      {/* Drawer: Detailed Agent Inspector & Review */}
      {selectedAgent && (
        <div className="harness-drawer-backdrop" onClick={() => setSelectedAgent(null)}>
          <aside className="harness-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="harness-drawer-header">
              <div className="harness-drawer-header-left">
                <div className="agents-card-icon-badge" style={{ width: 38, height: 38 }}>
                  <Bot size={20} />
                </div>
                <div className="harness-drawer-title-wrap">
                  <h2 className="harness-drawer-title">
                    <span>{selectedAgent.name}</span>
                    {selectedAgent.version && (
                      <span className="harness-card-version-tag">v{selectedAgent.version}</span>
                    )}
                  </h2>
                  <div className="harness-drawer-meta">
                    <span>{selectedAgent.role}</span>
                    <span>·</span>
                    <button
                      type="button"
                      className="agents-card-id-chip"
                      onClick={() => copyToClipboard(selectedAgent.id, 'drawer_aid')}
                      title="Click to copy agent ID"
                    >
                      <code>{selectedAgent.id}</code>
                      {copiedKey === 'drawer_aid' ? <Check size={10} style={{ color: 'var(--acc3)' }} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectedAgent.status === 'pending' ? (
                  <span className="agents-card-status-badge pending">
                    <AlertTriangle size={10} /> Pending
                  </span>
                ) : selectedAgent.status === 'active' ? (
                  <span className="agents-card-status-badge active">
                    <CheckCircle2 size={10} /> Active
                  </span>
                ) : (
                  <span className="agents-card-status-badge template">
                    <Layers size={10} /> Template
                  </span>
                )}

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: 6 }}
                  onClick={() => setSelectedAgent(null)}
                  aria-label="Close drawer"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="harness-drawer-body">
              {actionError && <div className="notice-banner red" role="alert">{actionError}</div>}

              {/* Dual-Custody Peer Review Box for Pending Agents */}
              {selectedAgent.status === 'pending' && (
                <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'rgba(154, 103, 0, 0.12)', border: '1px solid rgba(154, 103, 0, 0.3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--acc-amber)', fontWeight: 700, fontSize: '12px' }}>
                    <AlertTriangle size={15} />
                    <span>Dual-Custody Peer Review Required</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--tx)', lineHeight: 1.45, margin: 0 }}>
                    Submitted by <strong>{selectedAgent.author}</strong>. In accordance with platform governance, a peer administrator must review the configuration content hash before this agent can be bound into root workflows.
                  </p>
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--dim)', wordBreak: 'break-all' }}>
                    Expected Hash: <code>{selectedAgent.content_hash}</code>
                  </div>

                  <p style={{ fontSize: '11.5px', color: 'var(--muted)', margin: '4px 0 0' }}>
                    {!isAdmin ? 'Only platform or tenant administrators can review configurations.' : principal?.subject === selectedAgent.author ? 'You authored this configuration. A different administrator must approve or reject it.' : !selectedAgent.content_hash ? 'The review hash is missing. Refresh before reviewing.' : 'Enter a review reason to approve or reject this configuration.'}
                  </p>
                  <input
                    type="text"
                    placeholder="Review decision rationale..."
                    aria-label="Review decision rationale"
                    maxLength={2000}
                    required
                    disabled={submitting || !isAdmin || principal?.subject === selectedAgent.author}
                    value={reviewReason}
                    onChange={e => setReviewReason(e.target.value)}
                    className="harness-form-input"
                    style={{ fontSize: '12px' }}
                  />

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleReject(selectedAgent)}
                      disabled={!canReview(selectedAgent)}
                      style={{ color: 'var(--acc-rose)' }}
                    >
                      <XCircle size={13} /> Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleApprove(selectedAgent)}
                      disabled={!canReview(selectedAgent)}
                    >
                      <CheckCircle2 size={13} /> Approve & Activate
                    </button>
                  </div>
                </div>
              )}

              {/* General Details Section */}
              <section className="harness-form-section">
                <h3 className="harness-form-section-title">
                  <Bot size={13} />
                  <span>Specialist Identity & Scope</span>
                </h3>

                <div className="harness-form-grid">
                  <div className="harness-form-group">
                    <span className="harness-form-label">Identifier</span>
                    <span className="harness-form-value mono">
                      <code>{selectedAgent.id}</code>
                    </span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Catalog Source</span>
                    <span className="harness-form-value">
                      {selectedAgent.source === 'platform' ? 'Platform Catalog' : 'Project Specialist'}
                    </span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Author Subject</span>
                    <span className="harness-form-value">{selectedAgent.author || 'Platform Catalog'}</span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Runtime Version</span>
                    <span className="harness-form-value">v{selectedAgent.version || '1.0.0'}</span>
                  </div>
                </div>

                <div className="harness-form-group" style={{ marginTop: 4 }}>
                  <span className="harness-form-label">Description</span>
                  <span className="harness-form-value" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                    {selectedAgent.description || 'Specialist agent configured for RCA incident investigation.'}
                  </span>
                </div>
              </section>

              {/* Model & Capability Binding */}
              <section className="harness-form-section">
                <h3 className="harness-form-section-title">
                  <Cpu size={13} />
                  <span>Model & Reasoning Configuration</span>
                </h3>

                <div className="harness-form-grid">
                  <div className="harness-form-group">
                    <span className="harness-form-label">Foundation Model Profile</span>
                    <span className="harness-form-value mono">{selectedAgent.model}</span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Capability Workflow</span>
                    <span className="harness-form-value mono">{selectedAgent.capability || 'incident_triage'}</span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Stage Model Profile</span>
                    <span className="harness-form-value mono">{selectedAgent.stage_model || 'configured'}</span>
                  </div>

                  <div className="harness-form-group">
                    <span className="harness-form-label">Workflow Binding</span>
                    <span className="harness-form-value">Native ADK LlmAgent</span>
                  </div>
                </div>
              </section>

              {/* Bound Domain Tools */}
              <section className="harness-form-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 className="harness-form-section-title">
                    <Wrench size={13} />
                    <span>Bound ADK Tools ({selectedAgent.tools.length})</span>
                  </h3>
                  <button
                    type="button"
                    className="harness-nav-link-chip"
                    onClick={() => {
                      setSelectedAgent(null);
                      handleNavigate('tools');
                    }}
                  >
                    <span>Tools & Connectors</span>
                    <ArrowUpRight size={11} />
                  </button>
                </div>

                {selectedAgent.tools.length > 0 ? (
                  <div className="harness-tools-cloud">
                    {selectedAgent.tools.map(tool => (
                      <button
                        key={tool}
                        type="button"
                        className="harness-tool-tag accent"
                        onClick={() => {
                          setSelectedAgent(null);
                          handleNavigate('tools');
                        }}
                        title="Click to view tool specification"
                      >
                        <Wrench size={10} />
                        <span>{tool}</span>
                        <ExternalLink size={9} style={{ opacity: 0.6 }} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--dim)' }}>No domain tools bound to this specialist.</span>
                )}
              </section>

              {/* System Instruction / Prompt */}
              <section className="harness-form-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 className="harness-form-section-title">
                    <Terminal size={13} />
                    <span>System Instruction & Persona</span>
                  </h3>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '2px 7px', fontSize: 11 }}
                    onClick={() => copyToClipboard(selectedAgent.prompt, 'drawer_prompt')}
                  >
                    {copiedKey === 'drawer_prompt' ? <Check size={11} style={{ color: 'var(--acc3)' }} /> : <Copy size={11} />}
                    Copy Prompt
                  </button>
                </div>

                <pre className="harness-prompt-body" style={{ maxHeight: 220 }}>
                  {selectedAgent.prompt}
                </pre>
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                  Agent definitions are immutable after submission. Submit a new YAML revision to adjust instructions.
                </p>
              </section>

              {/* Cryptographic Content Hash & Reviewer */}
              <section className="harness-form-section">
                <h3 className="harness-form-section-title">
                  <Shield size={13} />
                  <span>Cryptographic Content Hash & Governance</span>
                </h3>

                <div className="harness-form-group">
                  <span className="harness-form-label">Content Hash</span>
                  <span className="harness-form-value mono" style={{ fontSize: 11 }}>
                    <code>{selectedAgent.content_hash || 'Unavailable'}</code>
                    {selectedAgent.content_hash && (
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', padding: 0 }}
                        onClick={() => copyToClipboard(selectedAgent.content_hash!, 'chash')}
                        title="Copy hash"
                      >
                        {copiedKey === 'chash' ? <Check size={11} style={{ color: 'var(--acc3)' }} /> : <Copy size={11} />}
                      </button>
                    )}
                  </span>
                </div>

                {selectedAgent.approved_by && (
                  <div className="harness-form-group" style={{ marginTop: 6 }}>
                    <span className="harness-form-label">Approved By</span>
                    <span className="harness-form-value">{selectedAgent.approved_by}</span>
                  </div>
                )}
              </section>
            </div>

            <footer className="harness-drawer-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedAgent(null)}>
                Close
              </button>
              {selectedAgent.status === 'active' && selectedAgent.source === 'custom' && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleRevoke(selectedAgent)}
                  disabled={submitting}
                >
                  Revoke
                </button>
              )}
            </footer>
          </aside>
        </div>
      )}

      {/* Modal: Register Specialist (YAML) */}
      {isRegisterOpen && (
        <div className="harness-modal-backdrop" onClick={() => setIsRegisterOpen(false)}>
          <div className="harness-modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <header className="harness-modal-header">
              <h2>
                <Bot size={18} style={{ color: 'var(--acc)' }} />
                <span>Register Specialist Agent Configuration</span>
              </h2>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: 4 }}
                onClick={() => setIsRegisterOpen(false)}
              >
                <X size={15} />
              </button>
            </header>

            <div className="harness-modal-body">
              <p style={{ fontSize: '12.5px', color: 'var(--muted)', margin: 0, lineHeight: 1.45 }}>
                Submit a declarative YAML agent specification. The agent definition will be schema-validated,
                stored by cryptographic content hash, and placed in the dual-custody peer approval queue.
              </p>

              {actionError && <div className="notice-banner red" role="alert">{actionError}</div>}

              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <textarea
                  rows={12}
                  value={yamlContent}
                  onChange={e => setYamlContent(e.target.value)}
                  className="harness-form-textarea"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', minHeight: 240 }}
                  required
                  spellCheck={false}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setIsRegisterOpen(false)} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Validating…' : 'Submit for Review'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
