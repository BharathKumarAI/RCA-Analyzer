import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCapabilities, getSessionGeneration } from '../services/api';
import { fetchKnowledgeSettings, saveKnowledgeSettings, type KnowledgeSettings } from '../services/knowledge';
import { controlImprovement, enqueueImprovement, fetchImprovementJobs, fetchImprovementSchedules, saveImprovementSchedule, type ImprovementJob, type ImprovementSchedule, type JobInput, type KnowledgeCaptureInput, type KnowledgeCaptureSource } from '../services/improvement';
import { RunConnectorSelectors, useRunConnectorSelections } from './RunConnectorSelectors';
import { KnowledgeClosureMonitor } from './KnowledgeClosureMonitor';
import type { CapabilityItem, Principal, RunConnectorSelections } from '../types/api';

const sourceLabels: Record<KnowledgeCaptureSource, string> = {
  documents: 'Project documents', closed_tickets: 'Closed Jira tickets', confluence: 'Confluence pages', feedback: 'Verified feedback',
};
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleString();
const sourceCapabilities = (items: CapabilityItem[], adapter: string, action: string) => items.filter(item =>
  item.is_authorized && item.runtime_supported !== false && item.project_enabled !== false && item.enabled !== false
  && [...(item.required_connectors ?? item.requires?.connectors ?? []), ...(item.optional_connectors ?? item.optional?.connectors ?? [])].includes(adapter)
  && item.permissions?.allowed_actions?.includes(action));

