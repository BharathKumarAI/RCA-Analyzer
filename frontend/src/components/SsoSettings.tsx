import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import { createSsoConfiguration, fetchSsoConfigurations, reviewSsoConfiguration } from '../services/api';
import type { Principal, SsoConfiguration, SsoDefinition } from '../types/api';
import './SsoSettings.css';

const blankDefinition = (): SsoDefinition => ({ display_name: '', issuer: '', client_id: '', authorization_endpoint: '', token_endpoint: '', jwks_uri: '', redirect_uri: '', token_auth_method: 'client_secret_basic', client_secret_reference: '', scopes: ['openid', 'profile', 'email'], session_ttl_seconds: 3600 });
const endpointFields = [
  ['issuer', 'Issuer URL'], ['authorization_endpoint', 'Authorization URL'], ['token_endpoint', 'Token URL'], ['jwks_uri', 'Signing keys URL'], ['redirect_uri', 'Callback URL'],
] as const;

export const SsoSettings: React.FC<{ principal: Principal }> = ({ principal }) => {
  const [configuration, setConfiguration] = useState<{ active: SsoConfiguration | null; drafts: SsoConfiguration[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [definition, setDefinition] = useState<SsoDefinition>(blankDefinition);
  const [baseline, setBaseline] = useState<SsoDefinition>(blankDefinition);
  const [action, setAction] = useState<'approve' | 'reject' | 'revoke' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const canManage = principal.roles.includes('PLATFORM_ADMIN');
  const records = [...new Map([...(configuration?.active ? [configuration.active] : []), ...(configuration?.drafts ?? [])].map(record => [record.draft_id, record])).values()];
  const selected = records.find(record => record.draft_id === selectedId) ?? null;
  const dirty = (editing && JSON.stringify(definition) !== JSON.stringify(baseline)) || Boolean(reason);

  const load = async () => {
    try {
      const value = await fetchSsoConfigurations(); setConfiguration(value); setError(null);
      setSelectedId(current => current && (value.active?.draft_id === current || value.drafts.some(record => record.draft_id === current)) ? current : value.active?.draft_id ?? value.drafts[0]?.draft_id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in configuration could not load. Try again.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (canManage) void load(); }, [canManage]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for the current action to finish.' : 'Save or discard the sign-in draft before leaving.'); };
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('rca:before-navigation', prevent); window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('rca:before-navigation', prevent); window.removeEventListener('beforeunload', warn); };
  }, [dirty, busy]);
  const canLeave = () => { if (!dirty && !busy) return true; setError('Save or discard your changes before choosing another version.'); return false; };
  const start = () => {
    if (!canLeave()) return;
    const initial = configuration?.active?.definition ?? blankDefinition();
    setDefinition(initial); setBaseline(initial); setEditing(true); setAction(null); setReason(''); setError(null); setNotice(null);
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = await createSsoConfiguration({ ...definition, display_name: definition.display_name.trim(), client_id: definition.client_id.trim(), client_secret_reference: definition.client_secret_reference.trim() });
      setConfiguration(current => ({ active: current?.active ?? null, drafts: [value, ...(current?.drafts ?? [])] })); setSelectedId(value.draft_id); setEditing(false);
      setNotice('Sign-in configuration saved for review. A different platform admin must approve it. The current provider stays active until approval.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The sign-in draft could not be saved. Your entries are still here.'); }
    finally { setBusy(false); }
  };
  const review = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || !action || !reason.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await reviewSsoConfiguration(selected.draft_id, action, selected.content_hash, reason.trim());
      setAction(null); setReason(''); await load();
      setNotice(action === 'approve' ? 'Provider approved. Company sign-in now uses this configuration.' : action === 'revoke' ? 'Provider revoked. Company sign-in is no longer available through this configuration.' : 'Configuration rejected. The active sign-in provider is unchanged.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The review could not be saved. Try again.'); }
    finally { setBusy(false); }
  };

  if (!canManage) return <section className="sso-settings"><h2>Company sign-in</h2><p>A platform admin manages company sign-in and its approval history.</p></section>;
  return <section className="sso-settings" aria-labelledby="sso-settings-title">
    <header><div><h2 id="sso-settings-title">Company sign-in</h2><p>Connect an OpenID Connect identity provider. A separate administrator reviews every configuration before it takes effect.</p></div><div className="sso-actions"><button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={() => { if (canLeave()) { setLoading(true); void load(); } }}><RefreshCw size={16} aria-hidden="true" />Refresh</button><button type="button" className="btn btn-primary" disabled={loading || busy || editing} onClick={start}><Plus size={16} aria-hidden="true" />Propose provider</button></div></header>
    {error && <div className="sso-message is-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</div>}{notice && <div className="sso-message is-success" role="status"><CheckCircle2 size={18} aria-hidden="true" />{notice}</div>}
    {loading && !configuration ? <p role="status">Loading sign-in configuration…</p> : <>
      <p>{configuration?.active ? <>Active provider: <strong>{configuration.active.definition.display_name}</strong></> : 'Company sign-in is not configured. Administrator token access is available to complete setup.'}</p>
      {editing ? <form onSubmit={create}><fieldset disabled={busy}><legend>Provider details</legend><p>Use the values supplied by your identity administrator. Register the callback URL with the provider before approving this configuration.</p>
        <div className="sso-form-row"><label>Display name<input required maxLength={80} value={definition.display_name} onChange={event => setDefinition(current => ({ ...current, display_name: event.target.value }))} /></label><label>Client ID<input required maxLength={256} value={definition.client_id} onChange={event => setDefinition(current => ({ ...current, client_id: event.target.value }))} /></label></div>
        {endpointFields.map(([key, label]) => <label key={key}>{label}<input type="url" required pattern="https://.+" value={definition[key]} onChange={event => setDefinition(current => ({ ...current, [key]: event.target.value }))} aria-describedby={key === 'redirect_uri' ? 'sso-callback-help' : undefined} />{key === 'redirect_uri' && <span id="sso-callback-help">Use this deployment’s HTTPS address ending in /api/v1/auth/callback.</span>}</label>)}
        <label>Client authentication<select value={definition.token_auth_method} onChange={event => setDefinition(current => ({ ...current, token_auth_method: event.target.value as SsoDefinition['token_auth_method'], client_secret_reference: event.target.value === 'none' ? '' : current.client_secret_reference }))}><option value="client_secret_basic">Client secret in authorization header</option><option value="client_secret_post">Client secret in token request</option><option value="none">Public client with PKCE</option></select></label>
        {definition.token_auth_method !== 'none' && <label>Client secret reference<input required pattern="env://[A-Za-z_][A-Za-z0-9_]*" value={definition.client_secret_reference} onChange={event => setDefinition(current => ({ ...current, client_secret_reference: event.target.value }))} placeholder="env://SSO_CLIENT_SECRET" /><span>Enter the environment variable reference, never the secret value.</span></label>}
        <label>Session length in seconds<input type="number" min={300} max={28800} step={1} required value={definition.session_ttl_seconds} onChange={event => setDefinition(current => ({ ...current, session_ttl_seconds: Number(event.target.value) }))} /></label>
        <fieldset className="sso-scopes"><legend>Identity information</legend><label><input type="checkbox" checked disabled />OpenID identity (required)</label>{(['profile', 'email'] as const).map(scope => <label key={scope}><input type="checkbox" checked={definition.scopes.includes(scope)} onChange={event => setDefinition(current => ({ ...current, scopes: event.target.checked ? [...current.scopes, scope] : current.scopes.filter(value => value !== scope) }))} />{scope === 'profile' ? 'Profile information' : 'Email address'}</label>)}</fieldset>
        <div className="sso-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving proposal…' : 'Save for review'}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(false); setError(null); }}>Discard draft</button></div>
      </fieldset></form> : records.length ? <div className="sso-versions"><label>Configuration history<select value={selectedId ?? ''} onChange={event => { if (canLeave()) { setSelectedId(event.target.value); setAction(null); setReason(''); setError(null); } }}>{records.map(record => <option key={record.draft_id} value={record.draft_id}>{record.definition.display_name} · {record.status.toLowerCase()} · {new Date(record.created_at * 1000).toLocaleString()}</option>)}</select></label>
        {selected && <><header><h3>{selected.definition.display_name}</h3><span>{selected.status === 'PENDING' ? 'Awaiting approval' : selected.status.toLowerCase()}</span></header><p>Proposed by <strong>{selected.author_subject}</strong>{selected.reviewer_subject && <> · Reviewed by <strong>{selected.reviewer_subject}</strong></>}</p>{selected.review_reason && <p>{selected.review_reason}</p>}
          <dl>{endpointFields.map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{selected.definition[key]}</dd></React.Fragment>)}<dt>Client ID</dt><dd>{selected.definition.client_id}</dd><dt>Secret reference</dt><dd>{selected.definition.client_secret_reference || 'Public client'}</dd><dt>Session length</dt><dd>{selected.definition.session_ttl_seconds.toLocaleString()} seconds</dd><dt>Identity scopes</dt><dd>{selected.definition.scopes.join(', ')}</dd></dl>
          {action ? <form onSubmit={review}><label>Reason for this review<textarea required maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label><div className="sso-actions"><button type="submit" className="btn btn-primary" disabled={busy || !reason.trim()}>{busy ? 'Saving review…' : action === 'approve' ? 'Approve provider' : action === 'reject' ? 'Reject proposal' : 'Revoke provider'}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setAction(null); setReason(''); setError(null); }}>Cancel review</button></div></form> : <div className="sso-actions">{selected.status === 'PENDING' && (selected.author_subject === principal.subject ? <p>A different platform admin must review your proposal.</p> : <><button type="button" className="btn btn-primary" disabled={busy} onClick={() => setAction('approve')}>Approve provider</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAction('reject')}>Reject proposal</button></>)}{selected.status === 'APPROVED' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAction('revoke')}>Revoke provider</button>}</div>}
        </>}
      </div> : <p>Propose your company’s provider to begin setup.</p>}
    </>}
  </section>;
};
