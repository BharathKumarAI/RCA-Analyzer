import React, { useEffect, useState } from 'react';
import { Building, CheckCircle2, RefreshCw, Shield } from 'lucide-react';
import { fetchRoles } from '../services/api';

type Role = { id: string; name: string };

export const Roles: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const value = await fetchRoles();
      const next = Array.isArray(value) ? value.filter(r => r?.id && r?.name) : [];
      setRoles(next); setSelected(current => next.find(r => r.id === current?.id) || next[0] || null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load roles'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <div className="view-container">
    <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Roles, <span>RBAC & Dual-Custody</span> Governance</h1><p className="hero-lede">Server-owned roles and scope validation for the active deployment.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><span className="dot pulse" /> <b>Configured roles:</b> {loading ? 'Loading…' : roles.length}</span><span className="hero-stat-chip"><b>Source:</b> server policy</span></div></div><div className="hero-actions"><button type="button" className="btn btn-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={13} /> Refresh</button></div></section>
    <div className="notice-banner blue" style={{ marginBottom: 20 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><Building size={18} style={{ color: 'var(--acc)' }} /><h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Immutable server-owned scoping</h3></div><p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>The API validates issuer, audience, deployment scope, and server-side subject membership. Roles and project scope are never accepted from request bodies.</p></div>
    {error && <div className="notice-banner red" role="alert">{error} <button className="btn btn-outline" onClick={() => void load()}>Retry</button></div>}
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, alignItems: 'start' }}><div className="card" style={{ padding: 16 }}><h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', color: 'var(--muted)' }}>Configured roles</h3>{loading ? <p style={{ color: 'var(--muted)' }}>Loading server roles…</p> : roles.length === 0 ? <p style={{ color: 'var(--muted)' }}>No roles are configured for this deployment.</p> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{roles.map(role => <button type="button" key={role.id} onClick={() => setSelected(role)} style={{ textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer', border: selected?.id === role.id ? '1px solid var(--acc)' : '1px solid var(--line)', background: selected?.id === role.id ? 'var(--acc-subtle)' : 'var(--card)', color: 'var(--text)' }}><b>{role.name}</b><code style={{ display: 'block', marginTop: 5, color: 'var(--muted)' }}>{role.id}</code></button>)}</div>}</div><div className="card" style={{ padding: 20 }}>{selected ? <><div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 14, marginBottom: 16 }}><Shield size={18} style={{ color: 'var(--acc)' }} /><h2 style={{ fontSize: 18, margin: 0 }}>{selected.name}</h2></div><p style={{ color: 'var(--muted)', fontSize: 13 }}>This role identifier is supplied by the authenticated deployment policy. Effective permissions are evaluated server-side for each capability and project scope.</p><div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontSize: 12 }}><CheckCircle2 size={14} /> Request roles cannot override this assignment</div></> : <p style={{ color: 'var(--muted)' }}>Select a configured role to inspect its server-defined identifier.</p>}</div></div>
  </div>;
};
