import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Search } from 'lucide-react';
import { AnswerMarkdown } from '../components/AnswerMarkdown';
import { documentTopic, KnowledgeTopicFilter } from '../components/KnowledgeTopicFilter';
import { KnowledgeCaptureSource } from '../components/KnowledgeCaptureSource';
import { fetchKnowledge, getSessionGeneration } from '../services/api';
import type { KnowledgeItem } from '../types/api';
import '../styles/knowledge.css';

interface ProjectDocsProps {
  projectId: string;
  onOpenHandbook: () => void;
  onManage?: () => void;
}

function publishedDocuments(items: KnowledgeItem[]): KnowledgeItem[] {
  return items.filter(item => item.status === 'approved' && Boolean(item.content_hash)
    && !item.needs_revision && item.okf_eligibility?.eligible !== false && item.capture_eligibility?.eligible !== false);
}

function matchingDocuments(items: KnowledgeItem[], query: string, category: string, tag: string, topic: string | null = null): KnowledgeItem[] {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => (topic === null || documentTopic(item) === topic) && (!category || item.category === category) && (!tag || item.tags.includes(tag))
    && (!search || [item.title, item.content, item.category, documentTopic(item), ...item.tags].some(value => value.toLocaleLowerCase().includes(search))));
}

export const ProjectDocs: React.FC<ProjectDocsProps> = ({ projectId, onOpenHandbook, onManage }) => {
  const [documents, setDocuments] = useState<KnowledgeItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [topic, setTopic] = useState<string | null>(null);
  const version = useRef(0);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = ++version.current;
    const generation = getSessionGeneration();
    const controller = new AbortController();
    setLoading(true); setError(''); setDocuments([]);
    fetchKnowledge(controller.signal)
      .then(items => {
        if (current === version.current && generation === getSessionGeneration()) setDocuments(publishedDocuments(items));
      })
      .catch(cause => {
        if (!controller.signal.aborted && current === version.current && generation === getSessionGeneration()) {
          setError(cause instanceof Error ? cause.message : 'Project documents could not load. Refresh to retry.');
        }
      })
      .finally(() => { if (current === version.current && generation === getSessionGeneration()) setLoading(false); });
    return () => { controller.abort(); version.current++; };
  }, [projectId, refresh]);

  const categories = [...new Set(documents.map(item => item.category).filter(Boolean))].sort();
  const tags = [...new Set(documents.flatMap(item => item.tags))].sort();
  const visible = matchingDocuments(documents, query, category, tag, topic);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const hasFilters = Boolean(query || category || tag || topic !== null);
  const openDocumentLink = (href: string) => {
    if (!href.startsWith('#')) return;
    const target = document.getElementById(`guide-${href.slice(1)}`);
    if (target && article.current?.contains(target)) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  return <div className="view-container knowledge-page">
    <header className="knowledge-header">
      <div><h1>Project docs &amp; playbooks</h1><p>Approved guidance for {projectId}. Browse project topics or search by title, content, category and tag.</p></div>
      <div className="knowledge-actions">
        <button type="button" className="btn btn-secondary" onClick={onOpenHandbook}>Platform handbook</button>
        {onManage && <button type="button" className="btn btn-secondary" onClick={onManage}>Manage documents</button>}
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
      </div>
    </header>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}
    {loading ? <p className="knowledge-loading" role="status">Loading project documents…</p> : !error && (documents.length === 0
      ? <div className="knowledge-empty"><BookOpen size={28} aria-hidden="true" /><h2>No approved project documents</h2><p>Documents appear here after independent review and approval in Knowledge. Draft, revoked and ineligible documents are excluded.</p>{onManage && <button type="button" className="btn btn-primary" onClick={onManage}>Open Knowledge</button>}</div>
      : <div className="knowledge-workspace">
        <aside className="knowledge-library" aria-label="Project documents">
          <div className="knowledge-library-controls">
            <h2>Library <span aria-live="polite">{visible.length} of {documents.length} loaded</span></h2><p>Search and topic counts cover the loaded approved library, up to 500 documents.</p>
            <label className="knowledge-search"><Search size={16} aria-hidden="true" /><span className="knowledge-visually-hidden">Search project documents</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search loaded documents" /></label>
            <KnowledgeTopicFilter items={documents} value={topic} onChange={setTopic} />
            <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Tag<select value={tag} onChange={event => setTag(event.target.value)}><option value="">All tags</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            {hasFilters && <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setCategory(''); setTag(''); setTopic(null); }}>Clear filters</button>}
          </div>
          <ul>{visible.map(item => <li key={item.id}><button type="button" aria-pressed={selected?.id === item.id} className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><span>{documentTopic(item) || 'Unclassified'} · {item.category}{item.tags.length > 0 && ` · ${item.tags.join(', ')}`}</span></button></li>)}</ul>
        </aside>
        <article ref={article} className="knowledge-detail docs-content" aria-label={selected?.title || 'Project document'}>
          {selected ? <>
            <header className="knowledge-document-header"><div><h2>{selected.title}</h2><p>{selected.category}{selected.tags.length > 0 && ` · ${selected.tags.join(', ')}`}</p></div><span className="knowledge-status">Approved{selected.revision != null && ` · revision ${selected.revision}`}</span></header>
            <AnswerMarkdown text={selected.content} onDocumentLink={openDocumentLink} />
            <KnowledgeCaptureSource item={selected} />
            <details><summary>Document scope and version</summary>
              <p>Project: {projectId}</p>
              {selected.associations && <>
                <p>Environments: {selected.associations.environment_ids.join(', ') || 'All project environments'}</p>
                <p>Capabilities: {selected.associations.capability_ids.join(', ') || 'All project capabilities'}</p>
                <p>Sources: {selected.associations.connector_instance_ids.join(', ') || 'All project sources'}</p>
              </>}
              {selected.reviewed_at != null && <p>Approved: {new Date(selected.reviewed_at * 1000).toLocaleString()}</p>}
              {selected.upload && <p>Uploaded file: {selected.upload.filename}</p>}
              <p className="knowledge-fingerprint">{selected.content_hash}</p>
            </details>
          </> : <div className="knowledge-empty"><h2>No matching documents</h2><p>Try a different search, category or tag.</p></div>}
        </article>
      </div>)}
  </div>;
};
