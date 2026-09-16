import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import type { AuthProviders, Principal } from '../types/api';
import { ApiError, fetchAuthProviders, fetchPrincipal, getSessionToken, logoutSession, setSessionToken } from '../services/api';
import './SessionModal.css';

const localLoginPath = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/v1/auth/') ? url.pathname + url.search : null;
  } catch { return null; }
};

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  principal: Principal;
  onUpdatePrincipal?: (principal: Principal) => void;
  onSessionChanged?: () => void;
  onAuthenticated?: (principal: Principal) => void;
  onSignedOut?: (reason?: string) => void;
  sessionError?: string | null;
}

export const SessionModal: React.FC<SessionModalProps> = ({ isOpen, onClose, principal, onSessionChanged, onAuthenticated, onSignedOut, sessionError }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerRetry, setProviderRetry] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const authenticated = Boolean(principal.subject);
  const loginPath = providers?.configured ? localLoginPath(providers.login_path) : null;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setTokenInput(''); setError(null); setProviderError(null);
    void fetchAuthProviders().then(value => { if (!cancelled) setProviders(value); }).catch(reason => { if (!cancelled) setProviderError(reason instanceof Error ? reason.message : 'Sign-in options could not load.'); });
    return () => { cancelled = true; };
  }, [isOpen, providerRetry]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], summary') || []).filter(element => element.getClientRects().length > 0);
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

  const connectToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!tokenInput.trim()) { setError('Paste an administrator session token to connect.'); return; }
    setError(null); setLoading(true);
    try { setSessionToken(tokenInput); const next = await fetchPrincipal(); onAuthenticated?.(next); onSessionChanged?.(); setTokenInput(''); onClose(); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Session verification failed';
      setSessionToken(null);
      if (!(reason instanceof ApiError && reason.status === 0)) setTokenInput('');
      setError(message); onSignedOut?.(message);
    } finally { setLoading(false); }
  };
  const signOut = async () => {
    if (loading) return;
    setLoading(true); setError(null);
    try { await logoutSession(); setTokenInput(''); onSignedOut?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign out could not finish. Try again.'); }
    finally { setLoading(false); }
  };

  return <div className="modal-overlay" onClick={() => { if (authenticated && !loading) onClose(); }}>
    <div ref={dialogRef} className="modal-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-title" aria-describedby="session-description" onClick={event => event.stopPropagation()}>
      <div className="session-heading"><KeyRound size={20} aria-hidden="true" /><h2 id="session-title">{authenticated ? 'Your session' : 'Sign in to RCA assist'}</h2>{authenticated && <button type="button" className="icon-btn" aria-label="Close session dialog" onClick={onClose} disabled={loading}><X size={16} /></button>}</div>
      <p id="session-description">{authenticated ? 'Your account determines which project and settings you can access.' : 'Use your company account to open your assigned workspace.'}</p>
      {(error || sessionError) && <p className="session-error" role="alert">{error || sessionError}</p>}
      {authenticated ? <dl className="session-identity"><dt>Account</dt><dd>{principal.subject}</dd><dt>Project</dt><dd>{principal.project_id}</dd><dt>Access</dt><dd>{principal.roles.map(role => role.replace(/_/g, ' ').toLowerCase()).join(', ')}</dd><dt>Signed in with</dt><dd>{getSessionToken() ? 'Administrator session token' : 'Company account'}</dd></dl> : <section className="session-company-signin">
        {loginPath ? <a className="btn btn-primary" href={loginPath}>Continue with {providers?.name || 'company sign-in'}</a> : providerError ? <div role="alert"><p>{providerError}</p><button type="button" className="btn btn-secondary" onClick={() => setProviderRetry(value => value + 1)}>Retry sign-in options</button></div> : providers ? <p>Company sign-in has not been configured. Ask your platform administrator to set it up.</p> : <p role="status">Loading company sign-in…</p>}
      </section>}
      <details className="session-token-access"><summary>Administrator access</summary><p>Use a session token only when your administrator has provided one. It stays in memory and is cleared on refresh.</p><form onSubmit={connectToken}><label htmlFor="session-bearer-token">Session token</label><textarea id="session-bearer-token" aria-label="Session bearer token" rows={3} disabled={loading} autoComplete="off" spellCheck={false} value={tokenInput} onChange={event => setTokenInput(event.target.value)} /><button type="submit" className="btn btn-secondary" disabled={loading || !tokenInput.trim()}>{loading ? 'Verifying…' : 'Connect session'}</button></form></details>
      <div className="session-footer">{authenticated ? <><button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void signOut()}>{loading ? 'Signing out…' : 'Sign out'}</button><button type="button" className="btn btn-primary" onClick={onClose} disabled={loading}>Done</button></> : <a className="btn btn-secondary" href="/">Back to RCA assist</a>}</div>
    </div>
  </div>;
};
