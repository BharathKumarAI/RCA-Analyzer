import React, { useEffect, useState } from 'react';
import { BookOpen, HardDrive } from 'lucide-react';
import { ApiError, fetchKnowledge } from '../services/api';

export const Knowledge: React.FC = () => {
  const [sources, setSources] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); fetchKnowledge().then(setSources).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Unable to load knowledge sources.')); };
  useEffect(load, []);
  return <div className="view-container"><section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Knowledge & <span>Runbook Corpus</span></h1><p className="hero-lede">Scoped local knowledge artifacts reported by the backend.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><BookOpen size={13} /><b>{sources?.length ?? '—'}</b> sources</span></div></div></section><div className="metric-grid"><div className="metric-card"><div className="metric-label-row"><span>Stored sources</span><HardDrive size={15} color="var(--acc)" /></div><div className="metric-value">{sources?.length ?? '—'}</div><div className="metric-meta">Persisted local attachments</div></div></div>{error && <div className="card">{error} <button className="btn btn-secondary" onClick={load}>Retry</button></div>}<div className="card-list">{!sources && !error ? <div className="card empty-state">Loading sources…</div> : sources?.length === 0 ? <div className="card empty-state">No retained attachments are available.</div> : sources?.map(source => <article className="card" key={source.id}><div className="card-title-row"><h2 className="card-title">{source.title || source.name || source.id}</h2><span className="badge badge-active">{source.status || 'stored'}</span></div><div className="card-meta-pills"><span className="meta-pill">{source.media_type || 'file'}</span><span className="meta-pill">{source.size_bytes ? `${Math.round(source.size_bytes / 1024)} KB` : 'size unavailable'}</span></div></article>)}</div></div>;
};
