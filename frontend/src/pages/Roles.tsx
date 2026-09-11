import React, { useState } from 'react';
import {
  KeyRound,
  Shield,
  Users,
  CheckCircle2,
  XCircle,
  Lock,
  FileCheck2,
  Building,
  Key,
  Info,
  Check,
  Search,
  Award
} from 'lucide-react';
import { Principal, SystemRole } from '../types/api';

interface RoleTier {
  role: string;
  level: number;
  title: string;
  description: string;
  category: 'Administration' | 'Operations' | 'Analysis' | 'Auditing & Compliance';
}

const ROLE_TIERS: RoleTier[] = [
  {
    role: 'PLATFORM_ADMIN',
    level: 100,
    title: 'Platform Administrator',
    description: 'Full global governance, platform bundle configuration, secrets, and root infrastructure controls.',
    category: 'Administration'
  },
  {
    role: 'TENANT_ADMIN',
    level: 80,
    title: 'Tenant Administrator',
    description: 'Tenant-level scoping, dual-custody specialist approvals, and project configuration delegation.',
    category: 'Administration'
  },
  {
    role: 'PROJECT_OWNER',
    level: 60,
    title: 'Project Owner',
    description: 'Manages project-level YAML, capability enablement, and connector resource scopes.',
    category: 'Operations'
  },
  {
    role: 'PROJECT_MANAGER',
    level: 50,
    title: 'Project Manager',
    description: 'Supervises triage throughput, SLA commitments, and resource consumption.',
    category: 'Operations'
  },
  {
    role: 'OPERATOR',
    level: 45,
    title: 'Site Reliability Operator',
    description: 'Operates day-to-day triage workflows, executes pre-approved runbooks, and cancels stuck jobs.',
    category: 'Operations'
  },
  {
    role: 'PROJECT_ANALYST',
    level: 40,
    title: 'Incident Analyst / SRE',
    description: 'Initiates RCA investigations, uploads diagnostic files, and validates generated root-cause findings.',
    category: 'Analysis'
  },
  {
    role: 'SKILL_AUTHOR',
    level: 30,
    title: 'Specialist & Skill Author',
    description: 'Submits custom project specialist agent YAML drafts and skill specifications for dual-custody review.',
    category: 'Analysis'
  },
  {
    role: 'AUDITOR',
    level: 20,
    title: 'Compliance Auditor',
    description: 'Read-only access to immutable audit records, redaction provenance, and MLflow experiment runs.',
    category: 'Auditing & Compliance'
  },
  {
    role: 'PROJECT_VIEWER',
    level: 15,
    title: 'Project Viewer',
    description: 'Views historical investigation reports and generated postmortems within assigned project scope.',
    category: 'Auditing & Compliance'
  },
  {
    role: 'GENERIC_VIEWER',
    level: 10,
    title: 'Generic Viewer',
    description: 'Minimal dashboard visibility without access to sensitive ticket details or raw log queries.',
    category: 'Auditing & Compliance'
  }
];

interface PermissionAction {
  id: string;
  name: string;
  description: string;
  minLevel: number;
  dualCustodyRequired: boolean;
}

const PERMISSION_ACTIONS: PermissionAction[] = [
  {
    id: 'run_investigation',
    name: 'Trigger RCA Investigation',
    description: 'Submit POST /api/v1/runs with incident context or attachments.',
    minLevel: 40,
    dualCustodyRequired: false
  },
  {
    id: 'upload_attachments',
    name: 'Upload Incident Files & Logs',
    description: 'Submit multipart files to /api/v1/files for bounded parsing & OCR.',
    minLevel: 40,
    dualCustodyRequired: false
  },
  {
    id: 'author_specialist',
    name: 'Author Specialist Agent Drafts',
    description: 'Submit YAML specialist definitions to /api/v1/agent-configurations.',
    minLevel: 30,
    dualCustodyRequired: false
  },
  {
    id: 'approve_specialist',
    name: 'Dual-Custody Specialist Approval',
    description: 'Approve pending agent YAML with expected SHA-256 (author cannot self-approve).',
    minLevel: 80,
    dualCustodyRequired: true
  },
  {
    id: 'view_evidence',
    name: 'Inspect Raw Redacted Evidence',
    description: 'Query saved evidence items and log correlation matches.',
    minLevel: 40,
    dualCustodyRequired: false
  },
  {
    id: 'inspect_audit',
    name: 'Audit Log & Provenance Review',
    description: 'Review compliance logs, RS256 token claims, and redaction hashes.',
    minLevel: 20,
    dualCustodyRequired: false
  },
  {
    id: 'system_settings',
    name: 'Modify Runtime & Connector Settings',
    description: 'Configure Jira/Splunk credentials, retention periods, and storage paths.',
    minLevel: 100,
    dualCustodyRequired: true
  }
];

