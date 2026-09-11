import React, { useState } from 'react';
import { Users as UsersIcon, Shield, UserCheck, Plus, Search } from 'lucide-react';
import { MOCK_USERS } from '../services/api';

export const Users: React.FC = () => {
  const [search, setSearch] = useState('');

  const filtered = MOCK_USERS.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Users & <span>Role Permissions</span>
          </h1>
          <p className="hero-lede">
            Server-side verified principals, tenant role bindings, and dual-custody approval privileges.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{MOCK_USERS.length}</b> Principals Registered
            </span>
            <span className="hero-stat-chip">
              <b>Auth:</b> RS256 JWT Token
            </span>
            <span className="hero-stat-chip">
              <b>Scope:</b> Server Scoped
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button type="button" className="btn btn-primary" title="Invite a team member to tenant scope">
              <Plus size={13} strokeWidth={2.5} /> Invite Member
            </button>
          </div>
        </div>
      </section>

      {/* Role Counts Strip */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Platform Admins</span>
            <Shield size={15} color="var(--acc)" />
          </div>
          <div className="metric-value">1</div>
          <div className="metric-meta">Full root tenant scope</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>SRE Leads</span>
            <UserCheck size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">1</div>
          <div className="metric-meta">Investigation & run authority</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Investigators</span>
            <UsersIcon size={15} color="var(--acc2)" />
          </div>
          <div className="metric-value">1</div>
          <div className="metric-meta">Read & diagnostic access</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>SecOps Officers</span>
            <Shield size={15} color="var(--acc-amber)" />
          </div>
          <div className="metric-value">1</div>
          <div className="metric-meta">Audit & review privileges</div>
        </div>
      </div>

      {/* Compact Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            type="search"
            placeholder="Search members by name, email, or role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="count-badge">
          <b>{filtered.length}</b> principals registered
        </div>
      </div>

      {/* Users Table */}
      <div className="card" style={{ padding: 0, height: 'auto' }}>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role Assignment</th>
                <th>Status</th>
                <th>Investigations</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="user-avatar" style={{ width: '24px', height: '24px', fontSize: '10.5px' }}>
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 650, fontSize: '12.5px' }}>{user.name}</div>
                        <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-active">{user.role}</span>
                  </td>
                  <td>
                    <span className="badge badge-healthy">{user.status.toUpperCase()}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{user.investigations_count}</td>
                  <td style={{ color: 'var(--dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {user.last_active}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
