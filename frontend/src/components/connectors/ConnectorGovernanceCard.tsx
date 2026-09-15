import React from 'react';
import { Shield, ShieldAlert, Check, AlertCircle } from 'lucide-react';
import type { ConnectorGovernanceCardProps } from './types';

export const ConnectorGovernanceCard: React.FC<ConnectorGovernanceCardProps> = ({
  supportedOperations = [],
  isPolicyBlocked = false,
  policyMessage,
  readAccessRole = 'All',
  writeAccessRole = 'Project Analyst',
}) => {
  return (
    <div className="prism-governance-section">
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Shield size={15} style={{ color: 'var(--acc, #2563eb)' }} />
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx, #0f172a)', margin: 0 }}>
            Permissions &amp; Access
          </h4>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted, #475569)', margin: 0 }}>
          Connector operations and access governance
        </p>
      </div>

      {/* Access Governance Roles Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '6px',
            background: 'var(--card-subtle, #f8fafc)',
            border: '1px solid var(--line, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '11.5px', color: 'var(--muted, #64748b)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Incident Triage Access
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: '4px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontSize: '12px',
                color: '#065f46',
                fontWeight: 600,
              }}
            >
              <Check size={12} /> Read-Only ({readAccessRole})
            </span>
          </div>
          <span style={{ display: 'block', fontSize: '11px', color: 'var(--muted, #475569)', marginTop: '4px' }}>
            Read, search, and incident evidence lookup available to authorized project members. No write mutations.
          </span>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: '6px',
            background: 'var(--card-subtle, #f8fafc)',
            border: '1px solid var(--line, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '11.5px', color: 'var(--muted, #64748b)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Connector Configuration
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: '4px',
                background: 'rgba(37, 99, 235, 0.1)',
                border: '1px solid rgba(37, 99, 235, 0.3)',
                fontSize: '12px',
                color: '#1e40af',
                fontWeight: 600,
              }}
            >
              <Shield size={12} /> Minimum: Project Manager / Owner
            </span>
          </div>
          <span style={{ display: 'block', fontSize: '11px', color: 'var(--muted, #475569)', marginTop: '4px' }}>
            Configuring connectors and credentials requires project administrative authorization.
          </span>
        </div>
      </div>

      {/* Policy Blocked Callout */}
      {isPolicyBlocked && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            padding: '12px 14px',
            marginBottom: '14px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            fontSize: '12.5px',
            color: '#b91c1c',
            lineHeight: 1.5,
          }}
        >
          <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#dc2626' }} />
          <div>
            <strong style={{ color: '#991b1b' }}>Policy-Restricted Integration:</strong>
            <p style={{ margin: '4px 0 0', color: '#b91c1c' }}>
              {policyMessage ||
                'Database querying and live execution are blocked by organizational governance policy. Project instances cannot be activated or queried while blocked.'}
            </p>
          </div>
        </div>
      )}

      {/* Declared Supported Operations */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx, #1e293b)', marginBottom: '8px' }}>
          Supported Operations
        </div>
        {supportedOperations.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: 'var(--card-subtle, #f8fafc)',
              border: '1px dashed var(--line-strong, #cbd5e1)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--muted, #475569)',
            }}
          >
            <AlertCircle size={14} />
            No automated operations declared for this connector.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {supportedOperations.map(op => (
              <span
                key={op}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  background: 'rgba(37, 99, 235, 0.08)',
                  border: '1px solid rgba(37, 99, 235, 0.25)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#1d4ed8',
                  fontWeight: 600,
                }}
              >
                <Check size={12} style={{ color: '#2563eb' }} /> {op}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Read-Only Governance Banner */}
      <div
        style={{
          padding: '10px 14px',
          background: 'rgba(217, 119, 6, 0.08)',
          border: '1px solid rgba(217, 119, 6, 0.25)',
          borderRadius: 6,
          fontSize: '12px',
          color: '#854d0e',
          lineHeight: '1.5',
        }}
      >
        <strong style={{ color: '#78350f' }}>Strictly Read-Only:</strong> Incident workflows query Jira issues and comments using read-only service principles. Write operations, issue creation, and modification are forbidden in this release.
      </div>
    </div>
  );
};