export const Roles: React.FC = () => {
  const [selectedRole, setSelectedRole] = useState<RoleTier>(ROLE_TIERS[0]);
  const [simulatedLevel, setSimulatedLevel] = useState<number>(100);

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Roles, <span>RBAC & Dual-Custody</span> Governance
          </h1>
          <p className="hero-lede">
            Strict hierarchical access control, server-owned scope validation, RS256 cryptographic identity verification, and non-self dual-custody approval boundaries.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Security Hierarchy:</b> 10 Discrete Tiers (10 → 100)
            </span>
            <span className="hero-stat-chip">
              <b>Auth Standard:</b> RS256 JWT (No client-supplied scopes)
            </span>
            <span className="hero-stat-chip">
              <b>Dual-Custody:</b> Required for Agent YAML & Prompt Promotions
            </span>
            <span className="hero-stat-chip">
              <b>Source:</b> app/policy/rbac.py
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--card)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <Key size={14} style={{ color: 'var(--acc)' }} />
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Simulate Tier:</span>
            <select
              value={simulatedLevel}
              onChange={e => {
                const lvl = parseInt(e.target.value, 10);
                setSimulatedLevel(lvl);
                const found = ROLE_TIERS.find(r => r.level === lvl);
                if (found) setSelectedRole(found);
              }}
              style={{
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--line)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              {ROLE_TIERS.map(r => (
                <option key={r.role} value={r.level}>
                  {r.title} ({r.level})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Scoping Architecture Card */}
      <div className="notice-banner blue" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Building size={18} style={{ color: 'var(--acc)' }} />
          <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>
            Immutable Server-Owned Scoping Guarantee
          </h3>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
          In accordance with RCA Analyzer security principles, a deployment has exactly one configured tenant/project scope derived from server environment variables (<code>RCA_TENANT_ID</code> and <code>RCA_PROJECT_ID</code>). The API validates RS256 token issuer, audience, and server-side subject membership prior to execution. <b>Never does the service accept roles, tenant, project, or connector scopes from a client request body.</b>
        </p>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
            <CheckCircle2 size={13} /> Issuer & Audience Validation
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
            <CheckCircle2 size={13} /> Server-Side Principals JSON
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
            <CheckCircle2 size={13} /> Client Scope Spoofing Prevented
          </span>
        </div>
      </div>

      {/* Main Content Layout: Role Tiers List + Permissions Matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left: Role Tiers */}
        <div className="card" style={{ padding: '16px', height: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Role Hierarchy (10 Levels)
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '680px', overflowY: 'auto' }}>
            {ROLE_TIERS.map(tier => {
              const isSelected = selectedRole.role === tier.role;
              return (
                <div
                  key={tier.role}
                  onClick={() => {
                    setSelectedRole(tier);
                    setSimulatedLevel(tier.level);
                  }}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--acc-subtle)' : 'var(--card)',
                    transition: 'all .15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                      {tier.title}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '10px',
                      background: tier.level >= 80 ? 'rgba(239,68,68,0.15)' : tier.level >= 40 ? 'rgba(59,130,246,0.15)' : 'rgba(156,163,175,0.15)',
                      color: tier.level >= 80 ? '#ef4444' : tier.level >= 40 ? '#3b82f6' : 'var(--muted)',
                      border: `1px solid ${tier.level >= 80 ? '#ef4444' : tier.level >= 40 ? '#3b82f6' : 'var(--line)'}`
                    }}>
                      Tier {tier.level}
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                    {tier.description}
                  </p>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', display: 'flex', gap: '6px' }}>
                    <code style={{ background: 'var(--bg)', padding: '1px 4px', borderRadius: '3px' }}>{tier.role}</code>
                    <span>•</span>
                    <span>{tier.category}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Permissions & Dual Custody Matrix */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Active Role Card */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={18} style={{ color: 'var(--acc)' }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{selectedRole.title}</h2>
                  <span style={{ fontSize: '12px', background: 'var(--bg)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--line)', fontWeight: 700 }}>
                    Tier {selectedRole.level} / 100
                  </span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '4px 0 0 0' }}>{selectedRole.description}</p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>Category</span>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{selectedRole.category}</span>
              </div>
            </div>

            {/* Permissions Table */}
            <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Evaluated Action Permissions Matrix
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {PERMISSION_ACTIONS.map(action => {
                const isAllowed = selectedRole.level >= action.minLevel;
                return (
                  <div
                    key={action.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: isAllowed ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
                      border: isAllowed ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)'
                    }}
                  >
                    <div style={{ flex: 1, paddingRight: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                          {action.name}
                        </span>
                        {action.dualCustodyRequired && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700 }}>
                            DUAL-CUSTODY (NON-SELF)
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--muted)', margin: 0 }}>
                        {action.description}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        Requires Tier {action.minLevel}+
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: isAllowed ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: isAllowed ? '#10b981' : '#ef4444'
                        }}
                      >
                        {isAllowed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {isAllowed ? 'PERMITTED' : 'DENIED'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dual Custody Rule Callout */}
          <div className="card" style={{ padding: '18px', background: 'var(--bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <FileCheck2 size={16} style={{ color: '#f59e0b' }} />
              <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                Dual-Custody Approval Protocol (Expected Hash Verification)
              </h4>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Specialist agents submitted at <code>/api/v1/agent-configurations</code> are pinned by their SHA-256 content hash in <code>framework/objects/agents/</code>. Approval requires an independent administrator of same-scope with Tier &ge; 80 (<code>PLATFORM_ADMIN</code> or <code>TENANT_ADMIN</code>) other than the author. Authors cannot self-approve. Rejection or revocation immediately removes the specialist from active discovery.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
