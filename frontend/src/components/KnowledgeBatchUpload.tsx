import { useEffect, useRef, useState } from 'react';
import { fetchConfig, getSessionGeneration, uploadKnowledgeBatch } from '../services/api';
import type { KnowledgeUploadOutcome, RuntimeConfig } from '../types/api';

type Entry = { file: File; title: string; category: string; tags: string; outcome?: KnowledgeUploadOutcome };

export function KnowledgeBatchUpload({ onUploaded }: { onUploaded: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [limits, setLimits] = useState<(RuntimeConfig['file_limits'] & { max_upload_batch_bytes: number }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const active = useRef(false);
  const alive = useRef(false);
  const pending = entries.filter(entry => !entry.outcome || entry.outcome.status === 'failed');
  const loadLimits = async () => {
    const generation = getSessionGeneration();
    try {
      const config = await fetchConfig();
      if (alive.current && generation === getSessionGeneration()) { setLimits({ ...config.file_limits, max_upload_batch_bytes: config.execution.max_upload_batch_bytes }); setError(''); }
    } catch (cause) {
      if (alive.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Upload settings could not load.');
    }
  };
  useEffect(() => { alive.current = true; void loadLimits(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!pending.length && !busy) return;
    const guard = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for the upload to finish.' : 'Upload or discard the selected files before leaving.'); };
    const close = (event: BeforeUnloadEvent) => event.preventDefault();
    const acceptedUrl = window.location.href;
    const guardHistory = (event: Event) => {
      if (!event.isTrusted || window.location.href === acceptedUrl) return;
      event.stopImmediatePropagation();
      guard(event);
      window.history.pushState(null, '', acceptedUrl);
    };
    window.addEventListener('rca:before-navigation', guard); window.addEventListener('beforeunload', close);
    window.addEventListener('popstate', guardHistory, true); window.addEventListener('hashchange', guardHistory, true);
    return () => {
      window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', close);
      window.removeEventListener('popstate', guardHistory, true); window.removeEventListener('hashchange', guardHistory, true);
    };
  }, [pending.length, busy]);

  const choose = (files: FileList | null) => {
    if (!files || !limits || active.current) return;
    const selected = Array.from(files);
    const problem = selected.length > limits.max_files ? `Select up to ${limits.max_files} files at a time.`
      : selected.find(file => file.size > limits.max_file_bytes) ? `Each file must be within ${(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB.`
        : selected.reduce((bytes, file) => bytes + file.size, 0) > limits.max_upload_batch_bytes ? `The selected files exceed the ${(limits.max_upload_batch_bytes / 1024 / 1024).toLocaleString()} MB batch limit.`
          : selected.some(file => !limits.allowed_extensions.includes('.' + file.name.split('.').pop()?.toLowerCase())) ? 'One or more selected file types are not enabled.' : '';
    setError(problem);
    if (problem) { setInputKey(value => value + 1); return; }
    setEntries(selected.map(file => ({ file, title: file.name.replace(/\.[^.]+$/, '').slice(0, 256), category: '', tags: '' })));
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (active.current || !limits || !pending.length) return;
    const clean = pending.map(entry => ({ file: entry.file, metadata: { title: entry.title.trim(), category: entry.category.trim() || 'Runbooks', tags: [...new Set(entry.tags.split(',').map(tag => tag.trim()).filter(Boolean))] } }));
    if (clean.some(entry => !entry.metadata.title || entry.metadata.tags.length > 32 || entry.metadata.tags.some(tag => tag.length > 64))) { setError('Give each file a title and up to 32 tags, with at most 64 characters per tag.'); return; }
    active.current = true; setBusy(true); setError('');
    const generation = getSessionGeneration();
    try {
      const result = await uploadKnowledgeBatch(clean);
      if (!alive.current || generation !== getSessionGeneration()) return;
      const outcomes = new Map(result.outcomes.map(outcome => [pending[outcome.index]?.file, outcome]));
      setEntries(previous => previous.map(entry => outcomes.has(entry.file) ? { ...entry, outcome: outcomes.get(entry.file) } : entry));
      if (result.outcomes.some(outcome => outcome.status !== 'failed')) onUploaded();
    } catch (cause) {
      if (alive.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Upload could not finish. Retry to check each file safely.');
    } finally { active.current = false; if (alive.current && generation === getSessionGeneration()) setBusy(false); }
  };
  const edit = (index: number, field: 'title' | 'category' | 'tags', value: string) => setEntries(previous => previous.map((entry, position) => position === index ? { ...entry, [field]: value } : entry));
  return <details className="knowledge-batch">
    <summary>Upload several documents</summary>
    <p>Each file is saved independently as a draft. Exact duplicates keep their existing version and approval. Set document scope and required capabilities when reviewing each draft.</p>
    {error && <p role="alert" className="knowledge-message is-error">{error}</p>}
    <form onSubmit={upload} className="knowledge-editor">
      <fieldset disabled={busy}>
        <legend className="knowledge-visually-hidden">Batch document upload</legend>
        {limits ? <><label>Local documents<input key={inputKey} type="file" multiple accept={limits.allowed_extensions.join(',')} disabled={entries.length > 0} onChange={event => choose(event.target.files)} /></label><p>Up to {limits.max_files} files, {(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB each; {(limits.max_upload_batch_bytes / 1024 / 1024).toLocaleString()} MB total per batch. Supported: {limits.allowed_extensions.join(', ')}.</p></> : <><p role="status">{error ? 'Upload settings are unavailable.' : 'Loading upload settings…'}</p>{error && <button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry upload settings</button>}</>}
        {entries.length > 0 && <ol className="knowledge-batch-files">{entries.map((entry, index) => {
          const complete = entry.outcome && entry.outcome.status !== 'failed';
          return <li key={index}><header><strong>{entry.file.name}</strong><span>{(entry.file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</span></header>
            <div className="knowledge-form-row"><label>Document title<input required maxLength={256} disabled={Boolean(complete)} value={entry.title} onChange={event => edit(index, 'title', event.target.value)} /></label><label>Category<input maxLength={128} placeholder="Runbooks" disabled={Boolean(complete)} value={entry.category} onChange={event => edit(index, 'category', event.target.value)} /></label></div>
            <label>Tags, separated by commas<input maxLength={2079} disabled={Boolean(complete)} value={entry.tags} onChange={event => edit(index, 'tags', event.target.value)} /></label>
            {!complete && <button type="button" className="btn btn-secondary" onClick={() => setEntries(previous => previous.filter((_, position) => position !== index))} aria-label={`Remove ${entry.file.name} from batch`}>Remove file</button>}
            {entry.outcome && <p role={entry.outcome.status === 'failed' ? 'alert' : 'status'}>{entry.outcome.status === 'created' ? `Saved as draft: ${entry.outcome.document?.title ?? entry.title}.` : entry.outcome.status === 'duplicate' ? `Already stored as ${entry.outcome.document?.title ?? entry.title}, revision ${entry.outcome.matched_revision}. ${entry.outcome.duplicate_historical ? 'This matches an older revision; the current document is unchanged.' : 'The existing content and approval are unchanged.'}` : entry.outcome.error?.message || 'This file could not be saved. Retry after correcting it.'}</p>}
          </li>;
        })}</ol>}
        <div className="knowledge-actions">{pending.length > 0 && <button type="submit" className="btn btn-primary" disabled={busy || !limits}>{busy ? 'Uploading and processing files…' : entries.some(entry => entry.outcome) ? `Retry ${pending.length} remaining files` : `Upload ${pending.length} files`}</button>}{entries.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEntries([]); setInputKey(value => value + 1); setError(''); }}>{pending.length ? 'Discard selected files' : 'Choose more files'}</button>}</div>
      </fieldset>
    </form>
  </details>;
}
