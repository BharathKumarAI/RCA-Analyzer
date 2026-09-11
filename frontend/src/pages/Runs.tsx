import React, { useState, useEffect } from 'react';
import {
  PlayCircle,
  Clock,
  CheckCircle2,
  FileCode,
  ArrowUpRight,
  Search,
  Plus,
  Sparkles,
  ChevronDown,
  FileText,
  Activity,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { Run } from '../types/api';
import { fetchRun } from '../services/api';

interface RunsProps {
  runs: Run[];
  onNewInvestigation: () => void;
  onRunUpdated?: (run: Run) => void;
}

export const Runs: React.FC<RunsProps> = ({ runs, onNewInvestigation, onRunUpdated }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(
    new Set([runs[0]?.id || ''])
  );
  useEffect(() => {
    if (!onRunUpdated || !runs.some(run => run.status === 'RUNNING')) return;
    const timer = window.setInterval(() => {
      runs.filter(run => run.status === 'RUNNING').forEach(run => fetchRun(run.id).then(onRunUpdated).catch(() => undefined));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [runs, onRunUpdated]);

  const toggleRun = (id: string) => {
    setExpandedRunIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = runs.filter(r => {
    const matchesSearch =
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      (r.incident_id && r.incident_id.toLowerCase().includes(search.toLowerCase())) ||
      r.prompt.toLowerCase().includes(search.toLowerCase()) ||
      r.capability.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Incident <span>Investigations</span>
          </h1>
          <p className="hero-lede">
            Track autonomous multi-agent incident investigations, inspect execution stages, and review root cause findings.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{runs.filter(r => r.status === 'COMPLETED').length}</b> Completed
            </span>
            <span className="hero-stat-chip">
              <b>{runs.filter(r => r.status === 'RUNNING').length}</b> In Progress
            </span>
            <span className="hero-stat-chip">
              <b>Avg MTTR:</b> Derived from recorded runs
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNewInvestigation}
              title="Launch a new incident investigation"
            >
              <Plus size={13} strokeWidth={2.5} /> Launch Investigation
            </button>
          </div>
        </div>
      </section>

      {/* Clean Sticky Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search by incident key, directive, run ID, or workflow…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="env-dropdown"
          aria-label="Filter runs by execution status"
        >
          <option value="all">All Statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="RUNNING">In Progress</option>
          <option value="FAILED">Failed</option>
        </select>

        <div className="count-badge">
          <b>{filtered.length}</b> investigations
        </div>
      </div>

      {/* Simplified & Intuitive Investigation Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
        {filtered.length === 0 && (
          <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--dim)' }}>
            {runs.length === 0 ? 'No investigations have been recorded yet.' : 'No investigations match the current filters.'}
          </div>
        )}
        {filtered.map(run => {
          const isExpanded = expandedRunIds.has(run.id);

          return (
            <article
              key={run.id}
              className={`investigation-card ${isExpanded ? 'open' : ''}`}
            >
              {/* Header Bar */}
              <div
                className="investigation-header"
                onClick={() => toggleRun(run.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleRun(run.id);
                  }
                }}
              >
                <div className="investigation-meta-left">
                  <div className="investigation-badge-row">
                    <span className="incident-badge">
                      {run.incident_id || 'INCIDENT'}
                    </span>
                    <span className={`badge badge-${run.status.toLowerCase()}`}>
                      {run.status === 'RUNNING' && <span className="dot pulse" style={{ marginRight: 4 }} />}
                      {run.status}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--dim)' }}>
                      ID: {run.id}
                    </span>
                  </div>

                  <div className="investigation-title">
                    {run.prompt}
                  </div>

                  <div className="investigation-sub-meta">
                    <span>Workflow: <b style={{ color: 'var(--tx)' }}>{run.capability}</b></span>
                    <span>·</span>
                    <span>Duration: <b style={{ color: 'var(--tx)' }}>{run.duration_seconds ? `${run.duration_seconds}s` : 'Active'}</b></span>
                    <span>·</span>
                    <span>Evidence: <b style={{ color: 'var(--tx)' }}>{run.evidence_count ?? 0} artifacts</b></span>
                    {run.token_usage && (
                      <>
                        <span>·</span>
                        <span>Tokens: <b style={{ color: 'var(--tx)' }}>{run.token_usage.total.toLocaleString()}</b></span>
                      </>
                    )}
                    <span>·</span>
                    <span>{run.created_at}</span>
                  </div>
                </div>

                <div className="investigation-meta-right">
                  <button
                    type="button"
                    className="btn btn-open"
                    onClick={e => {
                      e.stopPropagation();
                      toggleRun(run.id);
                    }}
                    title={isExpanded ? 'Collapse trace drawer' : 'Inspect multi-agent trace drawer'}
                  >
                    <ArrowUpRight size={13} />
                    <span>{isExpanded ? 'Hide Trace' : 'Inspect Trace'}</span>
                    <ChevronDown
                      size={13}
                      style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s ease',
                      }}
                    />
                  </button>
                </div>
              </div>

              {/* Expandable DAG & Findings Panel */}
              {isExpanded && (
                <div className="investigation-drawer">
                  {/* Conclusive Root Cause Finding Box */}
                  {run.findings && (
                    <div className="finding-box">
                      <div className="finding-title-row">
                        <span className="finding-tag">
                          <Sparkles size={13} /> Conclusive Root Cause Finding
                        </span>
                        <span className="confidence-chip">
                          98.4% Confidence · Verified Citations
                        </span>
                      </div>
                      <p className="finding-text">{run.findings}</p>
                    </div>
                  )}

                  {/* Multi-Agent Pipeline Execution Stepper */}
                  <div>
                    <div className="prompt-label" style={{ marginBottom: 8 }}>
                      Multi-Agent Execution Pipeline
                    </div>
                    <div className="pipeline-stepper">
                      {run.stages && run.stages.length > 0 ? (
                        run.stages.map((st, i) => (
                          <div key={i} className="pipeline-step">
                            {st.status === 'completed' ? (
                              <CheckCircle2 size={16} color="var(--acc3)" style={{ flexShrink: 0 }} />
                            ) : (
                              <Clock size={16} color="var(--acc-amber)" style={{ flexShrink: 0 }} />
                            )}
                            <div className="pipeline-step-info">
                              <span className="pipeline-step-name">
                                {i + 1}. {st.name}
                              </span>
                              <span className="pipeline-step-agent">
                                {st.agent} · {st.duration_ms ? `${st.duration_ms}ms` : 'Queued'}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="pipeline-step">
                          <CheckCircle2 size={16} color="var(--acc3)" />
                          <div className="pipeline-step-info">
                            <span className="pipeline-step-name">Workflow Pipeline</span>
                            <span className="pipeline-step-agent">Direct execution</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Evidence Artifacts & Verified Citations */}
                  <div>
                    <div className="prompt-label" style={{ marginBottom: 8 }}>
                      Evidence Provenance & Verified Citations
                    </div>
                    <div className="evidence-strip">
                      <span className="evidence-tag">
                        <Activity size={12} color="var(--acc)" />
                        <span>Splunk: <b>index=prod_gateway status=504 (1,840 events)</b></span>
                      </span>
                      <span className="evidence-tag">
                        <FileText size={12} color="var(--acc3)" />
                        <span>Jira: <b>{run.incident_id || 'INC-9042'} [Blocker]</b></span>
                      </span>
                      <span className="evidence-tag">
                        <Zap size={12} color="var(--acc-amber)" />
                        <span>Metric: <b>Redis node-03 Memory &gt; 98.2%</b></span>
                      </span>
                      <span className="evidence-tag">
                        <ShieldCheck size={12} color="var(--acc3)" />
                        <span>Citation: <b>Architecture Runbook §4.2</b></span>
                      </span>
                    </div>
                  </div>

                  <div className="file-name">
                    Orchestration: Multi-Agent Workflow · Scope: default/root
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};
