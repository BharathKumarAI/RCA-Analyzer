import React, { useEffect, useRef, useState } from 'react';
import { getSessionGeneration } from '../services/api';
import { exportOkf, fetchOkfBundles, importOkf, previewOkf, type OkfBundle, type OkfPreview } from '../services/okf';
import type { KnowledgeItem } from '../types/api';

export function KnowledgeOkfExchange({ items, canManage, onImported }: { items: KnowledgeItem[]; canManage: boolean; onImported: () => void }) {
  const [bundles, setBundles] = useState<OkfBundle[]>([]);
  const [bundleId, setBundleId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OkfPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<'zip' | 'markdown'>('zip');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const generation = getSessionGeneration();
    fetchOkfBundles().then(value => { if (alive.current && generation === getSessionGeneration()) setBundles(value); }).catch(cause => { if (alive.current) setError(cause instanceof Error ? cause.message : 'Bundles could not load. Refresh the page to retry.'); });
    return () => { alive.current = false; };
  }, [items]);
  useEffect(() => {
    if (!busy) return;
    const guard = (event: Event) => event.preventDefault();
    window.addEventListener('rca:before-navigation', guard); window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', guard); };
  }, [busy]);
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice('');
    const generation = getSessionGeneration();
    const current = () => alive.current && generation === getSessionGeneration();
    try { await action(current); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The operation failed. Your selected file is preserved.'); }
    finally { active.current = false; if (current()) setBusy(false); }
  };
  const exportable = items.filter(item => item.content_hash && (includeDrafts || (item.status === 'approved' && item.okf_eligibility?.eligible !== false)));
  const selectedItems = exportable.filter(item => selected.includes(item.id));

  return <details className="okf-exchange">
    <summary>Import and export Open Knowledge Format</summary>
    <p>Exchange local Markdown concepts or ZIP bundles. Imported instructions and verification claims remain reference data. Every import starts as a draft.</p>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}
    {notice && <p className="knowledge-message is-success" role="status">{notice}</p>}
    <div className="feedback-workspace">
      <section className="knowledge-editor"><h3>Import a bundle</h3>
        {canManage ? <fieldset disabled={busy}>
          <label>Destination<select value={bundleId} onChange={event => { setBundleId(event.target.value); setPreview(null); }}><option value="">Create a new bundle</option>{bundles.map(bundle => <option key={bundle.bundle_id} value={bundle.bundle_id}>{bundle.name} · revision {bundle.revision}</option>)}</select></label>
          <label>Local Markdown or ZIP<input type="file" accept=".md,.zip" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
          <button type="button" className="btn btn-secondary" disabled={!file} onClick={() => void run(async current => { const result = await previewOkf(file!, bundleId || undefined); if (current()) setPreview(result); })}>{busy ? 'Working…' : 'Preview import'}</button>
          {preview && <>
            <p>{preview.concepts.length} concepts · {preview.navigation.length} navigation files. Review the content and diagnostics before importing.</p>
            {preview.diagnostics.length > 0 && <ul>{preview.diagnostics.map((note, index) => <li key={index}><strong>{note.path}</strong>: {note.message}</li>)}</ul>}
            <div className="okf-preview">{preview.concepts.map(concept => <details key={concept.path}><summary>{concept.operation === 'update' ? 'Update' : 'Create'} · {concept.path}</summary><h4>{concept.title}</h4><pre className="knowledge-content">{concept.content}</pre><details><summary>Metadata</summary><pre className="knowledge-content">{JSON.stringify(concept.metadata, null, 2)}</pre></details></details>)}{preview.navigation.map(item => <details key={item.path}><summary>Navigation · {item.path}</summary><pre className="knowledge-content">{item.content}</pre></details>)}</div>
            <button type="button" className="btn btn-primary" disabled={!file || !preview.concepts.length} onClick={() => void run(async current => { const result = await importOkf(file!, preview); if (current()) { setNotice(`Imported ${result.documents.length} draft documents. Review them in the library before requesting approval.`); setPreview(null); onImported(); } })}>Import reviewed drafts</button>
          </>}
        </fieldset> : <p>A project owner or administrator can import knowledge bundles.</p>}
      </section>
      <section className="knowledge-editor"><h3>Export project knowledge</h3><fieldset disabled={busy}>
        {canManage && <label className="okf-checkbox"><input type="checkbox" checked={includeDrafts} onChange={event => { setIncludeDrafts(event.target.checked); setSelected([]); }} />Include drafts and documents without active approval</label>}
        {includeDrafts && <p>These exports carry draft status. The recipient must review them before use.</p>}
        <label>Documents<select multiple size={Math.min(8, Math.max(3, exportable.length))} value={selected} onChange={event => setSelected(Array.from(event.target.selectedOptions, option => option.value))}>{exportable.map(item => <option key={item.id} value={item.id}>{item.title} · {item.status}{item.okf_concept_path ? ` · ${item.okf_concept_path}` : ''}</option>)}</select></label>
        {!exportable.length && <p>No eligible documents are available. Approve a document to export it.</p>}
        <label>Format<select value={format} onChange={event => setFormat(event.target.value as 'zip' | 'markdown')}><option value="zip">ZIP bundle</option><option value="markdown">One Markdown concept</option></select></label>
        <p>{selectedItems.length} documents selected. Markdown requires one document; ZIP preserves concept paths and bundle references.</p>
        <button type="button" className="btn btn-secondary" disabled={!selectedItems.length || (format === 'markdown' && selectedItems.length !== 1)} onClick={() => void run(async current => {
          const result = await exportOkf(selectedItems, format, includeDrafts);
          if (!current()) return;
          const url = URL.createObjectURL(result.blob); const link = document.createElement('a');
          link.href = url; link.download = format === 'zip' ? 'project-knowledge.zip' : 'concept.md'; link.click(); URL.revokeObjectURL(url);
          setNotice(result.diagnostics ? `Export downloaded. Export diagnostics: ${result.diagnostics}` : 'Export downloaded.');
        })}>Download export</button>
      </fieldset></section>
    </div>
  </details>;
}
