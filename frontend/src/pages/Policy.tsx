import React, { useEffect, useState } from 'react';
import {
  EyeOff,
  Play,
  RefreshCw,
  ShieldAlert,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import { fetchPolicy, updatePolicy } from '../services/api';
import type { PolicyConfig, RedactionPattern } from '../types/api';

export const Policy: React.FC = () => {
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Redaction patterns state
  const [patterns, setPatterns] = useState<RedactionPattern[]>([]);
  const [newPatternName, setNewPatternName] = useState('');
  const [newPatternRegex, setNewPatternRegex] = useState('');
  const [newPatternReplacement, setNewPatternReplacement] = useState('[REDACTED]');
  const [showAddPatternModal, setShowAddPatternModal] = useState(false);

  // Guardrails state
  const [guardrails, setGuardrails] = useState({
    dual_custody_enforced: false,
    max_tool_call_depth: 8,
    request_deadline_seconds: 120,
    write_protection_active: true,
    blocked_keywords: [] as string[],
  });
  const [keywordInput, setKeywordInput] = useState('');

  // Sandbox state
  const [sampleLog, setSampleLog] = useState(
    '2026-09-12 12:00:01 [WARN] Auth failure for user admin@payments-inc.com with token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-zK password=Secret1234! ssn=123-45-6789 from ip 192.168.1.50'
  );
  const [redacted, setRedacted] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPolicy();
      setPolicy(data);
      setPatterns(data.redaction_patterns || []);
      setGuardrails({
        dual_custody_enforced: data.guardrails?.dual_custody_enforced ?? false,
        max_tool_call_depth: data.guardrails?.max_tool_call_depth ?? 8,
        request_deadline_seconds: data.guardrails?.request_deadline_seconds ?? 120,
        write_protection_active: data.guardrails?.write_protection_active ?? true,
        blocked_keywords: data.guardrails?.blocked_keywords ?? [
          'drop database',
          'drop table',
          'truncate',
          'rm -rf',
          'format',
          'eval(',
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load policy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(null);
    try {
      const updated = await updatePolicy({
        redaction_patterns: patterns,
        guardrails: guardrails,
      });
      setPolicy(updated);
      setPatterns(updated.redaction_patterns || []);
      setSaveSuccess('Policy & guardrails saved and applied to active orchestrator successfully!');
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const togglePattern = (name: string) => {
    setPatterns(prev =>
      prev.map(p => (p.name === name ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const deletePattern = (name: string) => {
    setPatterns(prev => prev.filter(p => p.name !== name));
  };

  const handleAddPattern = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatternName.trim() || !newPatternRegex.trim()) return;

    // Validate regex
    try {
      new RegExp(newPatternRegex.trim());
    } catch {
      setError(`Invalid regular expression syntax: ${newPatternRegex}`);
      return;
    }

    setPatterns(prev => [
      ...prev,
      {
        id: newPatternName.trim().toLowerCase().replace(/\s+/g, '_'),
        name: newPatternName.trim(),
        pattern: newPatternRegex.trim(),
        replacement: newPatternReplacement.trim() || '[REDACTED]',
        enabled: true,
        description: 'Custom administrator regex pattern',
      },
    ]);
    setNewPatternName('');
    setNewPatternRegex('');
    setNewPatternReplacement('[REDACTED]');
    setShowAddPatternModal(false);
  };

  const handleAddKeyword = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && keywordInput.trim()) {
      e.preventDefault();
      const kw = keywordInput.trim().toLowerCase();
      if (!guardrails.blocked_keywords.includes(kw)) {
        setGuardrails(g => ({ ...g, blocked_keywords: [...g.blocked_keywords, kw] }));
      }
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    setGuardrails(g => ({
      ...g,
      blocked_keywords: g.blocked_keywords.filter(k => k !== kw),
    }));
  };

  const runSandbox = () => {
    let result = sampleLog;
    let count = 0;
    for (const p of patterns) {
      if (!p.enabled) continue;
      try {
        const rx = new RegExp(p.pattern, 'gi');
        const matches = result.match(rx);
        if (matches) count += matches.length;
        result = result.replace(rx, p.replacement);
      } catch {
        // Ignore bad regex at runtime in sandbox
      }
    }
    setRedacted(result);
    setMatchCount(count);
  };

  const rules =
    policy?.skills && typeof policy.skills === 'object'
      ? Object.entries(policy.skills).filter(([, raw]) => raw && typeof raw === 'object')
      : [];

  return (
    <div className="view-container">
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Policy, <span>Guardrails & Redaction</span>
          </h1>
          <p className="hero-lede">
            Configure declarative security parameters, PII sanitization regex rules, and operational execution guardrails.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Active Patterns:</b>{' '}
              {patterns.filter(p => p.enabled).length} / {patterns.length}
            </span>
            <span className="hero-stat-chip">
              <Lock size={12} style={{ color: 'var(--acc)' }} />{' '}
              <b>Write Protection:</b> {guardrails.write_protection_active ? 'Strict Read-Only' : 'Permissive'}
            </span>
            <span className="hero-stat-chip">
              <Sliders size={12} /> <b>Deadline:</b> {guardrails.request_deadline_seconds}s
            </span>
          </div>
        </div>
        <div className="hero-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={loading || saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={13} /> {saving ? 'Saving...' : 'Save Policy Changes'}
          </button>
        </div>
      </section>

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {saveSuccess && (
        <NotificationBanner
          type="success"
          message={saveSuccess}
          onClose={() => setSaveSuccess(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Grid: Redaction Manager & Guardrails */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Redaction Patterns Manager */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <EyeOff size={16} style={{ color: 'var(--acc)' }} /> Data Sanitization & PII Redaction
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                Regex patterns evaluated against logs, prompts, and tool outputs prior to LLM submission.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setShowAddPatternModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Plus size={13} /> Add Pattern
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '8px 10px' }}>Pattern Name</th>
                  <th style={{ padding: '8px 10px' }}>Regex Expression</th>
                  <th style={{ padding: '8px 10px' }}>Replacement</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Enabled</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map(p => (
                  <tr key={p.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '10px', fontWeight: 500 }}>
                      <code>{p.name}</code>
                    </td>
                    <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.pattern}>
                      {p.pattern}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                        {p.replacement}
                      </span>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={() => togglePattern(p.name)}
                        style={{ cursor: 'pointer', transform: 'scale(1.15)' }}
                      />
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => deletePattern(p.name)}
                        title="Delete pattern"
                        style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Execution Guardrails Panel */}
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={16} style={{ color: 'var(--acc)' }} /> Execution Guardrails
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
            Hard limits and authorization gates enforced during automated investigation runs.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Write Protection */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 8, border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>Strict Write Protection</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Blocks mutation tools across all connectors</div>
              </div>
              <input
                type="checkbox"
                checked={guardrails.write_protection_active}
                onChange={e => setGuardrails(g => ({ ...g, write_protection_active: e.target.checked }))}
                style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
              />
            </div>

            {/* Dual Custody */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 8, border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>Dual Custody Required</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Requires secondary admin approval for privileged runs</div>
              </div>
              <input
                type="checkbox"
                checked={guardrails.dual_custody_enforced}
                onChange={e => setGuardrails(g => ({ ...g, dual_custody_enforced: e.target.checked }))}
                style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
              />
            </div>

            {/* Depth & Timeout Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Max Tool Call Depth
                </label>
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={guardrails.max_tool_call_depth}
                  onChange={e => setGuardrails(g => ({ ...g, max_tool_call_depth: parseInt(e.target.value, 10) || 1 }))}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Request Deadline (s)
                </label>
                <input
                  type="number"
                  min="10"
                  max="600"
                  value={guardrails.request_deadline_seconds}
                  onChange={e => setGuardrails(g => ({ ...g, request_deadline_seconds: parseInt(e.target.value, 10) || 10 }))}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>

            {/* Blocked Keywords */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                Restricted Query Keywords / Shell Syntax
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, minHeight: 32 }}>
                {guardrails.blocked_keywords.map(kw => (
                  <span
                    key={kw}
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <code>{kw}</code>
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, fontSize: 12 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type keyword and press Enter..."
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={handleAddKeyword}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Local Redaction Sandbox */}
      <div className="card" style={{ padding: 22, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Sparkles size={15} style={{ color: 'var(--acc)' }} /> Real-Time Redaction Sandbox
          </h3>
          {redacted && (
            <span style={{ fontSize: 12, color: 'var(--acc)', fontWeight: 500 }}>
              {matchCount} token(s) sanitized across {patterns.filter(p => p.enabled).length} active rules
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              Raw Log or Query Payload:
            </label>
            <textarea
              aria-label="Log text to redact"
              value={sampleLog}
              onChange={e => {
                setSampleLog(e.target.value);
                setRedacted(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 12,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 12,
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={runSandbox}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Play size={12} /> Test Redaction Rules
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              Sanitized Output Preview:
            </label>
            <pre
              aria-live="polite"
              style={{
                margin: 0,
                padding: 12,
                minHeight: 110,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: '#10b981',
                background: 'rgba(16,185,129,0.03)',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              {redacted ?? 'Run redaction to preview sanitized text with all enabled regex patterns.'}
            </pre>
          </div>
        </div>
      </div>

      {/* Effective Skill Rules */}
      <div className="card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <ShieldAlert size={15} style={{ color: 'var(--acc)' }} /> Effective Declared Skills
        </h3>
        {loading ? (
          <p style={{ color: 'var(--muted)' }}>Loading policy…</p>
        ) : rules.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No skill rules are configured.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {rules.map(([name, raw]: [string, any]) => (
              <div
                key={name}
                style={{
                  padding: 14,
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--surface-sunken)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  <div><b>Actions:</b> {(raw.actions || []).join(', ') || 'none'}</div>
                  <div style={{ marginTop: 2 }}>
                    <b>Access:</b>{' '}
                    {raw.immutable
                      ? 'Immutable'
                      : raw.project_override
                      ? 'Project override allowed'
                      : 'Platform controlled'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Add Redaction Pattern */}
      {showAddPatternModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              width: 480,
              maxWidth: '90vw',
              padding: 24,
              border: '1px solid var(--line)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Add Redaction Pattern</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Specify a regular expression pattern to detect and scrub sensitive identifiers.
            </p>

            <form onSubmit={handleAddPattern}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Rule Identifier Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. aws_secret_key"
                  required
                  value={newPatternName}
                  onChange={e => setNewPatternName(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Regular Expression Pattern *
                </label>
                <input
                  type="text"
                  placeholder="e.g. (AKIA[0-9A-Z]{16})"
                  required
                  value={newPatternRegex}
                  onChange={e => setNewPatternRegex(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Replacement Mask
                </label>
                <input
                  type="text"
                  value={newPatternReplacement}
                  onChange={e => setNewPatternReplacement(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowAddPatternModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Pattern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
