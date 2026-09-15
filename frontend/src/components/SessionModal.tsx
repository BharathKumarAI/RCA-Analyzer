import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldAlert, X } from 'lucide-react';
import { Principal } from '../types/api';
import { ApiError, getSessionToken, setSessionToken, fetchPrincipal } from '../services/api';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const authenticated = Boolean(principal.subject);

  useEffect(() => {
    setTokenInput(isOpen ? getSessionToken() || '' : '');
    setError(null);
  }, [isOpen, principal.subject]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') || []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && authenticated && !loading) { onClose(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable(); if (!elements.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused.current?.focus(); previouslyFocused.current = null; };
  }, [isOpen, loading, onClose, authenticated]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (loading) return;
    setError(null); setLoading(true);
    if (!tokenInput.trim()) {
      if (!authenticated) { setError('Paste a session token to connect.'); setLoading(false); return; }
      setSessionToken(null); setTokenInput(''); onSignedOut?.(); setLoading(false); return;
    }
    setSessionToken(tokenInput);
    try { const next = await fetchPrincipal(); onAuthenticated?.(next); onSessionChanged?.(); setTokenInput(''); onClose(); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Session verification failed';
      setSessionToken(null);
      if (!(reason instanceof ApiError && reason.status === 0)) setTokenInput('');
      setError(message);
      onSignedOut?.(message);
    }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!loading) onClose(); }}>
      <div ref={dialogRef} className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="session-title" aria-describedby="session-description" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={18} color="var(--acc)" />
            <h2 id="session-title" style={{ fontSize: '16px', fontWeight: 600 }}>{authenticated ? 'Session details' : 'Connect your session'}</h2>
          </div>
          {authenticated && <button type="button" className="icon-btn" aria-label="Close session dialog" onClick={onClose} disabled={loading}><X size={16} /></button>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p id="session-description" style={{ color: 'var(--muted)', fontSize: '12px' }}>{authenticated ? 'Your authenticated identity and assigned roles are shown below.' : 'Paste a session token to access RCA Analyzer.'}</p>
          {(error || sessionError) && <div role="alert" style={{ color: 'var(--acc-rose)', fontSize: '12px' }}>{error || sessionError}</div>}
          {authenticated && <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--card-subtle)', border: '1px solid var(--line)', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--muted)' }}>Subject</span>
              <span style={{ fontWeight: 600 }}>{principal.subject}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)' }}>Assigned Roles</span>
              <span className="badge badge-active">{principal.roles.join(', ')}</span>
            </div>
          </div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
              Session token
            </label>
            <textarea
              aria-label="Session bearer token"
              rows={4}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Paste your deployment JWT"
              style={{ width: '100%', padding: '10px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldAlert size={12} />
                Token stays in memory and resets when this page refreshes.
              </span>

            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          {authenticated && <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => { setSessionToken(null); setTokenInput(''); onSignedOut?.(); }}>Sign out</button>}
          {authenticated && <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Close</button>}
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? 'Verifying…' : tokenInput.trim() ? 'Connect session' : authenticated ? 'Sign out' : 'Connect session'}
          </button>
        </div>
      </div>
    </div>
  );
};
