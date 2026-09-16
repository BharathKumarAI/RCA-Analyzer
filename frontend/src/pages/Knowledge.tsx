import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Download, Plus, RefreshCw, Search } from 'lucide-react';
import { downloadKnowledgeDoc, fetchKnowledge, fetchPrincipal, getSessionGeneration, reviewKnowledgeDoc } from '../services/api';
import type { KnowledgeItem, Principal } from '../types/api';
import { KnowledgeDocumentForm } from '../components/KnowledgeDocumentForm';
import { KnowledgeOkfExchange } from '../components/KnowledgeOkfExchange';
import { KnowledgeBatchUpload } from '../components/KnowledgeBatchUpload';
import { AnswerMarkdown } from '../components/AnswerMarkdown';
import { documentTopic, knowledgeTopics, KnowledgeTopicFilter } from '../components/KnowledgeTopicFilter';
import { KnowledgeCaptureSource } from '../components/KnowledgeCaptureSource';
import { KnowledgeIntake } from '../components/KnowledgeIntake';
import '../styles/knowledge.css';

type ReviewAction = 'submit' | 'approve' | 'reject' | 'revoke';
const statusLabel = (status: string) => ({ draft: 'Draft', pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked', stored: 'Stored attachment', active: 'Needs review' })[status] ?? status;
const reviewLabel = (action: ReviewAction) => ({ submit: 'Submit for approval', approve: 'Approve document', reject: 'Reject document', revoke: 'Revoke approval' })[action];

export const Knowledge: React.FC<{ onOpenImprovement: () => void; onOpenRun: (id: string) => void | Promise<void>; onOpenAlerts: () => void }> = ({ onOpenImprovement, onOpenRun, onOpenAlerts }) => {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const alive = useRef(false);
  const loadVersion = useRef(0);
  const article = useRef<HTMLElement>(null);
  const selected = items.find(item => item.id === selectedId) ?? null;
  const canManage = principal?.roles.some(role => role === 'PLATFORM_ADMIN' || role === 'PROJECT_OWNER') ?? false;

  const load = async () => {
    const version = ++loadVersion.current;
    const generation = getSessionGeneration();
    try {
      const [documents, me] = await Promise.all([fetchKnowledge(), fetchPrincipal()]);
      if (!alive.current || version !== loadVersion.current || generation !== getSessionGeneration()) return;
      setItems(documents); setPrincipal(me); setError(null);
      setSelectedId(current => documents.some(item => item.id === current) ? current : documents[0]?.id ?? null);
    } catch (cause) { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Knowledge could not load. Refresh to try again.'); }
    finally { if (alive.current && version === loadVersion.current && generation === getSessionGeneration()) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadVersion.current++; }; }, []);
  useEffect(() => {
    if (!busy && !reason) return;
    const preventNavigation = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for the current action to finish.' : 'Complete or cancel the review before leaving this document.'); };
    const preventClose = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('rca:before-navigation', preventNavigation);
    window.addEventListener('beforeunload', preventClose);
    return () => { window.removeEventListener('rca:before-navigation', preventNavigation); window.removeEventListener('beforeunload', preventClose); };
  }, [busy, reason]);
  const canLeave = () => window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }));
  const select = (id: string) => {
    if (!canLeave()) return;
    setSelectedId(id); setEditor(null); setReviewAction(null); setReason(''); setError(null); setNotice(null);
  };
  const startNew = () => {
    if (!canLeave()) return;
    setEditor('new'); setReviewAction(null); setReason(''); setError(null); setNotice(null);
  };
  const saved = (item: KnowledgeItem) => {
    setItems(current => current.some(value => value.id === item.id) ? current.map(value => value.id === item.id ? item : value) : [item, ...current]);
    setSelectedId(item.id); setEditor(null); setQuery(''); setStatusFilter('all'); setTopic(null);
    setNotice(item.upload_match ? `This file already exists as revision ${item.upload_match.revision}. Current revision ${item.upload_match.current_revision} and its approval are unchanged.` : 'Document saved as a draft. Review the content, then submit it for approval.');
  };
  const review = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected?.content_hash || !reviewAction || !reason.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const item = await reviewKnowledgeDoc(selected.id, reviewAction, selected.content_hash, reason.trim());
      setItems(current => current.map(value => value.id === item.id ? item : value));
      setReviewAction(null); setReason('');
      setNotice(item.status === 'approved' ? 'Document approved. It is available to new project investigations.' : item.status === 'pending' ? 'Document submitted. A different project owner or platform admin must review it.' : 'Review saved. This document is not used in new investigations.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The review could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  const download = async () => {
    if (!selected?.upload || busy) return;
    setBusy(true); setError(null);
    try {
      const url = URL.createObjectURL(await downloadKnowledgeDoc(selected.id));
      const link = document.createElement('a'); link.href = url; link.download = selected.upload.filename; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The original file could not be downloaded. Try again.'); }
    finally { setBusy(false); }
  };
  const filtered = items.filter(item => (topic === null || documentTopic(item) === topic) && (statusFilter === 'all' || item.status === statusFilter) && [item.title, item.category, documentTopic(item), item.content, ...item.tags].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const openDocumentLink = (href: string) => {
    if (!href.startsWith('#')) return;
    const target = document.getElementById(`guide-${href.slice(1)}`);
    if (target && article.current?.contains(target)) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  };

  return <div className="view-container knowledge-page">
    <header className="knowledge-header"><div><h1>Project knowledge</h1><p>Give investigations trusted runbooks, documents and reference material.</p></div><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={() => { if (canLeave()) { setLoading(true); void load(); } }}><RefreshCw size={16} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button>{canManage && <button type="button" className="btn btn-primary" disabled={busy || editor === 'new'} onClick={startNew}><Plus size={16} aria-hidden="true" />Add document</button>}</div></header>
    <p>Upload or write a document, review its content, then request approval. Only approved knowledge is used in new investigations.</p>
    {!loading && canManage && principal && <KnowledgeIntake principal={principal} onDocumentsChanged={() => void load()} onOpenImprovement={onOpenImprovement} onOpenRun={onOpenRun} onOpenAlerts={onOpenAlerts} />}
    {!loading && <KnowledgeOkfExchange items={items} canManage={canManage} onImported={() => void load()} />}
    {!loading && canManage && <KnowledgeBatchUpload onUploaded={() => void load()} />}
    {error && <div className="knowledge-message is-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
    {notice && <div className="knowledge-message is-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span></div>}
    {loading && !items.length ? <div className="knowledge-loading" role="status">Loading project knowledge…</div> : <div className="knowledge-workspace">
      <aside className="knowledge-library" aria-label="Knowledge library">
        <div className="knowledge-library-controls"><h2>Loaded documents <span>{items.length}</span></h2><p>Search and topic counts cover the loaded library, up to 500 documents.</p><label className="knowledge-search"><Search size={16} aria-hidden="true" /><span className="knowledge-visually-hidden">Search documents</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents" /></label><KnowledgeTopicFilter items={items} value={topic} onChange={value => { if (canLeave()) { setTopic(value); setSelectedId(null); } }} /><label>Show<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All loaded documents</option>{['draft', 'pending', 'approved', 'rejected', 'revoked', 'stored'].map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div>
        {filtered.length ? <ul>{filtered.map(item => <li key={item.id}><button type="button" className={selectedId === item.id && editor !== 'new' ? 'is-selected' : ''} aria-pressed={selectedId === item.id && editor !== 'new'} onClick={() => select(item.id)}><strong>{item.title}</strong><span>{documentTopic(item) || 'Unclassified'} · {item.category}</span><span className="knowledge-status">{statusLabel(item.status)}</span></button></li>)}</ul> : <div className="knowledge-empty"><BookOpen size={24} aria-hidden="true" /><h3>{items.length ? 'No matching documents' : 'Add your first document'}</h3><p>{items.length ? 'Try another search or show all documents.' : canManage ? 'Start with a runbook that helps your team investigate incidents.' : 'A project owner can add documents for your team.'}</p>{items.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setTopic(null); }}>Clear filters</button>}</div>}
      </aside>
      <section ref={article} className="knowledge-detail" aria-label="Document details">
        {editor === 'new' || (editor === 'edit' && selected) ? <><header><h2>{editor === 'new' ? 'Add project knowledge' : 'Edit document'}</h2><p>Save a draft first. Review and approval happen before this content is used.</p></header><KnowledgeDocumentForm key={editor === 'edit' ? selected!.id : 'new'} item={editor === 'edit' ? selected! : undefined} topics={knowledgeTopics(items).map(item => item.topic)} onSaved={saved} onCancel={() => setEditor(null)} /></> : selected ? <>
          <header className="knowledge-document-header"><div><h2>{selected.title}</h2><p>{selected.category}{selected.revision != null && <> · Revision {selected.revision}</>}</p></div><span className="knowledge-status">{statusLabel(selected.status)}</span></header>
          {selected.author_subject && <section className="knowledge-review"><h3>Approval history</h3><p>Added by <strong>{selected.author_subject}</strong>{selected.reviewer_subject && <> · Reviewed by <strong>{selected.reviewer_subject}</strong></>}</p>{selected.review_reason && <p className="knowledge-review-reason">{selected.review_reason}</p>}{selected.status === 'pending' && <p>{selected.can_review ? 'Review the full content before making a decision.' : 'A different project owner or platform admin must review this version.'}</p>}</section>}
          {selected.needs_revision && <p className="knowledge-message">Save this document as a draft before submitting it for approval.</p>}
          <KnowledgeCaptureSource item={selected} />
          {selected.required_associations?.required && selected.status !== 'approved' && <p className="knowledge-message">An approved requirement remains in force for {selected.required_associations.capability_ids.join(', ')}. Matching investigations are blocked until this document is approved again or an independently approved revision removes the requirement.</p>}
          {selected.associations && <section><h3>Available for</h3><p>Environments: {selected.associations.environment_ids.join(', ') || 'All project environments'}</p><p>Capabilities: {selected.associations.capability_ids.join(', ') || 'All authorized capabilities'}</p><p>Connector instances: {selected.associations.connector_instance_ids.join(', ') || 'All configured instances'}</p>{selected.associations.required && <p>Required for the selected capabilities after approval.</p>}</section>}
          {selected.okf && <section><h3>Open Knowledge Format</h3><p>{selected.okf_concept_path}</p>{selected.okf_eligibility && <p>{selected.okf_eligibility.eligible ? 'Eligible for retrieval' : 'Excluded from retrieval'} · Freshness: {selected.okf_eligibility.freshness}. {selected.okf_eligibility.reason}</p>}<details><summary>Imported metadata</summary><pre className="knowledge-content">{JSON.stringify(selected.okf.metadata, null, 2)}</pre></details>{selected.okf.links.length > 0 && <details><summary>Concept references</summary><ul>{selected.okf.links.map((link, index) => <li key={index}>{link.target} · {link.resolved ? 'Present in bundle' : 'Unavailable in bundle'}</li>)}</ul></details>}</section>}
          {reviewAction ? <form className="knowledge-review-form" onSubmit={review}><label>Reason for this action<textarea required rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label><div className="knowledge-actions"><button type="submit" className="btn btn-primary" disabled={busy || !reason.trim()}>{busy ? 'Saving review…' : reviewLabel(reviewAction)}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setReviewAction(null); setReason(''); setError(null); }}>Cancel review</button></div></form> : <div className="knowledge-actions">
            {selected.can_edit && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditor('edit')}>Edit document</button>}
            {selected.can_edit && selected.status === 'draft' && !selected.needs_revision && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setReviewAction('submit')}>Submit for approval</button>}
            {selected.can_review && selected.status === 'pending' && <><button type="button" className="btn btn-primary" disabled={busy} onClick={() => setReviewAction('approve')}>Approve document</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setReviewAction('reject')}>Reject document</button></>}
            {canManage && selected.status === 'approved' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setReviewAction('revoke')}>Revoke approval</button>}
          </div>}
          {selected.upload && <section className="knowledge-source"><h3>Source file</h3><p>{selected.upload.filename} · {(selected.upload.size_bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</p>{selected.upload.original_retained ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void download()}><Download size={16} aria-hidden="true" />Download original</button> : <p>The original file is not retained for this document.</p>}{selected.upload.warnings.length > 0 && <div role="note"><h4>Extraction notes</h4><ul>{selected.upload.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}</section>}
          <section className="docs-content"><h3>{selected.upload ? 'Extracted content' : 'Document content'}</h3><AnswerMarkdown text={selected.content} onDocumentLink={openDocumentLink} /><details><summary>View source text</summary><pre className="knowledge-content">{selected.content}</pre></details></section>
          {selected.tags.length > 0 && <p>Tags: {selected.tags.join(', ')}</p>}
          {selected.content_hash && <details><summary>Version details</summary><p className="knowledge-fingerprint">{selected.content_hash}</p><p>Reviews apply to this exact version. Editing requires a new review.</p></details>}
        </> : <div className="knowledge-empty"><BookOpen size={32} aria-hidden="true" /><h2>Build a trusted reference library</h2><p>Select a document to review it, or add knowledge that your team can use in investigations.</p>{canManage && <button type="button" className="btn btn-primary" onClick={startNew}>Add your first document</button>}</div>}
      </section>
    </div>}
  </div>;
};
