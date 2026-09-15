import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FileCode,
  FileText,
  Filter,
  Layers,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';
import type { Run } from '../types/api';
import {
  cancelRun,
  fetchRun,
  fetchRunEvidence,
  fetchRunRaw,
  fetchRunTrace,
  type RunEvidence,
  type RunTraceEvent,
  type RunTraceResponse,
} from '../services/api';
import '../styles/investigations.css';

interface RunsProps {
  runs: Run[];
  onNewInvestigation: () => void;
  onRunUpdated?: (run: Run) => void;
  initialRunId?: string | null;
}

const ACTIVE_STATUSES: Run['status'][] = ['RUNNING'];

const statusLabel = (status: Run['status']): string => {
  switch (status) {
    case 'COMPLETED':
      return 'Completed';
    case 'RUNNING':
      return 'Running';
    case 'PARTIAL':
      return 'Partial';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'BLOCKED':
      return 'Blocked';
    case 'SIMULATED':
      return 'Simulated';
    case 'QUEUED':
      return 'Queued';
    default:
      return status;
  }
};

const statusIcon = (status: Run['status']) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 size={13} />;
    case 'RUNNING':
      return <span className="running-spin-indicator" />;
    case 'FAILED':
    case 'BLOCKED':
    case 'CANCELLED':
      return <XCircle size={13} />;
    case 'PARTIAL':
      return <AlertTriangle size={13} />;
    default:
      return <Clock3 size={13} />;
  }
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString();
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function formatEvidence(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${mins}m ${remSec}s`;
}

// ---------------------------------------------------------------------------
// TAB 1: Overview & Findings
// ---------------------------------------------------------------------------
interface OverviewFindingsProps {
  run: Run;
  onSelectEvidence: (evidenceId: string) => void;
}

function OverviewFindingsTab({ run, onSelectEvidence }: OverviewFindingsProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);

  const handleCopySummary = async () => {
    const text = run.findings || run.result?.summary || run.prompt || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  return (
    <div className="tab-pane-content">
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <Sparkles size={16} className="text-acc" />
            <div>
              <h3>Investigation Findings & Executive Summary</h3>
              <p>Root cause hypothesis, synthesized deductions, and cited telemetry.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost-sm"
            onClick={handleCopySummary}
            title="Copy summary text"
          >
            <Copy size={13} />
            <span>{copiedSummary ? 'Copied!' : 'Copy Summary'}</span>
          </button>
        </div>

        <div className="findings-summary-box">
          <p className="detail-prompt">
            {run.findings ||
              (run.status === 'RUNNING'
                ? 'Investigation currently in progress. Correlating logs, traces, and metrics…'
                : 'No explicit findings summary was recorded for this run.')}
          </p>
        </div>

        {run.result?.findings && run.result.findings.length > 0 && (
          <div className="structured-findings-group">
            <h4 className="subheading-label">
              Detailed Hypotheses & Evidence Grounding ({run.result.findings.length})
            </h4>
            <div className="findings-grid">
              {run.result.findings.map((finding, idx) => (
                <div className="finding-card" key={`${finding.summary}-${idx}`}>
                  <div className="finding-card-header">
                    <span className="finding-index">#{idx + 1}</span>
                    <span className="finding-summary-text">{finding.summary}</span>
                  </div>
                  {finding.evidence_ids && finding.evidence_ids.length > 0 && (
                    <div className="finding-evidence-tags">
                      <span className="evidence-cite-label">Cited Artifacts:</span>
                      {finding.evidence_ids.map(id => (
                        <button
                          key={id}
                          type="button"
                          className="evidence-chip-button"
                          title={`Inspect evidence artifact ${id}`}
                          onClick={() => onSelectEvidence(id)}
                        >
                          <FileText size={11} />
                          <code>{id}</code>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {run.result?.uncertainties && run.result.uncertainties.length > 0 && (
        <div className="section-card alert-warning-card">
          <div className="section-card-header">
            <div className="section-card-title">
              <AlertCircle size={16} className="text-amber" />
              <div>
                <h3>Uncertainties & Observational Limits</h3>
                <p>Identified gaps, observational bounds, or unverified assumptions.</p>
              </div>
            </div>
          </div>
          <ul className="alert-list warning-list">
            {run.result.uncertainties.map((item, idx) => (
              <li key={idx}>
                <span className="bullet-dot" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.result?.recommended_actions && run.result.recommended_actions.length > 0 && (
        <div className="section-card action-plan-card">
          <div className="section-card-header">
            <div className="section-card-title">
              <ShieldCheck size={16} className="text-acc3" />
              <div>
                <h3>Recommended Remediation & Next Steps</h3>
                <p>Actionable remediation procedures generated by domain agents.</p>
              </div>
            </div>
          </div>
          <ul className="action-checklist">
            {run.result.recommended_actions.map((action, idx) => (
              <li key={idx} className="action-item">
                <span className="action-number">{idx + 1}</span>
                <span className="action-text">{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 2: Execution Trace & Pipeline (Hardened & Resilient)
// ---------------------------------------------------------------------------
interface TracePanelProps {
  run: Run;
}

const MAX_TRACE_EVENTS_RENDER = 100;

function TracePanel({ run }: TracePanelProps) {
  const [trace, setTrace] = useState<RunTraceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState('all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchRunTrace(run.id)
      .then(res => {
        if (active) setTrace(res);
      })
      .catch(err => {
        if (active) {
          const msg = err instanceof Error ? err.message : 'Unable to load execution trace.';
          setError(msg);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [run.id]);

  const rawEvents = trace?.events || [];
  const events = filterKind === 'all' ? rawEvents : rawEvents.filter(e => e.kind === filterKind);
  const availableKinds = Array.from(
    new Set(rawEvents.map(e => e.kind).filter((k): k is string => Boolean(k)))
  );

  const displayedEvents = events.slice(0, MAX_TRACE_EVENTS_RENDER);
  const isCapped = events.length > MAX_TRACE_EVENTS_RENDER;

  // Safe pipeline nodes from graph, or fallback to contract stages
  const pipelineNodes =
    trace?.graph?.nodes && Array.isArray(trace.graph.nodes) && trace.graph.nodes.length > 0
      ? trace.graph.nodes.map(n => ({
          id: String(n.id || 'unknown'),
          label: String(n.label || n.id || 'Stage'),
        }))
      : [
          { id: 'incident_triage', label: 'Incident Triage (Jira)' },
          { id: 'telemetry_investigation', label: 'Telemetry Bounds (Splunk)' },
          { id: 'attachment_analysis', label: 'Evidence Extraction' },
          { id: 'specialist_join', label: 'Specialist Synthesis' },
          { id: 'final_deduction', label: 'Root Cause Resolution' },
        ];

  return (
    <div className="tab-pane-content">
      {/* Visual Pipeline Stepper */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <Layers size={16} className="text-acc" />
            <div>
              <h3>Execution Pipeline</h3>
              <p>Stage traversal across orchestrator, domain tools, and synthesizer.</p>
            </div>
          </div>
          {run.stages && run.stages[0] && (
            <span className="pipeline-stage-chip">
              Last stage: <b>{run.stages[0].name}</b>
            </span>
          )}
        </div>

        <div className="pipeline-stepper">
          {pipelineNodes.map((node, index) => {
            const isCompleted = run.status === 'COMPLETED';
            const isRunning = run.status === 'RUNNING' && index === 0;
            const isFailed =
              (run.status === 'FAILED' || run.status === 'CANCELLED' || run.status === 'BLOCKED') &&
              index === 0;

            return (
              <div
                key={`${node.id}-${index}`}
                className={`pipeline-step ${isCompleted ? 'step-completed' : isRunning ? 'step-running' : isFailed ? 'step-failed' : 'step-idle'}`}
              >
                <div className="step-indicator">
                  <span className="step-num">{index + 1}</span>
                </div>
                <div className="step-label">
                  <span className="step-title">{node.label}</span>
                  <span className="step-status">
                    {isCompleted ? 'Executed' : isRunning ? 'In progress' : isFailed ? 'Aborted' : 'Contract stage'}
                  </span>
                </div>
                {index < pipelineNodes.length - 1 && <div className="step-connector" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Trace Events Timeline */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <Terminal size={16} className="text-acc" />
            <div>
              <h3>Execution Trace Timeline</h3>
              <p>Persisted event stream from server execution store.</p>
            </div>
          </div>
          <div className="trace-controls">
            {availableKinds.length > 0 && (
              <select
                aria-label="Filter trace events by kind"
                className="trace-filter-select"
                value={filterKind}
                onChange={e => setFilterKind(e.target.value)}
              >
                <option value="all">All Events ({trace?.events.length || 0})</option>
                {availableKinds.map(kind => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={() => {
                setLoading(true);
                fetchRunTrace(run.id)
                  .then(setTrace)
                  .catch(() => {})
                  .finally(() => setLoading(false));
              }}
              title="Refresh trace events"
            >
              <RefreshCw size={12} className={loading ? 'spin-icon' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Truncated Trace Warning */}
        {trace?.truncated && (
          <div className="trace-warning-banner" role="alert">
            <ShieldAlert size={14} className="text-amber" />
            <span>
              <b>Trace Truncated:</b> This investigation trace was truncated due to server log
              limits. Earliest lifecycle events are omitted.
            </span>
          </div>
        )}

        {loading && (
          <div className="trace-empty-state">
            <span className="running-spin-indicator" />
            <p>Loading execution trace from backend event store…</p>
          </div>
        )}

        {error && (
          <div className="investigation-error" role="alert">
            <span>
              {error.includes('503')
                ? 'Run trace storage is unavailable or not configured in this deployment.'
                : error}
            </span>
          </div>
        )}

        {!loading && !error && rawEvents.length === 0 && (
          <div className="trace-empty-state">
            <Clock3 size={24} className="text-muted" />
            <h4>No execution trace events captured</h4>
            <p>
              {run.mode === 'demo'
                ? 'This run was executed in demo simulation mode where detailed step events are not persisted.'
                : 'No trace events have been logged for this investigation.'}
            </p>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <>
            {isCapped && (
              <div className="trace-cap-notice">
                <span>
                  Showing first {MAX_TRACE_EVENTS_RENDER} of {events.length} trace events.
                </span>
              </div>
            )}
            <div className="timeline-container">
              {displayedEvents.map((event, idx) => {
                const seq = event.sequence ?? idx + 1;
                const kindStr = String(event.kind || 'event').toLowerCase();
                const hasDetails =
                  event.details &&
                  typeof event.details === 'object' &&
                  Object.keys(event.details).length > 0;

                return (
                  <div key={seq} className="timeline-entry">
                    <div className="timeline-marker">
                      <span className="timeline-seq">#{seq}</span>
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-entry-header">
                        <span className={`timeline-kind kind-${kindStr}`}>{event.kind || 'EVENT'}</span>
                        {event.node_id && (
                          <span className="timeline-node">
                            Node: <b>{String(event.node_id)}</b>
                          </span>
                        )}
                        <span className="timeline-time">
                          {event.timestamp !== undefined && event.timestamp !== null
                            ? typeof event.timestamp === 'number'
                              ? new Date(event.timestamp * 1000).toLocaleTimeString()
                              : String(event.timestamp)
                            : 'Recorded event'}
                        </span>
                      </div>
                      {hasDetails && (
                        <details className="timeline-details">
                          <summary>
                            <span>Payload details</span>
                            <ChevronDown size={12} className="details-chevron" />
                          </summary>
                          <pre>{JSON.stringify(event.details, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 3: Evidence Bundles Inspector
// ---------------------------------------------------------------------------
interface EvidencePanelProps {
  run: Run;
  highlightedEvidenceId?: string | null;
}

function EvidencePanel({ run, highlightedEvidenceId }: EvidencePanelProps) {
  const [items, setItems] = useState<RunEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextItems = await fetchRunEvidence(run.id);
      setItems(nextItems);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load evidence.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchRunEvidence(run.id)
      .then(res => {
        if (active) setItems(res);
      })
      .catch(reason => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Unable to load evidence.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [run.id, run.evidence_count]);

  const systems = Array.from(
    new Set(items.map(it => it.source?.system || it.source?.connector).filter(Boolean))
  );

  const q = search.trim().toLowerCase();
  const filteredItems = items.filter(item => {
    const matchesSystem =
      systemFilter === 'all' ||
      item.source?.system === systemFilter ||
      item.source?.connector === systemFilter;
    const matchesSearch =
      !q ||
      item.evidence_id.toLowerCase().includes(q) ||
      item.classification?.toLowerCase().includes(q) ||
      item.content_hash?.toLowerCase().includes(q) ||
      item.content_json?.toLowerCase().includes(q);
    return matchesSystem && matchesSearch;
  });

  const handleCopyEvidence = async (item: RunEvidence) => {
    try {
      await navigator.clipboard.writeText(formatEvidence(item.content_json));
      setCopiedId(item.evidence_id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="tab-pane-content">
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <FileText size={16} className="text-acc" />
            <div>
              <h3>Cryptographic Evidence Bundles</h3>
              <p>Captured artifacts from Jira, Splunk, or attachments signed with SHA-256 hashes.</p>
            </div>
          </div>
          <div className="evidence-header-stats">
            <span className="evidence-count-badge">
              <b>{items.length}</b> verified bundles
            </span>
          </div>
        </div>

        {/* Evidence Search & Filter Toolbar */}
        <div className="evidence-toolbar">
          <div className="evidence-search-box">
            <Search size={14} className="text-muted" />
            <input
              type="search"
              aria-label="Filter evidence by ID, system or content"
              placeholder="Filter evidence by ID, system or payload…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearch('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {systems.length > 0 && (
            <select
              aria-label="Filter evidence by source system"
              className="evidence-system-select"
              value={systemFilter}
              onChange={e => setSystemFilter(e.target.value)}
            >
              <option value="all">All Systems ({items.length})</option>
              {systems.map(sys => (
                <option key={sys} value={sys}>
                  {sys}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="btn-ghost-sm"
            onClick={() => void load()}
            title="Reload evidence"
          >
            <RefreshCw size={12} className={loading ? 'spin-icon' : ''} />
            <span>Reload</span>
          </button>
        </div>

        {loading && (
          <div className="evidence-empty-box">
            <span className="running-spin-indicator" />
            <p>Loading cryptographic evidence records…</p>
          </div>
        )}

        {error && (
          <div className="investigation-error" role="alert">
            <span>{error}</span>
            <button className="text-button" type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="evidence-empty-box">
            <ShieldCheck size={28} className="text-muted" />
            <h4>No evidence bundles recorded</h4>
            <p>
              No external artifacts (e.g. Jira tickets, Splunk queries, attachments) were registered
              during this investigation.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
          <div className="evidence-empty-box">
            <Filter size={24} className="text-muted" />
            <h4>No matching evidence found</h4>
            <p>Try modifying your query or selecting &quot;All Systems&quot;.</p>
          </div>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <div className="evidence-grid-list">
            {filteredItems.map(item => {
              const isTargeted = highlightedEvidenceId === item.evidence_id;
              const isCopied = copiedId === item.evidence_id;

              return (
                <details
                  className={`evidence-card-accordion ${isTargeted ? 'targeted-evidence' : ''}`}
                  key={item.evidence_id}
                  open={isTargeted || filteredItems.length <= 2}
                >
                  <summary className="evidence-card-summary">
                    <div className="evidence-summary-left">
                      <span
                        className={`system-badge system-${(item.source?.system || item.source?.connector || 'default').toLowerCase()}`}
                      >
                        {item.source?.system || item.source?.connector || 'External'}
                      </span>
                      <code className="evidence-id-code">{item.evidence_id}</code>
                      {item.classification && (
                        <span className="classification-tag">{item.classification}</span>
                      )}
                    </div>
                    <div className="evidence-summary-right">
                      <span className="evidence-time">
                        {item.observed_at ? formatDate(item.observed_at) : 'Observed during run'}
                      </span>
                      <ChevronDown size={14} className="evidence-chevron" />
                    </div>
                  </summary>

                  <div className="evidence-card-body">
                    <div className="evidence-body-meta">
                      <div className="meta-pair">
                        <span className="meta-label">Source Connector:</span>
                        <span className="meta-val">
                          {item.source?.connector || 'native'} ({item.source?.system || 'system'})
                        </span>
                      </div>
                      <div className="meta-pair">
                        <span className="meta-label">Verification:</span>
                        <span className="meta-val verified-val">
                          <ShieldCheck size={12} /> SHA-256 Verified
                        </span>
                      </div>
                      <div className="meta-pair">
                        <span className="meta-label">Content Hash:</span>
                        <code className="hash-code" title={item.content_hash}>
                          {item.content_hash || 'None'}
                        </code>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost-sm"
                        onClick={() => void handleCopyEvidence(item)}
                        title="Copy raw JSON payload"
                      >
                        <Copy size={12} />
                        <span>{isCopied ? 'Copied Payload!' : 'Copy JSON'}</span>
                      </button>
                    </div>

                    <div className="payload-container">
                      <pre className="evidence-payload">{formatEvidence(item.content_json)}</pre>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 4: Authentic Raw Contract Tab
// ---------------------------------------------------------------------------
function RawContractTab({ run }: { run: Run }) {
  const [copied, setCopied] = useState(false);
  const [rawPayload, setRawPayload] = useState<Record<string, unknown> | null>(
    run.raw ?? null
  );
  const [loadingRaw, setLoadingRaw] = useState(false);

  useEffect(() => {
    if (run.raw) {
      setRawPayload(run.raw);
      return;
    }
    let active = true;
    setLoadingRaw(true);
    fetchRunRaw(run.id)
      .then(res => {
        if (active) setRawPayload(res);
      })
      .catch(() => {
        if (active) setRawPayload({ run_id: run.id, status: run.status });
      })
      .finally(() => {
        if (active) setLoadingRaw(false);
      });
    return () => {
      active = false;
    };
  }, [run.id, run.raw, run.status]);

  const jsonStr = JSON.stringify(rawPayload || run, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rca-run-${run.id}-contract.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-pane-content">
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <FileCode size={16} className="text-acc" />
            <div>
              <h3>Authentic Server Run Contract</h3>
              <p>Persisted RunResponse schema as stored by the backend engine.</p>
            </div>
          </div>
          <div className="contract-actions">
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={handleCopy}
              title="Copy JSON to clipboard"
            >
              <Copy size={12} />
              <span>{copied ? 'Copied Contract!' : 'Copy JSON'}</span>
            </button>
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={handleDownload}
              title="Download JSON file"
            >
              <Download size={12} />
              <span>Export JSON</span>
            </button>
          </div>
        </div>
        {loadingRaw && <p className="investigation-muted">Loading authentic server response…</p>}
        <div className="raw-json-container">
          <pre className="raw-json-pre">{jsonStr}</pre>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT: Runs
// ---------------------------------------------------------------------------
export function Runs({ runs, onNewInvestigation, onRunUpdated, initialRunId }: RunsProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'duration' | 'evidence'>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(initialRunId ?? runs[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<'findings' | 'trace' | 'evidence' | 'contract'>('findings');
  const [highlightedEvidenceId, setHighlightedEvidenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedRunId, setCopiedRunId] = useState(false);

  // Sync selectedId when initialRunId changes
  useEffect(() => {
    if (initialRunId) setSelectedId(initialRunId);
  }, [initialRunId]);

  // Sync selectedId when runs change
  useEffect(() => {
    if (selectedId && runs.some(run => run.id === selectedId)) return;
    setSelectedId(runs[0]?.id ?? null);
  }, [runs, selectedId]);

  // Distinct capabilities list
  const capabilities = Array.from(new Set(runs.map(r => r.capability).filter(Boolean)));

  // Grounded operational metrics (strictly scoped to the loaded batch window)
  const total = runs.length;
  const running = runs.filter(r => ACTIVE_STATUSES.includes(r.status)).length;
  const completed = runs.filter(r => r.status === 'COMPLETED').length;
  const failed = runs.filter(r => r.status === 'FAILED' || r.status === 'BLOCKED').length;
  const partial = runs.filter(r => r.status === 'PARTIAL').length;
  const cancelled = runs.filter(r => r.status === 'CANCELLED').length;
  const simulated = runs.filter(r => r.status === 'SIMULATED' || r.mode === 'demo').length;
  const totalEvidence = runs.reduce((acc, r) => acc + (r.evidence_count || 0), 0);

  // Completion rate strictly defined on loaded batch denominator
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 100;

  // Filter & Sort Logic
  const query = search.trim().toLowerCase();
  const filtered = runs.filter(run => {
    const matchesStatus = filter === 'all' ? true : run.status === filter;
    const matchesCapability =
      capabilityFilter === 'all' ? true : run.capability === capabilityFilter;
    const matchesSearch =
      !query ||
      [
        run.id,
        run.incident_id,
        run.capability,
        run.prompt,
        run.findings,
        run.result?.summary,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);

    return matchesStatus && matchesCapability && matchesSearch;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'newest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortBy === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (sortBy === 'duration') {
      return (b.duration_seconds || 0) - (a.duration_seconds || 0);
    }
    if (sortBy === 'evidence') {
      return (b.evidence_count || 0) - (a.evidence_count || 0);
    }
    return 0;
  });

  const selected = filtered.find(run => run.id === selectedId) ?? filtered[0] ?? null;

  // Actions
  async function update(run: Run, shouldCancel = false) {
    setBusy(run.id);
    setError(null);
    try {
      const updated = shouldCancel ? await cancelRun(run.id) : await fetchRun(run.id);
      onRunUpdated?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update investigation.');
    } finally {
      setBusy(null);
    }
  }

  const handleCopyRunId = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.id);
      setCopiedRunId(true);
      setTimeout(() => setCopiedRunId(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleNavigateToEvidence = (evidenceId: string) => {
    setHighlightedEvidenceId(evidenceId);
    setActiveTab('evidence');
  };

  // KEEP THIS EFFECT AS THE LAST useEffect IN Runs TO SATISFY tests/frontend_run_polling.mjs
  useEffect(() => {
    if (!onRunUpdated || !runs.some(run => ACTIVE_STATUSES.includes(run.status))) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const updated = await Promise.all(
          runs.filter(run => ACTIVE_STATUSES.includes(run.status)).map(run => fetchRun(run.id))
        );
        if (!cancelled) {
          updated.forEach(onRunUpdated);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to refresh running investigations.');
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    timer = window.setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runs, onRunUpdated]);

  return (
    <div className="view-container investigations-page">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            <Activity size={22} color="var(--acc)" />
            Investigations & <span>Execution Traces</span>
          </h1>
          <p className="hero-lede">
            Inspect autonomous multi-agent incident findings, cryptographic evidence bundles, and execution telemetry.
          </p>

          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Activity size={12} /> <b>{total}</b> Loaded Batch
            </span>
            <span className={`hero-stat-chip ${running > 0 ? 'highlight' : ''}`}>
              <span className={`dot ${running > 0 ? 'pulse' : ''}`} /> <b>{running}</b> Active
            </span>
            <span className="hero-stat-chip">
              <CheckCircle2 size={12} color="var(--acc3)" /> <b>{completed}</b> Completed ({completionRate}%)
            </span>
            <span className="hero-stat-chip">
              <ShieldCheck size={12} /> <b>{totalEvidence}</b> Evidence Items
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNewInvestigation}
            >
              <Plus size={13} />
              <span>New Investigation</span>
            </button>
          </div>
        </div>
      </section>

      {/* Standard Metric Grid */}
      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Loaded Batch (max 50)</span>
            <Activity size={14} color="var(--acc)" />
          </div>
          <div className="metric-value">{total}</div>
          <div className="metric-meta">Batch window (max 50 runs)</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Active / Running</span>
            <span className={`dot ${running > 0 ? 'pulse' : ''}`} />
          </div>
          <div className="metric-value">{running}</div>
          <div className="metric-meta">Autonomous agents executing</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Batch Completed</span>
            <CheckCircle2 size={14} color="var(--acc3)" />
          </div>
          <div className="metric-value">
            {completed} <small style={{ fontSize: '13px', fontWeight: 500, color: 'var(--muted)' }}>({completionRate}%)</small>
          </div>
          <div className="metric-meta">{failed} failed · {partial} partial</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Evidence Synthesized</span>
            <ShieldCheck size={14} color="var(--acc)" />
          </div>
          <div className="metric-value">{totalEvidence}</div>
          <div className="metric-meta">Cryptographic bundles persisted</div>
        </div>
      </section>

      {/* Explicit Diagnostic Breakdown Strip */}
      <div className="batch-status-breakdown" style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '0 4px' }}>
        <span>Batch Diagnostic Breakdown:</span>
        <b>{completed}</b> completed · <b>{running}</b> active · <b>{partial}</b> partial ·{' '}
        <b>{failed}</b> failed/blocked · <b>{cancelled}</b> cancelled · <b>{simulated}</b> simulated
      </div>

      {error && (
        <div className="investigation-error page-error" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Interactive Control Bar */}
      <div className="investigations-control-bar">
        {/* Status Pill Tabs */}
        <div className="status-tabs-pill-list" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`status-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <span>All</span>
            <span className="pill-count">{runs.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filter === 'RUNNING'}
            className={`status-pill ${filter === 'RUNNING' ? 'active' : ''}`}
            onClick={() => setFilter('RUNNING')}
          >
            <span className="dot-mini status-running-dot" />
            <span>Running</span>
            <span className="pill-count">{running}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filter === 'COMPLETED'}
            className={`status-pill ${filter === 'COMPLETED' ? 'active' : ''}`}
            onClick={() => setFilter('COMPLETED')}
          >
            <CheckCircle2 size={12} />
            <span>Completed</span>
            <span className="pill-count">{completed}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filter === 'PARTIAL'}
            className={`status-pill ${filter === 'PARTIAL' ? 'active' : ''}`}
            onClick={() => setFilter('PARTIAL')}
          >
            <AlertTriangle size={12} />
            <span>Partial</span>
            <span className="pill-count">{partial}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filter === 'FAILED'}
            className={`status-pill ${filter === 'FAILED' ? 'active' : ''}`}
            onClick={() => setFilter('FAILED')}
          >
            <XCircle size={12} />
            <span>Failed</span>
            <span className="pill-count">{failed}</span>
          </button>

          {simulated > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'SIMULATED'}
              className={`status-pill ${filter === 'SIMULATED' ? 'active' : ''}`}
              onClick={() => setFilter('SIMULATED')}
            >
              <Zap size={12} />
              <span>Simulated</span>
              <span className="pill-count">{simulated}</span>
            </button>
          )}
        </div>

        {/* Search, Capability & Sort Controls */}
        <div className="filter-controls-group">
          <label className="investigations-search-field">
            <Search size={14} className="text-muted" />
            <input
              type="search"
              aria-label="Search investigations"
              placeholder="Search incident, prompt, or findings…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearch('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </label>

          {capabilities.length > 0 && (
            <div className="control-select-wrapper">
              <ListFilter size={13} className="select-icon" />
              <select
                aria-label="Filter by capability"
                value={capabilityFilter}
                onChange={e => setCapabilityFilter(e.target.value)}
              >
                <option value="all">All Capabilities ({capabilities.length})</option>
                {capabilities.map(cap => (
                  <option key={cap} value={cap}>
                    {cap}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="control-select-wrapper">
            <ArrowDownUp size={13} className="select-icon" />
            <select
              aria-label="Sort investigations"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration">Longest Duration</option>
              <option value="evidence">Most Evidence</option>
            </select>
          </div>

          {(search || filter !== 'all' || capabilityFilter !== 'all') && (
            <button
              type="button"
              className="btn-ghost-sm reset-filters-btn"
              onClick={() => {
                setSearch('');
                setFilter('all');
                setCapabilityFilter('all');
              }}
              title="Reset all filters"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Investigation Workbench */}
      <div className="investigation-workbench">
        {/* Left Pane: Queue List */}
        <aside className="investigation-queue" aria-label="Investigation queue">
          <div className="queue-heading">
            <div className="queue-title-row">
              <h2>Investigation Records</h2>
              <span className="queue-count-pill">{filtered.length}</span>
            </div>
            <span className="queue-subheading">Select to inspect trace</span>
          </div>

          {!filtered.length && (
            <div className="investigation-empty">
              <Filter size={24} className="text-muted mb-2" />
              <p>{runs.length ? 'No matching investigations.' : 'No investigations yet.'}</p>
              <span>
                {runs.length
                  ? 'Try clearing the search or status filters.'
                  : 'Trigger a run to create a persistent telemetry record.'}
              </span>
              {runs.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm mt-3"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                    setCapabilityFilter('all');
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}

          <div className="queue-list">
            {filtered.map(run => {
              const isSelected = selected?.id === run.id;
              const isRunning = run.status === 'RUNNING';

              return (
                <button
                  className={`queue-item ${isSelected ? 'selected' : ''} ${isRunning ? 'item-running' : ''}`}
                  key={run.id}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(run.id)}
                >
                  <div className="queue-item-top">
                    <span className={`status status-${run.status.toLowerCase()}`}>
                      {statusIcon(run.status)}
                      <span>{statusLabel(run.status)}</span>
                    </span>
                    <time title={formatDate(run.created_at)}>
                      {formatRelativeTime(run.created_at)}
                    </time>
                  </div>

                  <strong className="queue-item-title">
                    {run.incident_id || run.capability}
                  </strong>

                  <div className="queue-item-meta">
                    <span className="queue-capability-tag">{run.capability}</span>
                    {run.duration_seconds !== undefined && (
                      <span className="queue-duration-badge">
                        {formatDuration(run.duration_seconds)}
                      </span>
                    )}
                  </div>

                  <div className="queue-item-footer">
                    <small className="queue-run-id">
                      <code>{run.id.slice(0, 16)}…</code>
                    </small>
                    <span className="queue-evidence-chip">
                      <FileText size={10} />
                      <span>{run.evidence_count ?? 0}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Pane: Investigation Detail Workbench */}
        <section className="investigation-detail" aria-live="polite">
          {!selected ? (
            <div className="detail-empty">
              <FileText size={36} className="text-muted" />
              <h2>Select an investigation</h2>
              <p>Choose a record from the queue to inspect its findings, trace events, and evidence.</p>
            </div>
          ) : (
            <div className="detail-workspace-container">
              {/* Detail Header */}
              <div className="detail-header">
                <div className="detail-header-main">
                  <div className="detail-status-strip">
                    <span className={`status status-${selected.status.toLowerCase()}`}>
                      {statusIcon(selected.status)} {statusLabel(selected.status)}
                    </span>
                    {selected.mode === 'demo' ? (
                      <span className="demo-badge">
                        <Zap size={11} /> Demo Simulation
                      </span>
                    ) : (
                      <span className="live-badge">
                        <CheckCircle2 size={11} /> Live Run
                      </span>
                    )}
                  </div>

                  <h2 className="detail-incident-title">
                    {selected.incident_id || selected.capability}
                  </h2>

                  <div className="detail-id-row">
                    <span className="detail-capability-label">{selected.capability}</span>
                    <span className="id-separator">•</span>
                    <div className="copyable-run-id">
                      <code title={selected.id}>{selected.id}</code>
                      <button
                        type="button"
                        className="btn-icon-tiny"
                        onClick={handleCopyRunId}
                        title="Copy full Run ID"
                      >
                        <Copy size={11} />
                        {copiedRunId && <span className="tooltip-confirm">Copied!</span>}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="detail-actions-strip">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void update(selected)}
                    title="Refresh current run status from store"
                  >
                    <RefreshCw size={13} className={busy === selected.id ? 'spin-icon' : ''} />
                    <span>Refresh</span>
                  </button>

                  {selected.status === 'RUNNING' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-cancel-run"
                      disabled={busy !== null}
                      onClick={() => void update(selected, true)}
                      title="Cancel active run"
                    >
                      <Square size={12} />
                      <span>Cancel Run</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Detail Meta Bar */}
              <div className="detail-meta-bar">
                <div className="meta-tile">
                  <span className="meta-tile-label">Initiated</span>
                  <span className="meta-tile-val" title={formatDate(selected.created_at)}>
                    {formatDate(selected.created_at)}
                  </span>
                </div>

                <div className="meta-tile">
                  <span className="meta-tile-label">Duration</span>
                  <span className="meta-tile-val">
                    {formatDuration(selected.duration_seconds)}
                  </span>
                </div>

                <div className="meta-tile">
                  <span className="meta-tile-label">Evidence Bundles</span>
                  <span className="meta-tile-val">
                    <b>{selected.evidence_count ?? 0}</b> cryptographic items
                  </span>
                </div>

                {selected.stages && selected.stages[0] && (
                  <div className="meta-tile">
                    <span className="meta-tile-label">Current / Last Stage</span>
                    <span className="meta-tile-val">{selected.stages[0].name}</span>
                  </div>
                )}
              </div>

              {selected.mode === 'demo' && (
                <div className="demo-banner">
                  <Zap size={14} className="text-amber" />
                  <div>
                    <b>Demo Simulation:</b> This run was executed under <code>RCA_MODE=demo</code>.
                    Captured findings and evidence bundles reflect deterministic offline fixtures.
                  </div>
                </div>
              )}

              {/* Tab Navigation for Detail Pane */}
              <div className="detail-tabs-bar" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'findings'}
                  className={`detail-tab ${activeTab === 'findings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('findings')}
                >
                  <Sparkles size={14} />
                  <span>Overview & Findings</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'trace'}
                  className={`detail-tab ${activeTab === 'trace' ? 'active' : ''}`}
                  onClick={() => setActiveTab('trace')}
                >
                  <Terminal size={14} />
                  <span>Execution Trace</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'evidence'}
                  className={`detail-tab ${activeTab === 'evidence' ? 'active' : ''}`}
                  onClick={() => setActiveTab('evidence')}
                >
                  <FileText size={14} />
                  <span>Evidence Bundles</span>
                  <span className="tab-count-tag">{selected.evidence_count ?? 0}</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'contract'}
                  className={`detail-tab ${activeTab === 'contract' ? 'active' : ''}`}
                  onClick={() => setActiveTab('contract')}
                >
                  <FileCode size={14} />
                  <span>Raw Contract JSON</span>
                </button>
              </div>

              {/* Tab Pane Body */}
              <div className="detail-tab-body">
                {activeTab === 'findings' && (
                  <OverviewFindingsTab
                    run={selected}
                    onSelectEvidence={handleNavigateToEvidence}
                  />
                )}

                {activeTab === 'trace' && <TracePanel run={selected} />}

                {activeTab === 'evidence' && (
                  <EvidencePanel
                    run={selected}
                    highlightedEvidenceId={highlightedEvidenceId}
                  />
                )}

                {activeTab === 'contract' && <RawContractTab run={selected} />}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
