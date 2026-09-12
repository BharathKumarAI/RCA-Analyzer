import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert, X } from 'lucide-react';
import { Principal } from '../types/api';
import { getSessionToken, setSessionToken, fetchPrincipal } from '../services/api';

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  principal: Principal;
  onUpdatePrincipal?: (p: Principal) => void;
  onSessionChanged?: () => void;
  onAuthenticated?: (principal: Principal) => void;
  onSignedOut?: (reason?: string) => void;
  sessionError?: string | null;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  onClose,
  principal,
  onUpdatePrincipal: _onUpdatePrincipal,
  onSessionChanged,
  onAuthenticated,
  onSignedOut,
  sessionError,
}) => {
  const [tokenInput, setTokenInput] = useState(getSessionToken() || '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTokenInput(isOpen ? getSessionToken() || '' : '');
    setError(null);
  }, [isOpen, principal.subject]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (loading) return;
    setError(null); setLoading(true);
    if (!tokenInput.trim()) { setSessionToken(null); setTokenInput(''); onSignedOut?.(); setLoading(false); return; }
    setSessionToken(tokenInput);
    try { const next = await fetchPrincipal(); onAuthenticated?.(next); onSessionChanged?.(); setTokenInput(''); onClose(); }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'Session verification failed'; setSessionToken(null); setTokenInput(''); setError(message); onSignedOut?.(message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!loading) onClose(); }}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="session-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={18} color="var(--accent-cyan)" />
            <h2 id="session-title" style={{ fontSize: '16px', fontWeight: 600 }}>Active Authentication Session</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close session dialog" onClick={onClose} disabled={loading}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(error || sessionError) && <div role="alert" style={{ color: 'var(--acc-rose)', fontSize: '12px' }}>{error || sessionError}</div>}
          <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Subject</span>
              <span style={{ fontWeight: 600 }}>{principal.subject}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tenant / Project Scope</span>
              <span style={{ fontWeight: 600 }}>{principal.tenant_id} / {principal.project_id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Assigned Roles</span>
              <span className="badge badge-active">{principal.roles.join(', ')}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              In-Memory Bearer Token (RS256 JWT)
            </label>
            <textarea
              aria-label="Session bearer token"
              rows={4}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Paste Bearer JWT token (held strictly in-memory, never written to disk or storage)..."
              style={{ width: '100%', padding: '10px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldAlert size={12} />
                Zero client persistence: Token resets on page refresh. Sent via Authorization: Bearer header.
              </span>

            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? 'Verifying…' : tokenInput.trim() ? 'Verify Session Token' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
};
