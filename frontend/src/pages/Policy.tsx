import React, { useState } from 'react';
import {
  ShieldAlert,
  Lock,
  EyeOff,
  CheckCircle2,
  XCircle,
  FileText,
  AlertTriangle,
  Play,
  Copy,
  Check,
  Ban,
  Filter,
  Layers,
  Wrench
} from 'lucide-react';

export const Policy: React.FC = () => {
  const [sampleLog, setSampleLog] = useState<string>(
    `2026-09-11T16:22:04Z [ERROR] Failed auth handshake: Authorization="Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID" user="john.doe@enterprise.com" ssn="123-45-6789" api_key="sk-live-992384a8b7c6" db_uri="postgres://admin:SuperSecretPass123@db.prod.internal:5432/orders"`
  );
  const [redactedLog, setRedactedLog] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Redaction logic mirroring app/policy/redaction.py
  const performRedaction = (text: string): string => {
    let res = text;
    // Bearer token
    res = res.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
    // API keys & passwords
    res = res.replace(/(password|passwd|secret|token|api[_-]?key)([\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)/gi, '$1$2[REDACTED]');
    // Email
    res = res.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, '[EMAIL]');
    // SSN
    res = res.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
    // URI user:pass
    res = res.replace(/(https?:\/\/|postgres:\/\/|mysql:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
    return res;
  };

  const handleTestRedaction = () => {
    setRedactedLog(performRedaction(sampleLog));
  };

  const handleCopyRedacted = () => {
    navigator.clipboard.writeText(redactedLog || performRedaction(sampleLog));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Policy, <span>Guardrails & Redaction</span>
          </h1>
          <p className="hero-lede">
            Deterministic PII & credential redaction engine, strict tool-calling boundaries, read-only connectors, and bounded attachment ingestion controls.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Connector Guard:</b> Read-Only (Jira & Splunk)
            </span>
            <span className="hero-stat-chip">
              <b>Remote Network Fetch:</b> STRICTLY PROHIBITED
            </span>
            <span className="hero-stat-chip">
              <b>Code Execution:</b> STRICTLY PROHIBITED
            </span>
            <span className="hero-stat-chip">
              <b>Source:</b> app/policy/redaction.py
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleTestRedaction}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Play size={13} /> Run Live Redaction Test
          </button>
        </div>
      </section>

      {/* Interactive Redaction Sandbox Card */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <EyeOff size={15} style={{ color: 'var(--acc)' }} /> Deterministic PII & Secret Redactor Sandbox
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
            Evaluated before raw text ever enters ADK agent contexts or SQLite/PostgreSQL stores
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>
              Input Source Log / Stack Trace (Contains Sensitive Data)
            </label>
            <textarea
              value={sampleLog}
              onChange={e => setSampleLog(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '11px',
                fontFamily: 'monospace',
                lineHeight: 1.5,
                resize: 'none'
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                Redacted Model-Visible Output
              </label>
              <button
                type="button"
                onClick={handleCopyRedacted}
                style={{ fontSize: '10px', background: 'none', border: 'none', color: 'var(--acc)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy Output'}
              </button>
            </div>
            <div
              style={{
                width: '100%',
                height: '84px',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(16,185,129,0.3)',
                background: 'rgba(16,185,129,0.03)',
                color: '#10b981',
                fontSize: '11px',
                fontFamily: 'monospace',
                lineHeight: 1.5,
                overflowY: 'auto'
              }}
            >
              {redactedLog || performRedaction(sampleLog)}
            </div>
          </div>
        </div>
      </div>

      {/* Safety Matrix & Attachment Limits Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left: Tool Calling Guardrails */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Wrench size={15} style={{ color: 'var(--acc)' }} /> Connector Tool Call Guardrails
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '12px', borderRadius: '6px', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: '#10b981' }}>ITSM Provider (Jira)</span>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>
                  READ-ONLY
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                Permits calling <code>itsm.get_ticket(ticket_id)</code> within configured Jira project scope. Ticket creation, comment posting, and status updates are strictly denied.
              </p>
            </div>

            <div style={{ padding: '12px', borderRadius: '6px', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: '#10b981' }}>Log Search Provider (Splunk)</span>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>
                  READ-ONLY BOUNDED
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                Permits calling <code>log_search.query_range(query, time_range)</code> within configured Splunk index. Bounded query window (e.g. -15m) enforced by connector provider.
              </p>
            </div>

            <div style={{ padding: '12px', borderRadius: '6px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: '#ef4444' }}>Database Connector (SQL)</span>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                  DISABLED BY POLICY
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                Database querying is disabled until its dedicated read-only connector and explain plan sandbox are implemented.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Attachment Ingestion Limits */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldAlert size={15} style={{ color: 'var(--acc)' }} /> Attachment Ingestion & Safety Bounds
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max File Size</span>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>8 MB / file</span>
            </div>
            <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max Upload Batch</span>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>20 files (32 MB)</span>
            </div>
            <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max PDF Pages</span>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>50 pages max</span>
            </div>
            <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Parser Timeout</span>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>20.0 seconds</span>
            </div>
          </div>

          <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 4px 0' }}>Allowed File Extensions</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {['.txt', '.md', '.log', '.json', '.csv', '.tsv', '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp'].map(ext => (
                <span key={ext} style={{ fontSize: '10px', background: 'var(--card)', padding: '2px 6px', borderRadius: '3px', border: '1px solid var(--line)', fontFamily: 'monospace' }}>
                  {ext}
                </span>
              ))}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '8px', display: 'block' }}>
              Images undergo local Tesseract OCR for text extraction only. No visual scene understanding or code execution.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
