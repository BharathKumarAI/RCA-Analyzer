import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { createKnowledgeDoc, fetchConfig, updateKnowledgeDoc, uploadKnowledgeDoc } from '../services/api';
import type { KnowledgeItem, RuntimeConfig } from '../types/api';
import '../styles/knowledge.css';

interface KnowledgeDocumentFormProps {
  item?: KnowledgeItem;
  onSaved?: (item: KnowledgeItem) => void;
  onCancel?: () => void;
}

export const KnowledgeDocumentForm: React.FC<KnowledgeDocumentFormProps> = ({ item, onSaved, onCancel }) => {
  const [title, setTitle] = useState(item?.title ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const [mode, setMode] = useState<'file' | 'text'>(item ? 'text' : 'file');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [limits, setLimits] = useState<RuntimeConfig['file_limits'] | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<KnowledgeItem | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(file || title !== (item?.title ?? '') || category !== (item?.category ?? '') || content !== (item?.content ?? '') || tags !== (item?.tags.join(', ') ?? ''));

  const loadLimits = async () => {
    try { setLimits((await fetchConfig()).file_limits); setLimitsError(null); }
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
    } else if (!content.trim() || content.length > Math.min(limits.max_text_chars, 1_000_000)) { setError('Add document text within the configured character limit before saving.'); return; }
    const cleanTags = [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))];
    if (cleanTags.length > 32 || cleanTags.some(tag => tag.length > 64)) { setError('Use up to 32 tags, with no more than 64 characters per tag.'); return; }
    setBusy(true);
    try {
      const payload = { title: title.trim(), category: category.trim() || 'Runbooks', content: content.trim(), tags: cleanTags, media_type: 'text/markdown', ...(item && { expected_hash: item.content_hash }) };
      const result = mode === 'file' && file
        ? await uploadKnowledgeDoc(file, title.trim(), category.trim() || 'Runbooks', item ? { doc_id: item.id, expected_hash: item.content_hash! } : undefined, cleanTags)
        : item ? await updateKnowledgeDoc(item.id, payload) : await createKnowledgeDoc(payload);
      setSaved(result); reset(); onSaved?.(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The document could not be saved. Your entries and selected file are still here.'); }
    finally { setBusy(false); }
  };

  return <div className="knowledge-editor">
    {error && <p className="knowledge-message is-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
    {saved && <div className="knowledge-message is-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{saved.title} saved as a draft.</strong><p>Review the extracted content in Knowledge, then submit it for approval.</p>{saved.upload?.warnings.length ? <ul>{saved.upload.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</div></div>}
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend className="knowledge-visually-hidden">{item ? 'Edit document' : 'Add document'}</legend>
        <div className="knowledge-form-row"><label>Document title<input required maxLength={256} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Category<input maxLength={128} value={category} onChange={event => setCategory(event.target.value)} placeholder="Runbooks" /></label></div>
        <label>Content source<select value={mode} onChange={event => setMode(event.target.value as 'file' | 'text')}><option value="file">{item ? 'Replace with an uploaded file' : 'Upload a file'}</option><option value="text">{item ? 'Edit document text' : 'Write or paste text'}</option></select></label>
        {mode === 'file' ? <section className="knowledge-upload">
          <label><span><Upload size={16} aria-hidden="true" /> Choose a local document</span><input key={fileKey} type="file" required accept={limits?.allowed_extensions.join(',')} disabled={!limits} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>
          {limits ? <><p>Supported: {limits.allowed_extensions.join(', ')}. Up to {(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB per file.</p><p>Text is extracted for review. Images contribute text through OCR only. Original files are retained for download.</p></> : limitsError ? <div role="alert"><p>{limitsError}</p><button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry upload settings</button></div> : <p role="status">Loading upload settings…</p>}
          {file && <p>Selected: <strong>{file.name}</strong> · {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</p>}
        </section> : <><label>Document text<textarea required rows={12} maxLength={limits ? Math.min(limits.max_text_chars, 1_000_000) : 1_000_000} value={content} onChange={event => setContent(event.target.value)} /></label><p>{content.length.toLocaleString()} characters{limits && <> · limit {Math.min(limits.max_text_chars, 1_000_000).toLocaleString()}</>}</p>{limitsError && <div role="alert"><p>{limitsError}</p><button type="button" className="btn btn-secondary" onClick={() => void loadLimits()}>Retry document settings</button></div>}</>}
        <label>Tags<input maxLength={2079} value={tags} onChange={event => setTags(event.target.value)} aria-describedby="knowledge-tags-help" /></label><p id="knowledge-tags-help">Separate tags with commas. Up to 32 tags, with 64 characters per tag.</p>
        {item?.status === 'approved' && <p>Saving an edit returns this document to draft. Investigations will use it again after a new approval.</p>}
        <div className="knowledge-actions"><button type="submit" className="btn btn-primary" disabled={busy || !limits || (mode === 'file' && !file)}>{busy ? 'Saving document…' : 'Save document draft'}</button>{(onCancel || dirty) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { reset(); onCancel?.(); }}>{dirty ? 'Discard changes' : 'Cancel'}</button>}</div>
        <p>Drafts are saved to this project. Only approved documents are used in new investigations.</p>
      </fieldset>
    </form>
  </div>;
};
