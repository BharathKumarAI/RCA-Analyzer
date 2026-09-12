import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, FileText, Plus, RefreshCw, Search, Square, XCircle } from 'lucide-react';
import type { Run } from '../types/api';
import { cancelRun, fetchRun, fetchRunEvidence } from '../services/api';
import type { RunEvidence } from '../services/api';
import '../styles/investigations.css';

interface RunsProps { runs: Run[]; onNewInvestigation: () => void; onRunUpdated?: (run: Run) => void; initialRunId?: string | null }
const ACTIVE_STATUSES: Run['status'][] = ['RUNNING'];
const statusLabel = (status: Run['status']) => status === 'COMPLETED' ? 'Completed' : status === 'RUNNING' ? 'Running' : status === 'PARTIAL' ? 'Partial' : status === 'FAILED' ? 'Failed' : status === 'CANCELLED' ? 'Cancelled' : status === 'BLOCKED' ? 'Blocked' : status === 'SIMULATED' ? 'Simulated' : 'Queued';
const statusIcon = (status: Run['status']) => status === 'COMPLETED' ? <CheckCircle2 size={14} /> : status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED' ? <XCircle size={14} /> : <Clock3 size={14} />;
const formatDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(); };
function formatEvidence(content: string) { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } }

function EvidencePanel({ run }: { run: Run }) {
  const [items, setItems] = useState<RunEvidence[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const requestId = useRef(0);
  const load = useCallback(async () => { const currentRequest = ++requestId.current; setLoading(true); setError(null); try { const nextItems = await fetchRunEvidence(run.id); if (currentRequest === requestId.current) setItems(nextItems); } catch (reason) { if (currentRequest === requestId.current) setError(reason instanceof Error ? reason.message : 'Unable to load evidence.'); } finally { if (currentRequest === requestId.current) setLoading(false); } }, [run.id]);
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load, run.evidence_count]);
  return <section className="investigation-section" aria-labelledby="evidence-heading"><div className="investigation-section-heading"><div><h3 id="evidence-heading">Evidence</h3><p>Recorded artifacts supporting this investigation.</p></div><span className="section-count">{run.evidence_count ?? items.length}</span></div>{loading && <p className="investigation-muted" role="status">Loading evidence…</p>}{error && <div className="investigation-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void load()}>Retry</button></div>}{!loading && !error && !items.length && <p className="investigation-muted">No evidence has been recorded for this investigation.</p>}<div className="evidence-list">{items.map(item => <details className="evidence-item" key={item.evidence_id}><summary><FileText size={14} /><span>{item.source.system}</span><code>{item.evidence_id}</code><ChevronDown size={14} className="evidence-chevron" /></summary><div className="evidence-body"><p>{item.observed_at} · {item.classification}</p><pre>{formatEvidence(item.content_json)}</pre><p className="evidence-hash">Content hash: {item.content_hash}</p></div></details>)}</div></section>;
}

