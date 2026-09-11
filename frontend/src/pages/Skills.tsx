import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, ShieldCheck } from 'lucide-react';
import { ApiError, fetchSkills } from '../services/api';

type Skill = { id: string; name?: string; status?: string; size_bytes?: number; sha256?: string; source?: string; immutable?: boolean; allowed_actions?: string[]; project_override?: boolean; user_override?: boolean };

export const Skills: React.FC = () => {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = async () => { setError(null); try { const data = await fetchSkills(); setSkills(data); setSelectedId(current => current && data.some(skill => skill.id === current) ? current : data[0]?.id || null); } catch (reason: unknown) { setError(reason instanceof ApiError ? reason.message : 'Unable to load skills.'); } };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => (skills || []).filter(skill => `${skill.id} ${skill.name || ''} ${skill.status || ''}`.toLowerCase().includes(query.toLowerCase())), [skills, query]);
  const selected = filtered.find(skill => skill.id === selectedId) || filtered[0];
  return <div className="view-container">
    <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Skill <span>Catalog</span></h1><p className="hero-lede">Server registered skill definitions available to the scoped workflow.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><BookOpen size={13} /><b>{skills?.length ?? '—'}</b> registered skills</span><span className="hero-stat-chip"><b>Writes:</b> server managed</span></div></div></section>
    {error && <div className="card" style={{ color: 'var(--danger)' }}>{error} <button className="btn btn-secondary" onClick={() => void load()}>Retry</button></div>}
    <div className="toolbar"><div className="search-box"><Search size={14} /><input type="search" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)} /></div><span className="count-badge"><b>{filtered.length}</b> results</span></div>
    {!skills && !error ? <div className="card empty-state">Loading skills…</div> : !filtered.length ? <div className="card empty-state">No skills match this search.</div> : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, .8fr) minmax(360px, 1.4fr)', gap: 16 }}><div className="card" style={{ padding: 0, height: 'auto' }}>{filtered.map(skill => <button key={skill.id} type="button" onClick={() => setSelectedId(skill.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line)', background: skill.id === selected?.id ? 'var(--acc-subtle)' : 'transparent', color: 'var(--text)', padding: 14, cursor: 'pointer' }}><strong>{skill.name || skill.id}</strong><small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>{skill.status || 'configured'} · {skill.size_bytes ? `${skill.size_bytes} bytes` : 'size unavailable'}</small></button>)}</div><article className="card" style={{ height: 'auto' }}><div className="card-title-row"><h2 className="card-title">{selected?.name || selected?.id}</h2><span className="badge badge-active">{selected?.status || 'configured'}</span></div><div className="card-meta-pills"><span className="meta-pill"><ShieldCheck size={12} /> {selected?.immutable ? 'Immutable' : 'Mutable metadata'}</span><span className="meta-pill">Project override: {selected?.project_override ? 'allowed' : 'disabled'}</span><span className="meta-pill">User override: {selected?.user_override ? 'allowed' : 'disabled'}</span></div><p style={{ color: 'var(--muted)' }}>Source: {selected?.source || 'server managed'}</p><p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, overflowWrap: 'anywhere' }}>SHA-256: {selected?.sha256 || 'not reported'}</p><h3 style={{ fontSize: 12, textTransform: 'uppercase' }}>Allowed actions</h3>{selected?.allowed_actions?.length ? <div className="card-meta-pills">{selected.allowed_actions.map(action => <span className="meta-pill" key={action}>{action}</span>)}</div> : <p style={{ color: 'var(--muted)' }}>No actions declared.</p>}</article></div>}
  </div>;
};
