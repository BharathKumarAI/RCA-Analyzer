import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchKnowledge, getSessionGeneration } from '../services/api';
import { controlImprovement, draftCandidateKnowledge, enqueueImprovement, fetchImprovementCandidate, fetchImprovementCandidates, fetchImprovementJobs, fetchImprovementSchedules, publishCandidateDataset, saveImprovementSchedule, verifyImprovementCandidate, type ImprovementCandidate, type ImprovementCandidateSummary, type ImprovementJob, type ImprovementSchedule, type JobInput } from '../services/improvement';
import type { KnowledgeItem, Principal } from '../types/api';
import type { DatasetItem } from './Optimization';
import '../styles/knowledge.css';

interface Props { principal: Principal; datasets: DatasetItem[]; promptNames: string[]; skillNames: string[]; onDataset: () => void; onReport: (id: string) => void }
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleString();

export function Improvement({ principal, datasets, promptNames, skillNames, onDataset, onReport }: Props) {
  const [jobs, setJobs] = useState<ImprovementJob[]>([]);
  const [schedules, setSchedules] = useState<ImprovementSchedule[]>([]);
  const [candidates, setCandidates] = useState<ImprovementCandidateSummary[]>([]);
  const [selected, setSelected] = useState<ImprovementCandidate | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [kind, setKind] = useState<'prepare_feedback' | 'optimize'>('prepare_feedback');
  const [limit, setLimit] = useState(50);
  const [datasetKey, setDatasetKey] = useState('');
  const [targetKind, setTargetKind] = useState<'prompt' | 'skill'>('prompt');
  const [target, setTarget] = useState('');
  const [scheduleName, setScheduleName] = useState('');
  const [interval, setIntervalMinutes] = useState(60);
  const [editingSchedule, setEditingSchedule] = useState<ImprovementSchedule | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const [outcome, setOutcome] = useState<'FINDINGS' | 'INSUFFICIENT_EVIDENCE' | ''>('');
  const [facts, setFacts] = useState('');
  const [reason, setReason] = useState('');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeCategory, setKnowledgeCategory] = useState('Runbooks');
  const [split, setSplit] = useState<Record<string, 'train' | 'holdout' | ''>>({});
  const [datasetId, setDatasetId] = useState('');
  const [datasetVersion, setDatasetVersion] = useState('');
  const [description, setDescription] = useState('');
  const [corpus, setCorpus] = useState<string[]>([]);
  const active = useRef(false);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const candidateVersion = useRef(0);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const dataset = datasets.find(item => `${item.dataset_id}@${item.version}` === datasetKey);
  const targetNames = targetKind === 'prompt' ? promptNames : skillNames;
  const canVerify = selected && ![selected.author_subject, selected.source_subject].includes(principal.subject);
  const train = candidates.filter(item => split[item.candidate_id] === 'train');
  const holdout = candidates.filter(item => split[item.candidate_id] === 'holdout');
  const chosen = [...train, ...holdout];
  const capability = chosen[0]?.capability;

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const generation = getSessionGeneration();
    try {
      const [nextJobs, nextSchedules, nextCandidates, docs] = await Promise.all([fetchImprovementJobs(), fetchImprovementSchedules(), fetchImprovementCandidates(), fetchKnowledge()]);
      if (!alive.current || version !== loadVersion.current || generation !== getSessionGeneration()) return;
      setJobs(nextJobs); setSchedules(nextSchedules); setCandidates(nextCandidates); setKnowledge(docs); setError('');
    } catch (cause) {
      if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Improvement records could not load. Refresh to try again.');
    } finally { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadVersion.current++; candidateVersion.current++; }; }, [load]);
  const running = jobs.some(job => job.status === 'QUEUED' || job.status === 'RUNNING');
  useEffect(() => {
    if (!running || busy) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [running, busy, load]);
  useEffect(() => {
    if (!busy && !facts && !reason && !description && !scheduleName) return;
    const guard = (event: Event) => { event.preventDefault(); setError('Finish or clear your current changes before leaving this page.'); };
    window.addEventListener('rca:before-navigation', guard); window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', guard); };
  }, [busy, facts, reason, description, scheduleName]);
  const perform = async (action: (current: () => boolean) => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice('');
    const generation = getSessionGeneration();
    const current = () => alive.current && generation === getSessionGeneration();
    try { await action(current); if (current()) await load(); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Action failed. Your entries are preserved.'); }
    finally { active.current = false; if (current()) setBusy(false); }
  };
  const jobInput = (): JobInput => {
    if (kind === 'prepare_feedback') return { kind, limit };
    if (!dataset || !targetNames.includes(target)) throw new Error('Select a registered dataset and configured prompt or skill.');
    return { kind, optimization: { dataset_id: dataset.dataset_id, dataset_version: dataset.version, target_kind: targetKind, target_name: target } };
  };
  const choose = async (id: string) => {
    if (active.current) return;
    const version = ++candidateVersion.current;
    const generation = getSessionGeneration();
    const current = () => alive.current && version === candidateVersion.current && generation === getSessionGeneration();
    setCandidateId(id); setSelected(null); setCandidateError(''); setOutcome(''); setFacts(''); setReason(''); setKnowledgeTitle('');
    setCandidateLoading(Boolean(id));
    if (!id) return;
    try {
      const item = await fetchImprovementCandidate(id);
      if (!current()) return;
      setSelected(item); setOutcome(item.verification?.expected_outcome ?? ''); setFacts(item.verification?.expected_facts.join('\n') ?? '');
    } catch (cause) {
      if (current()) setCandidateError(cause instanceof Error ? cause.message : 'Candidate evidence could not load. Try again.');
    } finally { if (current()) setCandidateLoading(false); }
  };
  const resetSchedule = () => { setEditingSchedule(null); setScheduleName(''); };
  const editableSchedules = schedules.filter(schedule => schedule.payload.kind === 'prepare_feedback' || schedule.payload.kind === 'optimize');

  return <div className="knowledge-page improvement-page">
    <header className="knowledge-header"><div><h2>Continuous improvement</h2><p>Prepare recorded feedback, verify expected outcomes, separate training and holdout cases, then evaluate changes. Activation always requires independent approval.</p></div><button type="button" className="btn btn-secondary" disabled={busy || loading} onClick={() => void load()}>Refresh records</button></header>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}{notice && <p className="knowledge-message is-success" role="status">{notice}</p>}
    {loading && <p role="status">Loading improvement records…</p>}
    <section className="knowledge-editor"><h3>Run or schedule work</h3><fieldset disabled={busy || loading}>
      <div className="knowledge-form-row"><label>Work<select value={kind} onChange={event => setKind(event.target.value as 'prepare_feedback' | 'optimize')}><option value="prepare_feedback">Prepare feedback for review</option><option value="optimize">Evaluate a prompt or skill</option></select></label>{kind === 'prepare_feedback' && <label>Feedback batch limit<input type="number" min={1} max={100} value={limit} onChange={event => setLimit(Number(event.target.value))} /></label>}</div>
      {kind === 'optimize' && <><label>Registered dataset<select value={datasetKey} onChange={event => setDatasetKey(event.target.value)}><option value="">Select a dataset</option>{datasets.map(item => <option key={`${item.dataset_id}@${item.version}`} value={`${item.dataset_id}@${item.version}`}>{item.dataset_id} · {item.version} · {item.purpose}</option>)}</select></label><div className="knowledge-form-row"><label>Target type<select value={targetKind} onChange={event => { setTargetKind(event.target.value as 'prompt' | 'skill'); setTarget(''); }}><option value="prompt">Prompt</option><option value="skill">Skill</option></select></label><label>Target<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Select a target</option>{targetNames.map(name => <option key={name}>{name}</option>)}</select></label></div></>}
      <div className="knowledge-actions"><button type="button" className="btn btn-primary" onClick={() => void perform(async current => {
        const payload = jobInput(); const fingerprint = JSON.stringify(payload);
        if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() };
        const job = await enqueueImprovement(payload, submission.current!.key);
        if (current()) { submission.current = null; setNotice(`Job queued: ${job.job_id}. Progress and any failures appear below.`); }
      })}>Queue job now</button></div>
      <details><summary>{editingSchedule ? 'Edit schedule' : 'Create a recurring schedule'}</summary><div className="knowledge-form-row"><label>Schedule name<input maxLength={128} value={scheduleName} onChange={event => setScheduleName(event.target.value)} /></label><label>Repeat every (minutes)<input type="number" min={5} max={44640} step={1} value={interval} onChange={event => setIntervalMinutes(Number(event.target.value))} /></label></div><p>A scheduled evaluation uses the exact selected dataset version. New feedback requires verification and a new dataset version before it can affect evaluation.</p><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={!scheduleName.trim() || interval < 5 || !Number.isInteger(interval)} onClick={() => void perform(async current => {
        await saveImprovementSchedule({ name: scheduleName.trim(), interval_seconds: interval * 60, enabled: editingSchedule?.enabled ?? true, job: jobInput(), ...(editingSchedule && { expected_revision: editingSchedule.revision }) }, editingSchedule?.schedule_id);
        if (current()) { resetSchedule(); setNotice('Schedule saved. Its author’s current project permissions are checked each time it runs.'); }
      })}>{editingSchedule ? 'Save schedule' : 'Create schedule'}</button><button type="button" className="btn btn-secondary" onClick={resetSchedule}>Clear schedule form</button></div></details>
    </fieldset>
    {editableSchedules.length ? <ul className="improvement-list">{editableSchedules.map(schedule => <li key={schedule.schedule_id}><div><strong>{schedule.name}</strong><p>{schedule.enabled ? `Next run: ${date(schedule.next_run_at)}` : 'Paused'} · Every {schedule.interval_seconds / 60} minutes · {schedule.payload.kind === 'optimize' ? 'Evaluation' : 'Feedback preparation'}</p></div><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditingSchedule(schedule); setScheduleName(schedule.name); setIntervalMinutes(schedule.interval_seconds / 60); setKind(schedule.payload.kind === 'optimize' ? 'optimize' : 'prepare_feedback'); setLimit(schedule.payload.limit ?? 50); const input = schedule.payload.optimization; if (input) { setDatasetKey(`${input.dataset_id}@${input.dataset_version}`); setTargetKind(input.target_kind); setTarget(input.target_name); } }}>Edit</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await saveImprovementSchedule({ name: schedule.name, interval_seconds: schedule.interval_seconds, enabled: !schedule.enabled, job: schedule.payload, expected_revision: schedule.revision }, schedule.schedule_id); })}>{schedule.enabled ? 'Pause' : 'Resume'}</button></div></li>)}</ul> : <p>No recurring schedules.</p>}
    </section>
    <section><h3>Job history</h3>{!jobs.length ? <p>No jobs have been submitted.</p> : <ul className="improvement-list">{jobs.map(job => <li key={job.job_id}><div><strong>{job.payload.kind === 'optimize' ? `Evaluate ${job.payload.optimization?.target_name}` : job.payload.kind === 'capture_knowledge' ? 'Capture project knowledge' : job.payload.kind === 'track_closures' ? 'Track ticket closures' : 'Prepare feedback'}</strong><p>{job.status} · {date(job.created_at)} · {job.attempts} attempts{job.cancel_requested ? ' · Cancellation requested' : ''}</p>{job.error && <p className="knowledge-message is-error">{job.error}</p>}<details><summary>Job details</summary><p>{job.job_id}</p><pre className="knowledge-content">{JSON.stringify(job.result ?? job.payload, null, 2)}</pre></details></div><div className="knowledge-actions">{['QUEUED', 'RUNNING'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy || job.cancel_requested} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'cancel'); })}>Cancel</button>}{['FAILED', 'CANCELLED'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'retry'); })}>Retry</button>}{job.result?.optimization_id && <button type="button" className="btn btn-secondary" onClick={() => onReport(job.result!.optimization_id!)}>Review evaluation</button>}</div></li>)}</ul>}</section>
    <section className="knowledge-editor"><h3>Verify feedback candidates</h3><p>Ratings identify cases to review. Read the captured evidence and record verifiable facts yourself.</p>
      <label>Candidate<select disabled={busy || Boolean(facts || reason)} value={candidateId} onChange={event => void choose(event.target.value)}><option value="">Select a recorded candidate</option>{candidates.map(item => <option key={item.candidate_id} value={item.candidate_id}>{item.incident_id || item.source_run_id} · {item.capability} · {item.status}</option>)}</select></label>
      {candidateLoading && <p role="status">Loading candidate evidence…</p>}
      {candidateError && <div role="alert"><p className="knowledge-message is-error">{candidateError}</p><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void choose(candidateId)}>Retry evidence</button></div>}
      {!candidates.length && <p>Prepare feedback after completed live investigations have received reviews.</p>}
      {selected && <><p>Source run: {selected.source_run_id} · Source author: {selected.source_subject} · Prepared by: {selected.author_subject}</p><details><summary>Request, feedback and captured evidence</summary><pre className="knowledge-content">{JSON.stringify(selected.payload, null, 2)}</pre></details>{selected.verifier_subject && <p>Verified by {selected.verifier_subject}. {selected.reason}</p>}
        {!canVerify && <p>A different administrator from the source author and preparation author must verify this case.</p>}
        <form onSubmit={event => { event.preventDefault(); void perform(async current => { if (!outcome) throw new Error('Choose the expected outcome.'); const verified = await verifyImprovementCandidate(selected.candidate_id, { expected_revision: selected.revision, expected_outcome: outcome, expected_facts: facts.split('\n').map(value => value.trim()).filter(Boolean), reason: reason.trim() }); if (current()) { setSelected(verified); setFacts(''); setReason(''); setNotice('Case independently verified. It can now be selected for a benchmark dataset.'); } }); }}><fieldset disabled={busy || !canVerify}><label>Verified expected outcome<select required value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)}><option value="">Choose after reviewing evidence</option><option value="FINDINGS">Evidence supports findings</option><option value="INSUFFICIENT_EVIDENCE">Evidence is insufficient</option></select></label><label>Verified facts, one per line<textarea required rows={5} maxLength={16000} value={facts} onChange={event => setFacts(event.target.value)} /></label><label>Verification reason<textarea required rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="submit" className="btn btn-primary" disabled={!outcome || !facts.trim() || !reason.trim()}>Verify this revision</button></fieldset></form><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void choose('')}>Close candidate</button>
        {selected.status === 'VERIFIED' && <details><summary>Create a knowledge draft from verified facts</summary><label>Document title<input maxLength={256} value={knowledgeTitle} onChange={event => setKnowledgeTitle(event.target.value)} /></label><label>Category<input maxLength={128} value={knowledgeCategory} onChange={event => setKnowledgeCategory(event.target.value)} /></label><button type="button" className="btn btn-secondary" disabled={busy || !knowledgeTitle.trim() || !knowledgeCategory.trim()} onClick={() => void perform(async current => { await draftCandidateKnowledge(selected.candidate_id, { expected_revision: selected.revision, title: knowledgeTitle.trim(), category: knowledgeCategory.trim() }); if (current()) { setKnowledgeTitle(''); setNotice('Knowledge draft saved. Open Knowledge to review and submit it for independent approval.'); } })}>Create knowledge draft</button></details>}
      </>}
    </section>
    <section className="knowledge-editor"><h3>Publish a verified benchmark</h3><p>Choose distinct incidents for training and holdout. The holdout must remain independent; the server checks incident overlap.</p><fieldset disabled={busy}>
      <div className="improvement-table"><table><thead><tr><th scope="col">Verified case</th><th scope="col">Capability</th><th scope="col">Dataset split</th></tr></thead><tbody>{candidates.filter(item => item.status === 'VERIFIED').map(item => <tr key={item.candidate_id}><td>{item.incident_id || item.source_run_id}</td><td>{item.capability}</td><td><select aria-label={`Dataset split for ${item.source_run_id}`} value={split[item.candidate_id] ?? ''} onChange={event => setSplit(current => ({ ...current, [item.candidate_id]: event.target.value as 'train' | 'holdout' | '' }))}><option value="">Exclude</option><option value="train">Training</option><option value="holdout">Holdout</option></select></td></tr>)}</tbody></table></div>
      {!candidates.some(item => item.status === 'VERIFIED') && <p>No independently verified cases yet.</p>}
      <p>{train.length} training cases · {holdout.length} holdout cases{capability ? ` · ${capability}` : ''}</p>
      <div className="knowledge-form-row"><label>Dataset ID<input pattern="[a-z][a-z0-9_-]{0,63}" maxLength={64} value={datasetId} onChange={event => setDatasetId(event.target.value)} /></label><label>Version<input maxLength={64} value={datasetVersion} onChange={event => setDatasetVersion(event.target.value)} /></label></div><label>Description<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label>Freeze approved knowledge with this benchmark (optional)<select multiple size={4} value={corpus} onChange={event => setCorpus(Array.from(event.target.selectedOptions, option => option.value))}>{knowledge.filter(item => item.status === 'approved' && item.okf_eligibility?.eligible !== false).map(item => <option key={item.id} value={item.id}>{item.title} · revision {item.revision}</option>)}</select></label>
      <div className="knowledge-actions"><button type="button" className="btn btn-primary" disabled={!/^[a-z][a-z0-9_-]{0,63}$/.test(datasetId) || !datasetVersion.trim() || !description.trim() || !train.length || !holdout.length || chosen.some(item => item.capability !== capability)} onClick={() => void perform(async current => { const result = await publishCandidateDataset({ id: datasetId, version: datasetVersion.trim(), description: description.trim(), capability: capability!, train_ids: train.map(item => item.candidate_id), holdout_ids: holdout.map(item => item.candidate_id), knowledge_document_ids: corpus }); if (current()) { setDescription(''); setSplit({}); setNotice(`Benchmark ${result.dataset_id} ${result.version} published. Select it above to evaluate a prompt or skill.`); onDataset(); } })}>Publish benchmark</button><button type="button" className="btn btn-secondary" onClick={() => { setDescription(''); setSplit({}); setCorpus([]); }}>Clear selection</button></div>
    </fieldset></section>
  </div>;
}
