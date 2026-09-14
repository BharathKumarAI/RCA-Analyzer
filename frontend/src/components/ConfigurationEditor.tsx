import '../styles/admin-configuration.css';
import { useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { NotificationBanner } from './NotificationBanner';
import { request } from '../services/api';

type Field = { title?: string; description?: string; type?: string; enum?: string[]; options?: string[]; minimum?: number; maximum?: number; exclusiveMinimum?: number; maxLength?: number; anyOf?: Field[] };
type Snapshot = { values?: Record<string, unknown>; active_values?: Record<string, unknown>; fields?: Record<string, Field>; schema?: { properties: Record<string, Field> }; content_hash: string; activation?: string; pending_restart?: boolean; applies_after_restart?: boolean; identity?: Record<string, unknown>; [key: string]: unknown };
const labelFor = (name: string) => name.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function ConfigurationEditor({ endpoint, deployment = false }: { endpoint: string; deployment?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fields = snapshot?.fields || snapshot?.schema?.properties || {};
  const accept = (next: Snapshot) => {
    const properties = next.fields || next.schema?.properties || {};
    setSnapshot(next);
    setValues(next.values || Object.fromEntries(Object.keys(properties).filter(key => key !== 'expected_hash').map(key => [key, next[key]])));
    setDirty(false);
  };
  async function load() {
    setBusy(true); setError(null); setNotice(null);
    try { accept(await request<Snapshot>(endpoint)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Configuration could not load.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [endpoint]);
  const change = (name: string, value: unknown) => { setValues(previous => ({ ...previous, [name]: value })); setDirty(true); setNotice(null); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!snapshot) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const body = deployment ? { ...values, expected_hash: snapshot.content_hash } : { values, expected_hash: snapshot.content_hash };
      const updated = await request<Snapshot>(endpoint, { method: 'PUT', body });
      // The GET schema is stable and remains available if a mutation returns values only.
      accept({ ...snapshot, ...updated });
      setNotice(deployment || snapshot.activation === 'restart' ? 'Saved. These changes take effect after the API service restarts.' : 'Saved. New uploads use these settings.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Configuration could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="configuration-editor">
    <div className="configuration-toolbar"><p>{deployment || snapshot?.activation === 'restart' ? 'Edit and save the configuration for the next service restart. Existing data is not moved automatically.' : 'Changes apply to new uploads. Requests already in progress retain their current limits.'}</p><button className="btn btn-secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={14} />{dirty ? 'Discard and reload' : 'Reload'}</button></div>
    {error && <NotificationBanner type="error" message={error} onClose={() => setError(null)} style={{ marginBottom: 12 }} />}
    {notice && <NotificationBanner type="info" message={notice} onClose={() => setNotice(null)} style={{ marginBottom: 12 }} />}
    {!snapshot ? <p role="status">{busy ? 'Loading configuration…' : 'Configuration is unavailable. Reload to try again.'}</p> : <form onSubmit={save}>
      {snapshot.pending_restart && <p className="notice-banner">Saved values differ from the running service. A restart is pending.</p>}
      <fieldset disabled={busy} className="configuration-fields"><legend className="sr-only">Configuration fields</legend>
      {Object.entries(fields).filter(([name]) => name !== 'expected_hash').map(([name, rawField]) => {
        const field = rawField.anyOf?.find(option => option.type !== 'null') || rawField;
        const type = field.type;
        const value = values[name];
        const label = rawField.title || labelFor(name);
        const inputId = `setting-${name}`;
        const description = rawField.description || (name.endsWith('_ref') ? 'Reference an existing deployment credential with env://VARIABLE_NAME. Credential values are never returned.' : undefined);
        return <div key={name} className={type === 'array' || name === 'guidelines' ? 'configuration-field wide' : 'configuration-field'}>
          <label htmlFor={inputId}>{label}</label>
          {type === 'boolean' ? <select id={inputId} value={String(value ?? false)} onChange={event => change(name, event.target.value === 'true')}><option value="true">Enabled</option><option value="false">Disabled</option></select>
            : field.enum ? <select id={inputId} value={String(value ?? '')} onChange={event => change(name, event.target.value)}>{field.enum.map(option => <option key={option} value={option}>{option}</option>)}</select>
            : type === 'array' ? <input id={inputId} value={Array.isArray(value) ? value.join(', ') : ''} onChange={event => change(name, event.target.value.split(',').map(item => item.trim()).filter(Boolean))} />
            : type === 'integer' || type === 'number' ? <input id={inputId} type="number" required min={field.minimum ?? field.exclusiveMinimum} max={field.maximum} step={type === 'integer' ? 1 : 'any'} value={value == null ? '' : String(value)} onChange={event => change(name, event.target.value === '' ? '' : Number(event.target.value))} />
            : name === 'guidelines' ? <textarea id={inputId} rows={5} value={String(value ?? '')} onChange={event => change(name, event.target.value)} />
            : <input id={inputId} maxLength={field.maxLength} value={String(value ?? '')} placeholder={name.endsWith('_ref') ? 'env://VARIABLE_NAME' : undefined} onChange={event => change(name, event.target.value || (rawField.anyOf?.some(item => item.type === 'null') ? null : ''))} />}
          {description && <small>{description}</small>}
          {rawField.options && <small>Supported: {rawField.options.join(', ')}</small>}
          {snapshot.active_values && JSON.stringify(value) !== JSON.stringify(snapshot.active_values[name]) && <small>Currently active: {String(snapshot.active_values[name] ?? 'Not set')}</small>}
        </div>;
      })}
      </fieldset>
      <button className="btn btn-primary" type="submit" disabled={busy || !dirty}><Save size={14} />{busy ? 'Saving…' : deployment || snapshot.activation === 'restart' ? 'Save for restart' : 'Save configuration'}</button>
    </form>}
    {snapshot?.identity && <details className="configuration-identity"><summary>Verified identity and deployment scope</summary><p>{String(snapshot.identity.reason || 'Identity is supplied by the deployment authentication boundary.')}</p><dl>{Object.entries(snapshot.identity).filter(([key]) => key !== 'reason').map(([key, value]) => <div key={key}><dt>{labelFor(key)}</dt><dd>{String(value ?? 'Not configured')}</dd></div>)}</dl></details>}
  </section>;
}
