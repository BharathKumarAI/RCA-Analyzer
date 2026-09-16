import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { createKnowledgeDoc, fetchConfig, request, updateKnowledgeDoc, uploadKnowledgeDoc } from '../services/api';
import type { KnowledgeAssociations, KnowledgeItem, KnowledgeScopes, KnowledgeStructure, RuntimeConfig } from '../types/api';
import { KnowledgeStructureEditor } from './KnowledgeStructureEditor';
import { knowledgeStructureError } from '../services/knowledge';
import '../styles/knowledge.css';

interface KnowledgeDocumentFormProps {
  item?: KnowledgeItem;
  onSaved?: (item: KnowledgeItem) => void;
  onCancel?: () => void;
  topics?: string[];
}

export const KnowledgeDocumentForm: React.FC<KnowledgeDocumentFormProps> = ({ item, onSaved, onCancel, topics }) => {
  const [title, setTitle] = useState(item?.title ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const originalMetadata = item?.okf ? JSON.stringify(item.okf.metadata, null, 2) : '';
  const [metadata, setMetadata] = useState(originalMetadata);
  const initialAssociations: KnowledgeAssociations = item?.associations ?? { environment_ids: [], capability_ids: [], connector_instance_ids: [], required: false };
  const [associations, setAssociations] = useState(initialAssociations);
  const [scopes, setScopes] = useState<KnowledgeScopes | null>(null);
  const initialMode = item?.structure ? 'structured' : item ? 'text' : 'file';
  const initialStructure: KnowledgeStructure = item?.structure ?? { topic: '', summary: '', blocks: [{ kind: 'reference', title: item?.title ?? '', content: item?.content ?? '' }] };
  const [structure, setStructure] = useState<KnowledgeStructure>(initialStructure);
  const [mode, setMode] = useState<'file' | 'text' | 'structured'>(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [limits, setLimits] = useState<RuntimeConfig['file_limits'] | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<KnowledgeItem | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(file || mode !== initialMode || JSON.stringify(structure) !== JSON.stringify(initialStructure) || JSON.stringify(associations) !== JSON.stringify(initialAssociations) || metadata !== originalMetadata || title !== (item?.title ?? '') || category !== (item?.category ?? '') || content !== (item?.content ?? '') || tags !== (item?.tags.join(', ') ?? ''));

  const loadLimits = async () => {
    try { const [config, catalog] = await Promise.all([fetchConfig(), request<KnowledgeScopes>('/api/v1/knowledge/scopes')]); setLimits(config.file_limits); setScopes(catalog); setLimitsError(null); }
    catch (reason) { setLimitsError(reason instanceof Error ? reason.message : 'Upload settings could not load. Try again.'); }
  };
  useEffect(() => { void loadLimits(); }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const preventLeave = (event: Event) => { event.preventDefault(); setError('Save or discard this document before leaving the page.'); };
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('rca:before-navigation', preventLeave);
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('rca:before-navigation', preventLeave); window.removeEventListener('beforeunload', warn); };
  }, [dirty, busy]);

  const reset = () => {
    setTitle(item?.title ?? ''); setCategory(item?.category ?? ''); setContent(item?.content ?? '');
    setTags(item?.tags.join(', ') ?? ''); setFile(null); setFileKey(key => key + 1); setError(null);
    setMetadata(originalMetadata);
    setAssociations(initialAssociations);
    setStructure(initialStructure); setMode(initialMode);
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setError(null); setSaved(null);
    if (!limits) { setError('Document limits could not be verified. Reload the upload settings before saving.'); return; }
    if (item && !item.content_hash) { setError('This document version is unavailable. Refresh the library before editing.'); return; }
    if (mode === 'file') {
      if (!file || !limits) { setError('Select a file after upload settings have loaded.'); return; }
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!limits.allowed_extensions.includes(extension)) { setError('This file type is not enabled. Choose one of the supported types below.'); return; }
      if (file.size > limits.max_file_bytes) { setError(`This file exceeds the ${(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB limit.`); return; }
    } else if (mode === 'structured') {
      const problem = knowledgeStructureError(structure, limits.max_text_chars);
      if (problem) { setError(problem); return; }
    } else if (!content.trim() || content.length > Math.min(limits.max_text_chars, 1_000_000)) { setError('Add document text within the configured character limit before saving.'); return; }
    const cleanTags = [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))];
    if (cleanTags.length > 32 || cleanTags.some(tag => tag.length > 64)) { setError('Use up to 32 tags, with no more than 64 characters per tag.'); return; }
    if (associations.required && !associations.capability_ids.length) { setError('Choose at least one capability that requires this document.'); return; }
    setBusy(true);
    try {
      const okfMetadata: unknown = item?.okf && mode !== 'file' ? JSON.parse(metadata) : undefined;
      if (okfMetadata !== undefined && (!okfMetadata || typeof okfMetadata !== 'object' || Array.isArray(okfMetadata))) throw new Error('OKF metadata must be a JSON object. Preserve existing keys unless you intend to change them.');
      const payload = { title: title.trim(), category: category.trim() || 'Runbooks', content: mode === 'structured' ? '' : content.trim(), structure: mode === 'structured' ? structure : null, tags: cleanTags, associations, media_type: 'text/markdown', ...(item && { expected_hash: item.content_hash }), ...(okfMetadata && { okf_metadata: okfMetadata as Record<string, unknown> }) };
      const result = mode === 'file' && file
        ? await uploadKnowledgeDoc(file, title.trim(), category.trim() || 'Runbooks', item ? { doc_id: item.id, expected_hash: item.content_hash! } : undefined, cleanTags, associations)
        : item ? await updateKnowledgeDoc(item.id, payload) : await createKnowledgeDoc(payload);
      setSaved(result); reset(); onSaved?.(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The document could not be saved. Your entries and selected file are still here.'); }
    finally { setBusy(false); }
  };

  return <div className="knowledge-editor">
    {error && <p className="knowledge-message is-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
    {saved && <div className="knowledge-message is-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{saved.upload_match ? `${saved.title} already contains this file in revision ${saved.upload_match.revision}.` : `${saved.title} saved as a draft.`}</strong><p>{saved.upload_match ? `Current revision ${saved.upload_match.current_revision} and its approval are unchanged.` : 'Review the extracted content in Knowledge, then submit it for approval.'}</p>{saved.upload?.warnings.length ? <ul>{saved.upload.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</div></div>}
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend className="knowledge-visually-hidden">{item ? 'Edit document' : 'Add document'}</legend>
        <div className="knowledge-form-row"><label>Document title<input required maxLength={256} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Category<input maxLength={128} value={category} onChange={event => setCategory(event.target.value)} placeholder="Runbooks" /></label></div>
        <label>Content source<select value={mode} onChange={event => setMode(event.target.value as 'file' | 'text' | 'structured')}><option value="file">{item ? 'Replace with an uploaded file' : 'Upload a file'}</option><option value="text">{item ? 'Edit document text' : 'Write or paste text'}</option><option value="structured">Organize by topic and sections</option></select></label>
        {mode === 'file' ? <section className="knowledge-upload">
          <label><span><Upload size={16} aria-hidden="true" /> Choose a local document</span><input key={fileKey} type="file" required accept={limits?.allowed_extensions.join(',')} disabled={!limits} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>
          {limits ? <><p>Supported: {limits.allowed_extensions.join(', ')}. Up to {(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB per file.</p><p>Text is extracted for review. Images contribute text through OCR only. Original files are retained for download.</p></> : limitsError ? <div role="alert"><p>{limitsError}</p><button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry upload settings</button></div> : <p role="status">Loading upload settings…</p>}
          {file && <p>Selected: <strong>{file.name}</strong> · {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</p>}
        </section> : mode === 'structured' ? <><KnowledgeStructureEditor value={structure} onChange={setStructure} topics={topics} />{limitsError && <div role="alert"><p>{limitsError}</p><button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry document settings</button></div>}</> : <><label>Document text<textarea required rows={12} maxLength={limits ? Math.min(limits.max_text_chars, 1_000_000) : 1_000_000} value={content} onChange={event => setContent(event.target.value)} /></label><p>{content.length.toLocaleString()} characters{limits && <> · limit {Math.min(limits.max_text_chars, 1_000_000).toLocaleString()}</>}</p>{item?.structure && <p>Saving plain text removes topic and section metadata. Use the structured editor to keep them.</p>}{limitsError && <div role="alert"><p>{limitsError}</p><button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry document settings</button></div>}</>}
        <label>Tags<input maxLength={2079} value={tags} onChange={event => setTags(event.target.value)} aria-describedby="knowledge-tags-help" /></label><p id="knowledge-tags-help">Separate tags with commas. Up to 32 tags, with 64 characters per tag.</p>
        <details open={Boolean(item?.associations)}><summary>Where this document can be used</summary><p>Leave a selection empty to allow all of that kind in this project. Scope changes require a new review.</p>{scopes && (['environment_ids', 'capability_ids', 'connector_instance_ids'] as const).map(key => <label key={key}>{({ environment_ids: 'Environments', capability_ids: 'Capabilities', connector_instance_ids: 'Connector instances' })[key]}<select multiple size={Math.min(4, Math.max(2, scopes[key].length))} value={associations[key]} onChange={event => setAssociations(previous => ({ ...previous, [key]: Array.from(event.target.selectedOptions, option => option.value) }))}>{[...scopes[key], ...associations[key].filter(id => !scopes[key].some(scope => scope.id === id)).map(id => ({ id, name: `${id} (unavailable; remove before saving)` }))].map(scope => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select><button type="button" className="btn btn-secondary" onClick={() => setAssociations(previous => ({ ...previous, [key]: [] }))}>Clear selection</button></label>)}<label><input type="checkbox" checked={associations.required} onChange={event => setAssociations(previous => ({ ...previous, required: event.target.checked }))} /> Required for the selected capabilities</label><p>After approval, this requirement remains in force during edits and after revocation until an independently approved replacement removes it.</p></details>
        {item?.okf && mode !== 'file' && <details><summary>Edit Open Knowledge Format metadata</summary><p>Metadata is reference data. Changes to freshness, status or any other key require a new review. Imported trust claims cannot grant approval.</p><label>Metadata JSON<textarea rows={10} maxLength={32000} value={metadata} onChange={event => setMetadata(event.target.value)} spellCheck={false} /></label></details>}
        {item?.status === 'approved' && <p>Saving an edit returns this document to draft. Investigations will use it again after a new approval.</p>}
        <div className="knowledge-actions"><button type="submit" className="btn btn-primary" disabled={busy || !limits || (mode === 'file' && !file)}>{busy ? 'Saving document…' : 'Save document draft'}</button>{(onCancel || dirty) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { reset(); onCancel?.(); }}>{dirty ? 'Discard changes' : 'Cancel'}</button>}</div>
        <p>Drafts are saved to this project. Only approved documents are used in new investigations.</p>
      </fieldset>
    </form>
  </div>;
};