export function Runs({ runs, onNewInvestigation, onRunUpdated, initialRunId }: RunsProps) {
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [selectedId, setSelectedId] = useState<string | null>(initialRunId ?? runs[0]?.id ?? null); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (initialRunId) setSelectedId(initialRunId); }, [initialRunId]);
  useEffect(() => { if (selectedId && runs.some(run => run.id === selectedId)) return; setSelectedId(runs[0]?.id ?? null); }, [runs, selectedId]);
  useEffect(() => { if (!onRunUpdated || !runs.some(run => ACTIVE_STATUSES.includes(run.status))) return; let cancelled = false; let timer: number; const poll = async () => { try { const updated = await Promise.all(runs.filter(run => ACTIVE_STATUSES.includes(run.status)).map(run => fetchRun(run.id))); if (!cancelled) { updated.forEach(onRunUpdated); setError(null); } } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to refresh running investigations.'); } finally { if (!cancelled) timer = window.setTimeout(poll, 5000); } }; timer = window.setTimeout(poll, 5000); return () => { cancelled = true; window.clearTimeout(timer); }; }, [runs, onRunUpdated]);
  async function update(run: Run, shouldCancel = false) { setBusy(run.id); setError(null); try { onRunUpdated?.(shouldCancel ? await cancelRun(run.id) : await fetchRun(run.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update investigation.'); } finally { setBusy(null); } }
  const filtered = runs.filter(run => (filter === 'all' || run.status === filter) && [run.id, run.incident_id, run.capability, run.prompt, run.findings].join(' ').toLowerCase().includes(search.toLowerCase()));
  const selected = filtered.find(run => run.id === selectedId) ?? filtered[0] ?? null; const runningCount = runs.filter(run => ACTIVE_STATUSES.includes(run.status)).length;
  return (
    <div className="view-container investigations-page">
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Investigations & <span>Run Traces</span>
          </h1>
          <p className="hero-lede">
            Trace autonomous SRE incident findings back to cryptographic evidence, stage telemetry, and resolution actions.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{runningCount}</b> Running
            </span>
            <span className="hero-stat-chip">
              <b>{runs.length}</b> Total Records
            </span>
            <span className="hero-stat-chip">
              <b>{runs.reduce((acc, r) => acc + (r.evidence_count || 0), 0)}</b> Evidence Records
            </span>
            {selected && (
              <span className="hero-stat-chip">
                <b>Active:</b> {selected.incident_id || selected.id}
              </span>
            )}
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={onNewInvestigation}>
            <Plus size={14} /> New investigation
          </button>
        </div>
      </section>
      {error && <div className="investigation-error page-error" role="alert"><span>{error}</span></div>}
      <div className="investigations-toolbar">
        <label className="investigations-search">
          <Search size={15} />
          <input type="search" aria-label="Search investigations" placeholder="Search incident, capability, or result" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <select aria-label="Filter investigation status" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {['RUNNING', 'COMPLETED', 'PARTIAL', 'SIMULATED', 'BLOCKED', 'FAILED', 'CANCELLED'].map(status => (
            <option key={status} value={status}>{statusLabel(status as Run['status'])}</option>
          ))}
        </select>
        <span className="investigations-count">{filtered.length} records · {runningCount} running</span>
      </div>
      <div className="investigation-workbench">
        <aside className="investigation-queue" aria-label="Investigation queue">
          <div className="queue-heading">
            <h2>Recent investigations</h2>
            <span>{filtered.length}</span>
          </div>
          {!filtered.length && (
            <div className="investigation-empty">
              <p>{runs.length ? 'No matching investigations.' : 'No investigations yet.'}</p>
              <span>{runs.length ? 'Try another search or status.' : 'Start one to create a persisted record.'}</span>
            </div>
          )}
          <div className="queue-list">
            {filtered.map(run => (
              <button className={`queue-item ${selected?.id === run.id ? 'selected' : ''}`} key={run.id} aria-pressed={selected?.id === run.id} onClick={() => setSelectedId(run.id)}>
                <div className="queue-item-top">
                  <span className={`status status-${run.status.toLowerCase()}`}>{statusIcon(run.status)} {statusLabel(run.status)}</span>
                  <time>{formatDate(run.created_at)}</time>
                </div>
                <strong>{run.incident_id || run.capability}</strong>
                <span>{run.incident_id ? run.capability : run.id}</span>
                <small>{run.evidence_count ?? 0} evidence records</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="investigation-detail" aria-live="polite">
          {!selected ? (
            <div className="detail-empty">
              <FileText size={26} />
              <h2>Select an investigation</h2>
              <p>Choose a record from the queue to inspect its findings and evidence.</p>
            </div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <div className="detail-status">
                    <span className={`status status-${selected.status.toLowerCase()}`}>{statusIcon(selected.status)} {statusLabel(selected.status)}</span>
                    {selected.mode === 'demo' && <span className="demo-note">Demo mode · simulated evidence</span>}
                  </div>
                  <h2>{selected.incident_id || selected.capability}</h2>
                  <p className="detail-id">{selected.capability} · {selected.id}</p>
                </div>
                <div className="detail-actions">
                  <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void update(selected)}>
                    <RefreshCw size={14} /> Refresh
                  </button>
                  {selected.status === 'RUNNING' && (
                    <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void update(selected, true)}>
                      <Square size={13} /> Cancel
                    </button>
                  )}
                </div>
              </div>
              <div className="detail-meta">
                <span>Created {formatDate(selected.created_at)}</span>
                <span>{selected.duration_seconds === undefined ? 'Duration unavailable' : `${selected.duration_seconds.toFixed(1)} seconds`}</span>
                <span>{selected.evidence_count ?? 0} evidence records</span>
              </div>
              {selected.mode === 'demo' && (
                <div className="demo-banner">This is a simulated investigation. Findings and evidence are not a live diagnosis.</div>
              )}
              <section className="investigation-section">
                <div className="investigation-section-heading">
                  <div>
                    <h3>Summary</h3>
                    <p>What the investigation recorded for this run.</p>
                  </div>
                </div>
                <p className="detail-prompt">{selected.findings || (selected.status === 'RUNNING' ? 'Investigation in progress.' : 'No summary was recorded.')}</p>
                {selected.result?.findings.map((finding, index) => (
                  <div className="finding-row" key={`${finding.summary}-${index}`}>
                    <p>{finding.summary}</p>
                    <div>{finding.evidence_ids.map(id => <code key={id}>{id}</code>)}</div>
                  </div>
                ))}
                {!!selected.result?.uncertainties.length && (
                  <div className="detail-list">
                    <h4>Uncertainties</h4>
                    <ul>{selected.result.uncertainties.map(text => <li key={text}>{text}</li>)}</ul>
                  </div>
                )}
                {!!selected.result?.recommended_actions.length && (
                  <div className="detail-list">
                    <h4>Recommended next steps</h4>
                    <ul>{selected.result.recommended_actions.map(text => <li key={text}>{text}</li>)}</ul>
                  </div>
                )}
                <p className="investigation-muted stage-note">Last recorded stage: {selected.stages?.[0]?.name || 'Unavailable'}. The API does not expose a complete timed stage trace.</p>
              </section>
              <EvidencePanel key={selected.id} run={selected} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
