import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerMarkdown } from './AnswerMarkdown';
import { ParameterSettingsPanel } from './ParameterSettingsPanel';
import { getSessionGeneration } from '../services/api';
import { controlImprovement, enqueueImprovement, saveImprovementSchedule, type ImprovementJob, type ImprovementSchedule, type JobInput } from '../services/improvement';
import { fetchClosureDashboard, fetchClosureDetail, type ClosureAssessment, type ClosureDashboard, type ClosureDetail } from '../services/knowledge';
import type { Principal } from '../types/api';

const policyNames = ['closure_deviation_threshold', 'closure_min_confidence', 'closure_judge_stage', 'closure_judge_instruction'];
const date = (value: number | null) => value == null ? 'Not recorded' : new Date(value * 1000).toLocaleString();
const score = (value: number | null) => value == null ? 'Not assessed' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Assessment({ value }: { value: ClosureAssessment }) {
  return <section><h4>{value.status === 'ASSESSED' ? 'Model comparison' : 'Insufficient closure evidence'}</h4>
    <p>{value.summary}</p><p>Deviation: {score(value.deviation_score)} · Model confidence: {(value.confidence * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</p>
    {value.discrepancies.length > 0 && <><h4>Differences identified</h4><ul>{value.discrepancies.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    {value.expected_facts.length > 0 && <><h4>Supporting closure facts</h4><ul>{value.expected_facts.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
  </section>;
}

export function KnowledgeClosureMonitor({ principal, jobs, schedules, onRefreshAutomation, onOpenRun, onOpenAlerts }: {
  principal: Principal; jobs: ImprovementJob[]; schedules: ImprovementSchedule[];
  onRefreshAutomation: () => Promise<void>; onOpenRun: (id: string) => void | Promise<void>; onOpenAlerts: () => void;
}) {
  const [dashboard, setDashboard] = useState<ClosureDashboard | null>(null);
  const [detail, setDetail] = useState<ClosureDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [limit, setLimit] = useState(50);
  const [editing, setEditing] = useState<ImprovementSchedule | null>(null);
  const alive = useRef(false);
  const active = useRef(false);
  const loadVersion = useRef(0);
  const detailVersion = useRef(0);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const trackingJobs = jobs.filter(job => job.payload.kind === 'track_closures');
  const trackingSchedules = schedules.filter(schedule => schedule.payload.kind === 'track_closures');
  const completed = trackingJobs.filter(job => job.status === 'SUCCEEDED').map(job => `${job.job_id}:${job.updated_at}`).join('|');
  const lastCompleted = useRef(completed);
  const load = useCallback(async (cursor?: string) => {
    const version = ++loadVersion.current; const generation = getSessionGeneration(); setLoading(true);
    try {
      const next = await fetchClosureDashboard(cursor);
      if (!alive.current || version !== loadVersion.current || generation !== getSessionGeneration()) return;
      setDashboard(previous => cursor && previous ? { ...next, items: [...new Map([...previous.items, ...next.items].map(item => [item.tracking_id, item])).values()] } : next); setError('');
    } catch (cause) { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Closure monitoring could not load. Refresh to retry.'); }
    finally { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadVersion.current++; detailVersion.current++; }; }, [load]);
  useEffect(() => { if (lastCompleted.current !== completed) { lastCompleted.current = completed; void load(); } }, [load, completed]);
  useEffect(() => {
    if (!busy && !name && !editing && limit === 50 && intervalMinutes === 1440) return;
    const guard = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for the monitoring action to finish.' : 'Save or clear the closure schedule form before leaving.'); };
    window.addEventListener('rca:before-navigation', guard); window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', guard); };
  }, [busy, name, editing, limit, intervalMinutes]);
  const choose = async (id: string) => {
    const version = ++detailVersion.current; const generation = getSessionGeneration();
    setSelectedId(id); setDetail(null); setDetailError(''); setDetailLoading(Boolean(id));
    if (!id) return;
    try { const value = await fetchClosureDetail(id); if (alive.current && version === detailVersion.current && generation === getSessionGeneration()) setDetail(value); }
    catch (cause) { if (alive.current && version === detailVersion.current && generation === getSessionGeneration()) setDetailError(cause instanceof Error ? cause.message : 'The recorded comparison could not load. Retry to view it.'); }
    finally { if (alive.current && version === detailVersion.current && generation === getSessionGeneration()) setDetailLoading(false); }
  };
  const perform = async (action: (current: () => boolean) => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice('');
    const generation = getSessionGeneration(); const current = () => alive.current && generation === getSessionGeneration();
    try { await action(current); if (current()) { await onRefreshAutomation(); await load(); } }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Monitoring action failed. Your entries are preserved.'); }
    finally { active.current = false; if (current()) setBusy(false); }
  };
  const input = (): JobInput => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a batch size from 1 to 100.');
    return { kind: 'track_closures', limit, ...(editing?.payload.capability && { capability: editing.payload.capability }) };
  };
  const clear = () => { setName(''); setEditing(null); setIntervalMinutes(1440); setLimit(50); submission.current = null; };
  const openRun = async (id: string) => {
    const generation = getSessionGeneration();
    try { await onOpenRun(id); }
    catch (cause) { if (alive.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'The original run could not load. Try again.'); }
  };

  return <section className="knowledge-closure-monitor">
    <header className="knowledge-header"><div><h3>Investigation closure monitoring</h3><p>Follow recorded Jira investigations until source tickets close, then compare the original triage with recorded closure facts. These are model assessments, not verified accuracy measurements.</p></div><button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={() => void load()}>Refresh closure records</button></header>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}{notice && <p className="knowledge-message is-success" role="status">{notice}</p>}{loading && <p role="status">Loading closure records…</p>}
    {dashboard && <>
      <p>{dashboard.metrics.tracked} tracked investigations · {dashboard.metrics.open} open · {dashboard.metrics.closed} closed · Updated {date(dashboard.generated_at)}</p>
      <div className="improvement-table"><table><caption>Recorded assessment coverage</caption><thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead><tbody>
        <tr><th scope="row">Closed tickets assessed</th><td>{dashboard.metrics.assessed} of {dashboard.metrics.closed}</td></tr>
        <tr><th scope="row">Coverage of closed tickets</th><td>{dashboard.metrics.coverage == null ? 'No closed tickets' : `${(dashboard.metrics.coverage * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}</td></tr>
        <tr><th scope="row">Mean model deviation</th><td>{score(dashboard.metrics.mean_deviation)}</td></tr>
        <tr><th scope="row">Insufficient closure evidence</th><td>{dashboard.metrics.insufficient}</td></tr>
        <tr><th scope="row">Pending assessments / source errors</th><td>{dashboard.metrics.pending} / {dashboard.metrics.errors}</td></tr>
        <tr><th scope="row">Recorded deviation alerts</th><td>{dashboard.metrics.alerts} <button type="button" className="btn btn-secondary" onClick={onOpenAlerts}>Open alerts</button></td></tr>
      </tbody></table></div>
      <p>Deviation ranges from 0 (agreement) to 1 (material contradiction). Alerts require deviation at least {score(dashboard.configuration.deviation_threshold)} and model confidence at least {(dashboard.configuration.min_confidence * 100).toLocaleString()}%. Insufficient evidence receives no deviation score.</p>
      <div className="improvement-table"><table><caption>Tracked investigations</caption><thead><tr><th scope="col">Ticket</th><th scope="col">Source state</th><th scope="col">Last checked</th><th scope="col">Model assessment</th><th scope="col">Review</th></tr></thead><tbody>{dashboard.items.map(item => <tr key={item.tracking_id}><td>{item.ticket_key}</td><td>{item.status}{item.last_error && <p role="note">{item.last_error}</p>}</td><td>{date(item.last_checked_at)}</td><td>{item.latest_judgment ? item.latest_judgment.status === 'ASSESSED' ? `Deviation ${score(item.latest_judgment.deviation_score)}` : 'Insufficient closure evidence' : 'Not assessed'}</td><td><button type="button" className="btn btn-secondary" aria-pressed={selectedId === item.tracking_id} onClick={() => void choose(item.tracking_id)}>Compare</button> <button type="button" className="btn btn-secondary" onClick={() => void openRun(item.source_run_id)}>Original run</button></td></tr>)}</tbody></table></div>
      {!dashboard.items.length && <p>No tracked investigations. Run a closure check to discover eligible live investigations with a recorded source identity.</p>}
      {dashboard.next_cursor && <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load(dashboard.next_cursor!)}>Load more tracked investigations</button>}
    </>}
    {detailLoading && <p role="status">Loading the recorded comparison…</p>}{detailError && <p className="knowledge-message is-error" role="alert">{detailError} <button type="button" className="btn btn-secondary" onClick={() => void choose(selectedId)}>Retry comparison</button></p>}
    {detail && <section className="knowledge-closure-detail"><header className="knowledge-document-header"><h4>{detail.ticket_key}: original triage and closure</h4><button type="button" className="btn btn-secondary" onClick={() => void choose('')}>Close comparison</button></header>
      <div className="docs-content"><h4>Original investigation</h4><AnswerMarkdown text={detail.original.result.summary} /><ul>{detail.original.result.findings.map((finding, index) => <li key={index}>{finding.summary}</li>)}</ul>{detail.original.result.uncertainties.length > 0 && <p>Original uncertainty: {detail.original.result.uncertainties.join(' ')}</p>}<button type="button" className="btn btn-secondary" onClick={() => void openRun(detail.source_run_id)}>Inspect original evidence</button></div>
      {detail.judgments.length === 0 && <p>No recorded closure comparison is available yet.</p>}
      {detail.judgments.map(judgment => <details key={judgment.judgment_id} open={detail.judgments[0] === judgment}><summary>Assessment from {date(judgment.created_at)} · {judgment.model}</summary><Assessment value={judgment.assessment} /><h4>Recorded source closure</h4>{Object.entries(judgment.closure).filter(([, value]) => typeof value === 'string' && value).map(([key, value]) => <div key={key} className="docs-content"><h4>{key.replaceAll('_', ' ')}</h4><AnswerMarkdown text={value as string} /></div>)}<details><summary>Source fields and version hashes</summary><pre className="knowledge-content">{JSON.stringify(judgment.closure, null, 2)}</pre><p className="knowledge-fingerprint">Closure: {judgment.closure_hash}</p><p className="knowledge-fingerprint">Prompt: {judgment.prompt_hash}</p></details></details>)}
    </section>}
    <div className="knowledge-editor"><fieldset disabled={busy || !dashboard}><legend>Closure checks and daily schedule</legend>
      <label>Investigations per batch<input type="number" min={1} max={100} value={limit} onChange={event => setLimit(Number(event.target.value))} /></label>
      {editing?.payload.capability && <p>This schedule remains scoped to capability {editing.payload.capability}.</p>}
      <button type="button" className="btn btn-primary" onClick={() => void perform(async current => { const body = input(); const fingerprint = JSON.stringify(body); if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() }; const job = await enqueueImprovement(body, submission.current!.key); if (current()) { submission.current = null; setNotice(`Closure check queued: ${job.job_id}.`); } })}>Check ticket closures now</button>
      <div className="knowledge-form-row"><label>Schedule name<input maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label><label>Repeat every (minutes)<input type="number" min={5} max={44640} value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} /></label></div><p>1,440 minutes is daily. Checks use the original investigation's recorded source selection and current project permissions.</p>
      <div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={!name.trim() || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 44640} onClick={() => void perform(async current => { await saveImprovementSchedule({ name: name.trim(), interval_seconds: intervalMinutes * 60, enabled: editing?.enabled ?? true, job: input(), ...(editing && { expected_revision: editing.revision }) }, editing?.schedule_id); if (current()) { clear(); setNotice('Closure schedule saved.'); } })}>{editing ? 'Save closure schedule' : 'Create closure schedule'}</button><button type="button" className="btn btn-secondary" onClick={clear}>Clear closure form</button></div>
    </fieldset></div>
    <ul className="improvement-list">{trackingSchedules.map(schedule => <li key={schedule.schedule_id}><div><strong>{schedule.name}</strong><p>{schedule.enabled ? `Next check: ${date(schedule.next_run_at)}` : 'Paused'} · Every {schedule.interval_seconds / 60} minutes</p></div><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={busy || Boolean(name || editing) || limit !== 50 || intervalMinutes !== 1440} onClick={() => { setEditing(schedule); setName(schedule.name); setIntervalMinutes(schedule.interval_seconds / 60); setLimit(schedule.payload.limit ?? 50); }}>Edit</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await saveImprovementSchedule({ name: schedule.name, interval_seconds: schedule.interval_seconds, enabled: !schedule.enabled, expected_revision: schedule.revision, job: schedule.payload }, schedule.schedule_id); })}>{schedule.enabled ? 'Pause' : 'Resume'}</button></div></li>)}</ul>
    <details><summary>Closure job history ({trackingJobs.length})</summary><ul className="improvement-list">{trackingJobs.map(job => <li key={job.job_id}><div><strong>{job.status}</strong><p>{date(job.created_at)} · {job.attempts} attempts</p>{job.error && <p className="knowledge-message is-error">{job.error}</p>}<details><summary>Recorded job details</summary><pre className="knowledge-content">{JSON.stringify(job.result ?? job.payload, null, 2)}</pre></details></div><div className="knowledge-actions">{['QUEUED', 'RUNNING'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy || job.cancel_requested} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'cancel'); })}>Cancel</button>}{['FAILED', 'CANCELLED'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'retry'); })}>Retry</button>}</div></li>)}</ul></details>
    <details><summary>Configure model assessment and alert thresholds</summary><p>These project parameters control the comparison prompt, model stage and alert thresholds. Changing them does not verify an assessment or rewrite recorded history.</p><ParameterSettingsPanel principal={principal} scope="project" tool="knowledge" includeNames={policyNames} /></details>
  </section>;
}