export function KnowledgeIntake({ principal, onDocumentsChanged, onOpenImprovement, onOpenRun, onOpenAlerts }: { principal: Principal; onDocumentsChanged: () => void; onOpenImprovement: () => void; onOpenRun: (id: string) => void | Promise<void>; onOpenAlerts: () => void }) {
  const [settings, setSettings] = useState<KnowledgeSettings | null>(null);
  const [lookback, setLookback] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [jobs, setJobs] = useState<ImprovementJob[]>([]);
  const [schedules, setSchedules] = useState<ImprovementSchedule[]>([]);
  const [sources, setSources] = useState<KnowledgeCaptureSource[]>(['documents']);
  const [topic, setTopic] = useState('');
  const [limit, setLimit] = useState(50);
  const [capabilityIds, setCapabilityIds] = useState<KnowledgeCaptureInput['source_capabilities']>({});
  const [scheduleName, setScheduleName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [editing, setEditing] = useState<ImprovementSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const active = useRef(false);
  const loadVersion = useRef(0);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const priorJobs = useRef(new Map<string, string>());
  const onChanged = useRef(onDocumentsChanged);
  const pendingSelections = useRef<RunConnectorSelections | null>(null);
  const jira = useRunConnectorSelections(sources.includes('closed_tickets') ? capabilityIds.closed_tickets || '' : '');
  const confluence = useRunConnectorSelections(sources.includes('confluence') ? capabilityIds.confluence || '' : '');
  const jiraCapabilities = sourceCapabilities(capabilities, 'itsm', 'itsm.get_ticket');
  const confluenceCapabilities = sourceCapabilities(capabilities, 'confluence', 'confluence.read_evidence');
  const settingsDirty = Boolean(settings && lookback !== String(settings.lookback_months));
  const formDirty = Boolean(scheduleName || topic || editing || limit !== 50 || intervalMinutes !== 1440 || sources.length !== 1 || sources[0] !== 'documents' || Object.values(capabilityIds).some(Boolean));

  useEffect(() => { onChanged.current = onDocumentsChanged; }, [onDocumentsChanged]);
  const load = useCallback(async (includeSettings = false) => {
    const version = ++loadVersion.current; const generation = getSessionGeneration();
    try {
      const [nextJobs, nextSchedules, configuration] = await Promise.all([
        fetchImprovementJobs(), fetchImprovementSchedules(),
        includeSettings ? Promise.all([fetchKnowledgeSettings(), fetchCapabilities()]) : Promise.resolve(null),
      ]);
      if (!alive.current || version !== loadVersion.current || generation !== getSessionGeneration()) return;
      if (nextJobs.some(job => job.payload.kind === 'capture_knowledge' && job.status === 'SUCCEEDED' && ['QUEUED', 'RUNNING'].includes(priorJobs.current.get(job.job_id) || ''))) onChanged.current();
      priorJobs.current = new Map(nextJobs.map(job => [job.job_id, job.status]));
      setJobs(nextJobs); setSchedules(nextSchedules);
      if (configuration) { setSettings(configuration[0]); setLookback(String(configuration[0].lookback_months)); setCapabilities(configuration[1]); }
      setError('');
    } catch (cause) { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Knowledge automation could not load. Refresh to retry.'); }
    finally { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(true); return () => { alive.current = false; loadVersion.current++; }; }, [load]);
  const running = jobs.some(job => ['capture_knowledge', 'prepare_feedback', 'track_closures'].includes(job.payload.kind) && ['QUEUED', 'RUNNING'].includes(job.status));
  useEffect(() => {
    if (!running || busy) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [running, busy, load]);
  useEffect(() => {
    if (!pendingSelections.current || jira.loading || confluence.loading) return;
    const selected = pendingSelections.current; pendingSelections.current = null;
    jira.setSelections(selected.itsm ? { itsm: selected.itsm } : {});
    confluence.setSelections(selected.confluence ? { confluence: selected.confluence } : {});
  }, [jira.loading, confluence.loading, capabilityIds]);
  useEffect(() => {
    if (!busy && !settingsDirty && !formDirty) return;
    const guard = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for the current automation action to finish.' : 'Save or clear the automation form before leaving.'); };
    window.addEventListener('rca:before-navigation', guard); window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', guard); };
  }, [busy, settingsDirty, formDirty]);
  const perform = async (action: (current: () => boolean) => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice('');
    const generation = getSessionGeneration(); const current = () => alive.current && generation === getSessionGeneration();
    try { await action(current); if (current()) await load(); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Action failed. Your settings are preserved.'); }
    finally { active.current = false; if (current()) setBusy(false); }
  };
  const captureInput = (): JobInput => {
    if (!settings || settingsDirty) throw new Error('Save or discard the initial lookback change before queuing work.');
    if (!sources.length || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Select at least one source and a batch size from 1 to 100.');
    const connector_selections: RunConnectorSelections = {};
    const source_capabilities: KnowledgeCaptureInput['source_capabilities'] = {};
    for (const [source, adapter, state, options] of [
      ['closed_tickets', 'itsm', jira, jiraCapabilities], ['confluence', 'confluence', confluence, confluenceCapabilities],
    ] as const) {
      if (!sources.includes(source)) continue;
      const capability = capabilityIds[source]; const selected = state.selections[adapter];
      const group = state.groups.find(item => item.adapter === adapter);
      if (!capability || !options.some(item => item.id === capability) || state.loading || state.error || !selected || !group?.choices.some(choice => choice.value.instance_id === selected.instance_id && choice.value.environment_id === selected.environment_id)) throw new Error(`Choose an available capability, source instance and environment for ${sourceLabels[source]}.`);
      connector_selections[adapter] = selected; source_capabilities[source] = capability;
    }
    return { kind: 'capture_knowledge', capture: { sources, limit, connector_selections, source_capabilities, ...(editing?.payload.capture?.lookback_months && { lookback_months: editing.payload.capture.lookback_months }), ...(topic.trim() && { topic: topic.trim() }) } };
  };
  const clearForm = () => { setEditing(null); setScheduleName(''); setTopic(''); setIntervalMinutes(1440); setSources(['documents']); setCapabilityIds({}); setLimit(50); pendingSelections.current = null; submission.current = null; if (settings) setLookback(String(settings.lookback_months)); };
  const editSchedule = (schedule: ImprovementSchedule) => {
    if (busy || settingsDirty || formDirty) { setError('Save or clear your current automation form before editing a schedule.'); return; }
    const capture = schedule.payload.capture; if (!capture) return;
    setEditing(schedule); setScheduleName(schedule.name); setIntervalMinutes(schedule.interval_seconds / 60);
    setSources(capture.sources); setTopic(capture.topic || ''); setLimit(capture.limit ?? 50); setCapabilityIds(capture.source_capabilities);
    pendingSelections.current = capture.connector_selections;
  };
  const captureSchedules = schedules.filter(schedule => schedule.payload.kind === 'capture_knowledge');
  const feedbackSchedules = schedules.filter(schedule => schedule.payload.kind === 'prepare_feedback');
  const captureJobs = jobs.filter(job => job.payload.kind === 'capture_knowledge');
  const feedbackJobs = jobs.filter(job => job.payload.kind === 'prepare_feedback');

  return <details className="knowledge-intake">
    <summary>Knowledge intake and daily refresh</summary>
    <p>Capture project guidance from selected sources into reviewable drafts. Repeated source versions are deduplicated; changed versions preserve earlier history. Nothing is approved automatically.</p>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}{notice && <p className="knowledge-message is-success" role="status">{notice}</p>}
    <div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={busy || loading} onClick={() => void load(!settings)}>Refresh automation status</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={onOpenImprovement}>Open feedback and improvement</button></div>
    {loading && <p role="status">Loading project intake settings…</p>}
    <div className="knowledge-editor"><fieldset disabled={loading || busy || !settings}>
      <legend>Initial capture window</legend>
      <label>Look back (calendar months)<input type="number" min={1} max={24} step={1} value={lookback} onChange={event => setLookback(event.target.value)} /></label>
      <p>{settings && (settings.revision === null ? 'This project inherits the platform setting. ' : 'This project has its own lookback setting. ')}The window uses calendar months. Continuing jobs retain their original window.</p>
      <div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={!settingsDirty || !Number.isInteger(Number(lookback)) || Number(lookback) < 1 || Number(lookback) > 24} onClick={() => void perform(async current => { const value = await saveKnowledgeSettings(Number(lookback), settings!.revision, settings!.definition_revision); if (current()) { setSettings(value); setLookback(String(value.lookback_months)); setNotice('Project lookback saved. Existing capture windows remain unchanged.'); } })}>Save project lookback</button>{settingsDirty && <button type="button" className="btn btn-secondary" onClick={() => setLookback(String(settings!.lookback_months))}>Discard lookback change</button>}<button type="button" className="btn btn-secondary" onClick={() => void load(true)}>Reload saved project settings</button></div>
    </fieldset>
    <fieldset disabled={loading || busy || !settings}>
      <legend>Capture sources</legend>
      {(Object.entries(sourceLabels) as [KnowledgeCaptureSource, string][]).map(([source, label]) => <label key={source}><input type="checkbox" checked={sources.includes(source)} onChange={event => setSources(previous => event.target.checked ? [...previous, source] : previous.filter(value => value !== source))} />{label}</label>)}
      <p>Feedback capture uses independently verified facts. Unverified ratings stay in the feedback review queue.</p>
      {sources.includes('closed_tickets') && <><label>Jira read capability<select value={capabilityIds.closed_tickets || ''} onChange={event => setCapabilityIds(previous => ({ ...previous, closed_tickets: event.target.value }))}><option value="">Select a capability</option>{jiraCapabilities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{!jiraCapabilities.length && <p>No authorized Jira ticket-read capability is available in this project.</p>}<RunConnectorSelectors state={{ ...jira, groups: jira.groups.filter(group => group.adapter === 'itsm').map(group => ({ ...group, required: true, requiresSelection: true })) }} disabled={busy} /></>}
      {sources.includes('confluence') && <><label>Confluence read capability<select value={capabilityIds.confluence || ''} onChange={event => setCapabilityIds(previous => ({ ...previous, confluence: event.target.value }))}><option value="">Select a capability</option>{confluenceCapabilities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{!confluenceCapabilities.length && <p>No authorized Confluence read capability is available in this project.</p>}<RunConnectorSelectors state={{ ...confluence, groups: confluence.groups.filter(group => group.adapter === 'confluence').map(group => ({ ...group, required: true, requiresSelection: true })) }} disabled={busy} /></>}
      <div className="knowledge-form-row"><label>Topic, optional<input maxLength={128} value={topic} onChange={event => setTopic(event.target.value)} /></label><label>Items per batch<input type="number" min={1} max={100} value={limit} onChange={event => setLimit(Number(event.target.value))} /></label></div><p>Leave topic empty for the capture process to organize supported source content. Multiple batches continue in the same job.</p>
      <button type="button" className="btn btn-primary" onClick={() => void perform(async current => { const input = captureInput(); const fingerprint = JSON.stringify(input); if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() }; const job = await enqueueImprovement(input, submission.current!.key); if (current()) { priorJobs.current.set(job.job_id, job.status); submission.current = null; setNotice(`Capture queued: ${job.job_id}. Review its progress below.`); } })}>Capture now</button>
      <div className="knowledge-form-row"><label>Schedule name<input maxLength={128} value={scheduleName} onChange={event => setScheduleName(event.target.value)} /></label><label>Repeat every (minutes)<input type="number" min={5} max={44640} step={1} value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} /></label></div>
      <p>1,440 minutes is daily. Pausing stops future jobs; cancel an active job separately.</p>
      <div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={!scheduleName.trim() || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 44640} onClick={() => void perform(async current => { await saveImprovementSchedule({ name: scheduleName.trim(), interval_seconds: intervalMinutes * 60, enabled: editing?.enabled ?? true, job: captureInput(), ...(editing && { expected_revision: editing.revision }) }, editing?.schedule_id); if (current()) { clearForm(); setNotice('Capture schedule saved. The worker checks current project access and source configuration on each run.'); } })}>{editing ? 'Save capture schedule' : 'Create capture schedule'}</button><button type="button" className="btn btn-secondary" onClick={clearForm}>Clear automation form</button></div>
    </fieldset></div>
    <section><h3>Capture schedules</h3>{settings && !loading && !captureSchedules.length && <p>No capture schedules configured.</p>}<ul className="improvement-list">{captureSchedules.map(schedule => <li key={schedule.schedule_id}><div><strong>{schedule.name}</strong><p>{schedule.enabled ? `Next run: ${date(schedule.next_run_at)}` : 'Paused'} · Every {schedule.interval_seconds / 60} minutes</p><p>{schedule.payload.capture?.sources.map(source => sourceLabels[source]).join(', ')}</p></div><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => editSchedule(schedule)}>Edit</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await saveImprovementSchedule({ name: schedule.name, enabled: !schedule.enabled, interval_seconds: schedule.interval_seconds, job: schedule.payload, expected_revision: schedule.revision }, schedule.schedule_id); })}>{schedule.enabled ? 'Pause' : 'Resume'}</button></div></li>)}</ul></section>
    <section><h3>Capture history</h3>{settings && !loading && !captureJobs.length && <p>No capture jobs recorded.</p>}<ul className="improvement-list">{captureJobs.map(job => <li key={job.job_id}><div><strong>{job.status}{job.result?.status === 'CONTINUE' ? ' · Continuing source pages' : ''}</strong><p>{date(job.created_at)} · {job.attempts} attempts{job.cancel_requested ? ' · Cancellation requested' : ''}</p>{job.result && <p>{typeof job.result.created === 'number' && `${job.result.created} drafts created. `}{typeof job.result.unchanged === 'number' && `${job.result.unchanged} unchanged. `}{typeof job.result.processed === 'number' && `${job.result.processed} items processed.`}</p>}{job.error && <p className="knowledge-message is-error">{job.error}</p>}<details><summary>Recorded capture details</summary><p>{job.job_id}</p><pre className="knowledge-content">{JSON.stringify(job.result ?? job.payload, null, 2)}</pre></details></div><div className="knowledge-actions">{['QUEUED', 'RUNNING'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy || job.cancel_requested} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'cancel'); })}>Cancel</button>}{['FAILED', 'CANCELLED'].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => { await controlImprovement(job.job_id, 'retry'); })}>Retry</button>}</div></li>)}</ul></section>
    <section><h3>Feedback loop</h3>{settings ? <><p>{feedbackSchedules.filter(schedule => schedule.enabled).length} enabled feedback preparation schedules. {feedbackJobs.filter(job => ['QUEUED', 'RUNNING'].includes(job.status)).length} preparation jobs queued or running.</p>{feedbackJobs[0] && <p>Latest preparation: {feedbackJobs[0].status} · {date(feedbackJobs[0].created_at)}</p>}</> : <p>Feedback status is unavailable until automation records load.</p>}<p>Preparation produces candidates for independent verification. Verified facts can become knowledge drafts; approval is still required before investigations use them.</p></section>
    {settings && <KnowledgeClosureMonitor principal={principal} jobs={jobs} schedules={schedules} onRefreshAutomation={load} onOpenRun={onOpenRun} onOpenAlerts={onOpenAlerts} />}
  </details>;
}
