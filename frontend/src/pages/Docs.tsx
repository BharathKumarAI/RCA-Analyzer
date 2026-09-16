import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { getSessionGeneration, request } from '../services/api';
import { AnswerMarkdown } from '../components/AnswerMarkdown';
import '../styles/knowledge.css';

interface GuideInfo { id: string; title: string; filename: string }
interface Guide extends GuideInfo { content: string; content_hash: string }

export const Docs: React.FC<{ onOpenProjectDocs?: () => void }> = ({ onOpenProjectDocs }) => {
  const [guides, setGuides] = useState<GuideInfo[]>([]);
  const [selected, setSelected] = useState('index');
  const [guide, setGuide] = useState<Guide | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const version = useRef(0);
  const article = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState('');
  useEffect(() => {
    const current = ++version.current; const generation = getSessionGeneration();
    const controller = new AbortController();
    setLoading(true); setError(''); setGuide(null);
    Promise.all([request<GuideInfo[]>('/api/v1/documentation', { signal: controller.signal }), request<Guide>(`/api/v1/documentation/${encodeURIComponent(selected)}`, { signal: controller.signal })])
      .then(([items, value]) => { if (current === version.current && generation === getSessionGeneration()) { setGuides(items); setGuide(value); } })
      .catch(cause => { if (!controller.signal.aborted && current === version.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Documentation could not load. Refresh to retry.'); })
      .finally(() => { if (current === version.current && generation === getSessionGeneration()) setLoading(false); });
    return () => { controller.abort(); version.current++; };
  }, [selected, refresh]);
  useEffect(() => {
    if (loading || !guide) return;
    const target = (anchor ? document.getElementById(`guide-${anchor}`) : null) ?? article.current;
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [guide, anchor, loading]);
  const openDocumentLink = (href: string) => {
    const [filename, section = ''] = href.split('#');
    const target = filename ? guides.find(item => item.filename === filename) : guide;
    if (!target) return;
    if (target.id === selected && section === anchor) (document.getElementById(`guide-${section}`) ?? article.current)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    setAnchor(section); setSelected(target.id); setError('');
  };
  return <div className="view-container knowledge-page">
    <header className="knowledge-header"><div><h1>Platform handbook</h1><p>Deployment, configuration and operating guides included with this platform. Project documents and playbooks are maintained separately in each workspace.</p></div><div className="knowledge-actions">{onOpenProjectDocs && <button type="button" className="btn btn-secondary" onClick={onOpenProjectDocs}>Project docs &amp; playbooks</button>}<button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</button></div></header>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}
    <div className="knowledge-workspace">
      <aside className="knowledge-library" aria-label="Documentation guides"><div className="knowledge-library-controls"><label className="knowledge-search"><Search size={16} aria-hidden="true" /><span className="knowledge-visually-hidden">Filter guides</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a guide" /></label></div><ul>{guides.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item => <li key={item.id}><button type="button" aria-pressed={selected === item.id} className={selected === item.id ? 'is-selected' : ''} onClick={() => { setAnchor(''); setSelected(item.id); }}>{item.title}</button></li>)}</ul></aside>
      <article ref={article} className="knowledge-detail docs-content" aria-label={guide?.title || 'Guide'}>{loading ? <p role="status">Loading guide…</p> : guide && <><AnswerMarkdown text={guide.content} onDocumentLink={openDocumentLink} /><details><summary>Document version</summary><p className="knowledge-fingerprint">{guide.content_hash}</p><p>Repository source: docs/{guide.filename}. Linked source files and historical references are available in the repository checkout.</p></details></>}</article>
    </div>
  </div>;
};
