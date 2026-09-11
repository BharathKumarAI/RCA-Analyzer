import React, { useState } from 'react';
import {
  Bot,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  Sliders,
  FileCode,
  Shield,
  Activity,
  X,
  AlertTriangle,
  ArrowUpRight
} from 'lucide-react';
import { AgentConfiguration } from '../types/api';
import { approveAgent, rejectAgent, submitAgentYaml } from '../services/api';

interface AgentsProps {
  agents: AgentConfiguration[];
  onRefresh: () => void;
}

export const Agents: React.FC<AgentsProps> = ({ agents, onRefresh }) => {
  const [selectedAgent, setSelectedAgent] = useState<AgentConfiguration | null>(null);
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [submitting, setSubmitting] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [yamlContent, setYamlContent] = useState(`name: kubernetes_crashloop_specialist
role: Specialist
description: Specialist agent for reviewing Kubernetes crashloops, node evictions and OOMKilled events.
model: gemini-2.5-flash
temperature: 0.2
thinking_budget: 2048
max_steps: 10
tools:
  - splunk_query_events
permissions:
  - telemetry:read
rag_sources:
  - Kubernetes Runbooks
instruction: >
  Analyze pod crashloops, query container exit codes, and isolate memory leak signatures.`);

  const togglePrompt = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPromptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.prompt.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitAgentYaml(yamlContent);
      setIsRegisterOpen(false);
      onRefresh();
    } catch (error) {
      setReviewReason(error instanceof Error ? error.message : 'Unable to submit configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (agent: AgentConfiguration) => {
    setSubmitting(true);
    try {
      if (!agent.content_hash) throw new Error('This configuration has no review hash. Refresh and try again.');
      await approveAgent(agent.id, agent.content_hash, reviewReason || 'Peer reviewed');
      setSelectedAgent(null);
      onRefresh();
    } catch (error) {
      setReviewReason(error instanceof Error ? error.message : 'Unable to approve configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (agent: AgentConfiguration) => {
    setSubmitting(true);
    try {
      if (!agent.content_hash) throw new Error('This configuration has no review hash. Refresh and try again.');
      await rejectAgent(agent.id, agent.content_hash, reviewReason || 'Policy constraint');
      setSelectedAgent(null);
      onRefresh();
    } catch (error) {
      setReviewReason(error instanceof Error ? error.message : 'Unable to reject configuration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Agent Fleet & <span>Specialists</span>
          </h1>
          <p className="hero-lede">
            Declarative specialist agent configurations, dual-custody review gates, and cryptographic content-hash integrity verification.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{agents.filter(a => a.status === 'active').length}</b> Active Agents
            </span>
            <span className="hero-stat-chip">
              <b>{agents.filter(a => a.status === 'pending').length}</b> Pending Review
            </span>
            <span className="hero-stat-chip">
              <b>Governance:</b> Peer Review Enforced
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsRegisterOpen(true)}
              title="Submit declarative specialist configuration"
            >
              <Plus size={13} strokeWidth={2.5} /> Register Specialist
            </button>
            <button
              type="button"
              className="btn btn-open"
              onClick={onRefresh}
              title="Refresh specialist registry"
            >
              <Activity size={13} /> Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Compact Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            type="search"
            placeholder="Search by name, role, model, or prompt…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="env-dropdown"
        >
          <option value="all">All Agents</option>
          <option value="active">Active Fleet</option>
          <option value="pending">Pending Approval</option>
          <option value="deprecated">Deprecated</option>
        </select>

        <div className="count-badge">
          <b>{filteredAgents.length}</b> agents
        </div>
      </div>

      {/* Compact Fluid Card Grid */}
      <div className="card-list">
        {filteredAgents.map((agent, index) => {
          const isExpanded = expandedPromptIds.has(agent.id);
          const numStr = String(index + 1).padStart(3, '0');

          return (
            <article
              key={agent.id}
              className={`card ${isExpanded ? 'open' : ''}`}
            >
              <div className="card-top">
                <div className="num">{numStr}</div>

                <div className="card-main">
                  <div className="card-title-row">
                    <h2
                      className="card-title"
                      onClick={() => setSelectedAgent(agent)}
                    >
                      {agent.name}
                    </h2>
                    <span className="brand-badge">{agent.role}</span>
                    <span className={`badge badge-${agent.status}`}>
                      {agent.status.toUpperCase()}
                    </span>
                  </div>

                  <p className="card-desc">
                    {agent.description}
                  </p>

                  <div className="card-meta-pills">
                    <span className="meta-pill highlight">{agent.model}</span>
                    <span className="meta-pill">{agent.thinking_budget} tokens</span>
                    <span className="meta-pill highlight">{agent.accuracy}% acc</span>
                    <span className="meta-pill">{agent.avg_latency_sec}s latency</span>
                    <span className="meta-pill">{agent.tools.length} tools</span>
                  </div>
                </div>

                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn-open"
                    onClick={() => setSelectedAgent(agent)}
                    title="Open configuration drawer"
                  >
                    <Sliders size={13} />
                    Inspect
                  </button>

                  <button
                    type="button"
                    className="btn btn-prompt"
                    aria-expanded={isExpanded}
                    onClick={e => togglePrompt(agent.id, e)}
                    title="Toggle inline prompt instructions"
                  >
                    <FileCode size={13} />
                    Prompt
                  </button>
                </div>
              </div>

              {/* Expandable Prompt Drawer */}
              {isExpanded && (
                <div className="prompt-panel">
                  <div className="prompt-label">Autonomous Directive & Persona Prompt</div>
                  <pre className="prompt-text">{agent.prompt}</pre>
                  <div className="file-name">
                    config: {agent.id}.yaml · hash: {agent.content_hash || 'sha256:verified'} · updated: {agent.updated_at}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Drawer: Detailed Agent Inspector & Editor */}
      {selectedAgent && (
        <div className="drawer">
          <div className="drawer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="brand-icon">
                <Bot size={18} />
              </div>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.02em' }}>{selectedAgent.name}</h2>
                <span style={{ fontSize: '10.5px', color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                  {selectedAgent.id} · Role: {selectedAgent.role}
                </span>
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={() => setSelectedAgent(null)}>
              <X size={15} />
            </button>
          </div>

          <div className="drawer-body">
            {selectedAgent.status === 'pending' && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--acc-amber)', fontWeight: 700, fontSize: '12px' }}>
                  <AlertTriangle size={15} />
                  <span>Dual-Custody Peer Review Required</span>
                </div>
                <p style={{ fontSize: '11.5px', color: 'var(--tx)', lineHeight: 1.45 }}>
                  Submitted by <strong>{selectedAgent.author}</strong>. In accordance with platform governance, a peer administrator must review the configuration content hash before this agent can be bound into root workflows.
                </p>
                <div style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>
                  Expected Hash: <code>{selectedAgent.content_hash}</code>
                </div>

                <input
                  type="text"
                  placeholder="Review decision rationale..."
                  value={reviewReason}
                  onChange={e => setReviewReason(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: '11.5px' }}
                />

                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '2px' }}>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleReject(selectedAgent)}
                    disabled={submitting}
                  >
                    <XCircle size={13} /> Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleApprove(selectedAgent)}
                    disabled={submitting}
                  >
                    <CheckCircle size={13} /> Approve & Activate
                  </button>
                </div>
              </div>
            )}

            {/* Model & Thinking Parameters */}
            <div className="card" style={{ padding: '14px' }}>
              <div className="prompt-label" style={{ marginBottom: '8px' }}>
                <Sliders size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Model & Reasoning Configuration
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11.5px' }}>
                <div>
                  <label style={{ color: 'var(--dim)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>Foundation Model</label>
                  <select defaultValue={selectedAgent.model} style={{ width: '100%', padding: '6px 8px' }}>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Reasoning)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Low Latency)</option>
                  </select>
                </div>
                <div>
                  <label style={{ color: 'var(--dim)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>Temperature</label>
                  <input type="number" step="0.05" defaultValue={selectedAgent.temperature} style={{ width: '100%', padding: '6px 8px' }} />
                </div>
                <div>
                  <label style={{ color: 'var(--dim)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>Thinking Budget</label>
                  <input type="number" defaultValue={selectedAgent.thinking_budget} style={{ width: '100%', padding: '6px 8px' }} />
                </div>
                <div>
                  <label style={{ color: 'var(--dim)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>Max Steps</label>
                  <input type="number" defaultValue={selectedAgent.max_steps} style={{ width: '100%', padding: '6px 8px' }} />
                </div>
              </div>
            </div>

            {/* System Persona / Prompt */}
            <div className="card" style={{ padding: '14px' }}>
              <div className="prompt-label" style={{ marginBottom: '8px' }}>
                <FileCode size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                System Instruction & Persona
              </div>
              <textarea
                rows={5}
                defaultValue={selectedAgent.prompt}
                style={{ width: '100%', padding: '10px', fontSize: '12px', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}
              />
            </div>

            {/* Bound Tools */}
            <div className="card" style={{ padding: '14px' }}>
              <div className="prompt-label" style={{ marginBottom: '8px' }}>
                <Shield size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Bound Tools & Connector Scopes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                {selectedAgent.tools.map(tool => (
                  <label key={tool} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>{tool}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Performance Analytics */}
            <div className="card" style={{ padding: '14px' }}>
              <div className="prompt-label" style={{ marginBottom: '8px' }}>
                <Activity size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Reliability & SRE Empirical Metrics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center' }}>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--acc3)', fontFamily: 'var(--font-mono)' }}>{selectedAgent.accuracy}%</div>
                  <div style={{ fontSize: '10px', color: 'var(--dim)', marginTop: '2px' }}>Accuracy</div>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--acc)', fontFamily: 'var(--font-mono)' }}>{selectedAgent.hallucination_rate}%</div>
                  <div style={{ fontSize: '10px', color: 'var(--dim)', marginTop: '2px' }}>Hallucination</div>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{selectedAgent.avg_latency_sec}s</div>
                  <div style={{ fontSize: '10px', color: 'var(--dim)', marginTop: '2px' }}>Mean Latency</div>
                </div>
              </div>
            </div>
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedAgent(null)}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setSelectedAgent(null)}>
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Modal: Register Specialist (YAML) */}
      {isRegisterOpen && (
        <div className="modal-overlay" onClick={() => setIsRegisterOpen(false)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: '2px' }}>Specialist Proposal</div>
                <h2 style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-.02em' }}>Register Agent Configuration</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setIsRegisterOpen(false)}>
                <X size={15} />
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
              Submit a declarative YAML agent specification. The agent definition will be schema-validated, stored by content hash, and placed in the dual-custody approval queue.
            </p>

            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <textarea
                rows={10}
                value={yamlContent}
                onChange={e => setYamlContent(e.target.value)}
                style={{ width: '100%', padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: 1.5 }}
                required
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsRegisterOpen(false)} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Validating...' : 'Submit for Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
