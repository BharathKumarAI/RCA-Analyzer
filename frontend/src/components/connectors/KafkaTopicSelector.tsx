import { useEffect, useId, useRef, useState } from 'react';
import { fetchKafkaTopicScope, previewKafkaTopics, type KafkaTopicCondition, type KafkaTopicPreview, type KafkaTopicScope, type KafkaTopicSelection } from '../../services/kafkaTopics';

export function KafkaTopicSelector({ projectId, instanceId, revision, environments, selection, onChange, readOnly }: {
  projectId: string; instanceId?: string; revision?: number; environments: { id: string; name: string }[];
  selection: KafkaTopicSelection | null; onChange: (value: KafkaTopicSelection | null) => void; readOnly: boolean;
}) {
  const id = useId();
  const [environment, setEnvironment] = useState('');
  const [scope, setScope] = useState<KafkaTopicScope | null>(null);
  const [preview, setPreview] = useState<KafkaTopicPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const snapshot = JSON.stringify({ projectId, instanceId, revision, environment, selection });
  useEffect(() => { request.current?.abort(); setBusy(false); setPreview(null); setError(null); return () => request.current?.abort(); }, [snapshot]);
  useEffect(() => { setScope(null); }, [projectId, instanceId, revision, environment]);
  const unavailable = readOnly || busy || !instanceId || (environments.length > 0 && !environments.some(item => item.id === environment));
  const perform = async (test: boolean) => {
    if (unavailable || (test && !selection)) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError(null); setPreview(null);
    try {
      if (test) { const result = await previewKafkaTopics(projectId, instanceId!, selection!, environment || undefined, controller.signal); if (!controller.signal.aborted) setPreview(result); }
      else { const result = await fetchKafkaTopicScope(projectId, instanceId!, environment || undefined, controller.signal); if (!controller.signal.aborted) setScope(result); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Kafka topic request failed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const conditions = (kind: 'include' | 'exclude') => selection && <fieldset disabled={readOnly || busy}><legend>{kind === 'include' ? 'Include any matching name' : 'Exclude any matching name'}</legend>{selection[kind].map((condition, index) => <div key={index} className="jira-query-condition"><label>Match<select value={condition.operator} onChange={event => onChange({ ...selection, [kind]: selection[kind].map((item, i) => i === index ? { ...item, operator: event.target.value as KafkaTopicCondition['operator'] } : item) })}><option value="equals">Equals</option><option value="starts_with">Starts with</option><option value="contains">Contains</option><option value="glob">Glob (* and ?)</option></select></label><label>Topic name pattern<input maxLength={249} value={condition.value} onChange={event => onChange({ ...selection, [kind]: selection[kind].map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /></label><button type="button" className="btn btn-secondary" onClick={() => onChange({ ...selection, [kind]: selection[kind].filter((_, i) => i !== index) })}>Remove</button></div>)}<button type="button" className="btn btn-secondary" disabled={selection[kind].length >= 20} onClick={() => onChange({ ...selection, [kind]: [...selection[kind], { operator: 'equals', value: '' }] })}>Add {kind} condition</button></fieldset>;
  return <section className="jira-query-builder" aria-labelledby={id}><h3 id={id}>Kafka topic selection</h3><p>Choose within the saved connection’s authorized topic names. Loading scope does not discover cluster topics. Preview reads bounded metadata from Kafka using the saved connection.</p>
    {!instanceId && <p>Save the connection before loading topic scope or previewing metadata.</p>}
    {environments.length > 0 && <label>Saved environment<select value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value)}><option value="">Choose environment</option>{environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <button type="button" className="btn btn-secondary" disabled={unavailable} onClick={() => void perform(false)}>Load authorized topics</button>
    {scope && <p role="status">{scope.authorized_topics.length} authorized names from saved revision {scope.instance_revision}. Live availability has not been checked.</p>}
    <label>Selection mode<select value={selection?.mode || 'legacy'} disabled={readOnly || busy} onChange={event => { const mode = event.target.value; onChange(mode === 'legacy' ? null : { mode: mode as 'explicit' | 'filters', topics: [], include: [], exclude: [], max_matched_topics: selection?.max_matched_topics || 10 }); }}><option value="legacy">Existing single-topic configuration</option><option value="explicit">Explicit topic names</option><option value="filters">Include and exclude filters</option></select></label>
    {selection?.mode === 'explicit' && <fieldset disabled={readOnly || busy}><legend>Authorized topic names</legend>{scope?.authorized_topics.map(topic => <label className="jira-query-check" key={topic}><input type="checkbox" checked={selection.topics.includes(topic)} onChange={event => onChange({ ...selection, topics: event.target.checked ? [...selection.topics, topic] : selection.topics.filter(item => item !== topic) })} />{topic}</label>)}{selection.topics.filter(topic => !scope?.authorized_topics.includes(topic)).map(topic => <label className="jira-query-check" key={topic}><input type="checkbox" checked onChange={() => onChange({ ...selection, topics: selection.topics.filter(item => item !== topic) })} />{topic} — scope not loaded or unavailable</label>)}{!scope && <p>Load the saved topic scope before adding names.</p>}</fieldset>}
    {selection?.mode === 'filters' && <>{conditions('include')}{conditions('exclude')}<p>Includes use OR. Excludes always win. Patterns cannot expand the saved resource scope.</p></>}
    {selection && <label>Maximum matched topics<input type="number" min={1} max={50} step={1} disabled={readOnly || busy} value={selection.max_matched_topics} onChange={event => onChange({ ...selection, max_matched_topics: Number(event.target.value) })} /></label>}
    <p>Save the connector to apply the selection. A preview does not enable or certify the connection.</p>
    <button type="button" className="btn btn-primary" disabled={unavailable || !selection || !Number.isInteger(selection.max_matched_topics) || selection.max_matched_topics < 1 || selection.max_matched_topics > 50} onClick={() => void perform(true)}>Preview live topic metadata</button>
    {busy && <p role="status">Reading topic configuration…</p>}{error && <p role="alert">{error}</p>}
    {preview && <div aria-live="polite"><p>{preview.selected_topics.length} selected topics checked at {new Date(preview.tested_at * 1000).toLocaleString()} using revision {preview.instance_revision}.{preview.partial ? ' Some topic metadata was unavailable.' : ''}{preview.possibly_truncated ? ' Results are truncated.' : ''}</p>{!preview.topics.length && <p>No authorized topics matched this selection.</p>}{preview.topics.map(topic => <details key={topic.topic}><summary>{topic.topic} · {topic.status} · {topic.partitions.length} returned partitions{topic.possibly_truncated ? ' · truncated' : ''}</summary><pre>{JSON.stringify(topic.partitions, null, 2)}</pre></details>)}</div>}
  </section>;
}
