import { useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { fetchUsers } from '../services/api';

type User = Awaited<ReturnType<typeof fetchUsers>>[number];
export function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  async function load() {
    setLoading(true); setError(null);
    try { setUsers(await fetchUsers()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load users.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = users.filter(user => [user.id, user.name, ...user.roles].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="view-container">
    <header className="page-header"><div><h1>Users &amp; <span>Access</span></h1><p className="page-subtitle">Configured identities in this deployment’s tenant and project.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button></header>
    {error && <div className="notice-banner" role="alert">{error}</div>}
    <div className="metric-grid">
      <div className="metric-card"><div className="metric-label-row">Configured users <UsersIcon size={15} /></div><div className="metric-value">{loading ? '—' : users.length}</div><p className="metric-meta">Server-side deployment memberships</p></div>
      <div className="metric-card"><div className="metric-label-row">Assigned roles <ShieldCheck size={15} /></div><div className="metric-value">{loading ? '—' : new Set(users.flatMap(user => user.roles)).size}</div><p className="metric-meta">Distinct roles across these users</p></div>
    </div>
    <div className="toolbar"><label className="search-box"><Search size={14} /><input type="search" aria-label="Search users" placeholder="Search users or roles…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Subject</th><th>Roles</th><th>Membership</th></tr></thead><tbody>
      {filtered.map(user => <tr key={user.id}><td>{user.name || user.id}</td><td>{user.id}</td><td><div className="settings-tags">{user.roles.map(role => <span className="badge badge-neutral" key={role}>{role.replaceAll('_', ' ')}</span>)}</div></td><td><span className="badge badge-active">{user.status}</span></td></tr>)}
      {!filtered.length && <tr><td colSpan={4}>{loading ? 'Loading users…' : error ? 'User data is unavailable.' : 'No matching users.'}</td></tr>}
    </tbody></table></div>
    <p className="metric-meta">Membership changes are deployment-managed. Roles cannot be assigned through this interface.</p>
  </div>;
}
