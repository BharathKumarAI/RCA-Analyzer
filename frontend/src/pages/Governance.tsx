import React from 'react';
import {
  ShieldCheck,
  Lock,
  Fingerprint,
  AlertTriangle,
  ArrowUpRight
} from 'lucide-react';
import { AuditLog, AgentConfiguration } from '../types/api';

interface GovernanceProps {
  logs: AuditLog[];
  agents: AgentConfiguration[];
}

export const Governance: React.FC<GovernanceProps> = ({ logs, agents }) => {
  const pendingAgents = agents.filter(a => a.status === 'pending');

  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Governance & <span>Compliance Audit</span>
          </h1>
          <p className="hero-lede">
            Cryptographic audit logs, two-person rule enforcement for specialist models, and immutable tenant isolation boundaries.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Dual-Custody:</b> 100% Enforced
            </span>
            <span className="hero-stat-chip">
              <b>Pending Review:</b> {pendingAgents.length} Agents
            </span>
            <span className="hero-stat-chip">
              <b>Audit Log:</b> Immutable Append-Only
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <span className="badge badge-active">RS256 JWT Enforced</span>
          </div>
        </div>
      </section>

      {/* Security Policies Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--acc3)' }}>
            <Lock size={16} />
            <span style={{ fontWeight: 700, fontSize: '13.5px' }}>Tenant Boundary Isolation</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Hard deployment tenant and project scope. Self-assigned identities and cross-tenant data transfers are strictly rejected by RS256 token verification.
          </p>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--acc)' }}>
            <Fingerprint size={16} />
            <span style={{ fontWeight: 700, fontSize: '13.5px' }}>Content-Hashed Approvals</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Every specialist configuration is stored by sha256 digest. Dual-custody approvals verify the exact digest to prevent race condition tampering.
          </p>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--acc-amber)' }}>
            <ShieldCheck size={16} />
            <span style={{ fontWeight: 700, fontSize: '13.5px' }}>Dual-Custody Segregation</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
            An author cannot approve their own specialist agent. A distinct peer administrator must validate and endorse the candidate definition.
          </p>
        </div>
      </div>

      {/* Pending Approval Queue */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={18} color="var(--acc-amber)" />
            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Pending Dual-Custody Approval Queue</h3>
          </div>
          <span className="badge badge-pending">{pendingAgents.length} pending review</span>
        </div>

        {pendingAgents.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--dim)', fontSize: '13.5px' }}>
            No agent configurations currently awaiting peer review.
          </div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingAgents.map((agent, i) => (
              <div
                key={agent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'var(--card-subtle)',
                  border: '1px solid var(--line-strong)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="num">00{i + 1}</div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>{agent.name}</span>
                      <span className="brand-badge">{agent.role}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--dim)', marginTop: '4px' }}>
                      Author: <strong>{agent.author}</strong> · Content Hash: <code style={{ fontFamily: 'var(--font-mono)' }}>{agent.content_hash}</code>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-open"
                  onClick={() => window.location.hash = 'agents'}
                >
                  Review Candidate <ArrowUpRight size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cryptographic Audit Trail */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Chained Cryptographic Audit Trail</h3>
            <span style={{ fontSize: '12px', color: 'var(--dim)' }}>Immutable SHA-256 HMAC verification log</span>
          </div>
        </div>

        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp (UTC)</th>
                <th>Actor Principal</th>
                <th>Action</th>
                <th>Resource Target</th>
                <th>Outcome</th>
                <th>Cryptographic Hash</th>
                <th>Evaluation Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                    {log.timestamp}
                  </td>
                  <td style={{ fontWeight: 650 }}>{log.actor}</td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>{log.resource}</td>
                  <td>
                    <span className={`badge badge-${log.outcome === 'SUCCESS' ? 'active' : 'deprecated'}`}>
                      {log.outcome}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--acc)' }}>
                    {log.hash}
                  </td>
                  <td style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
