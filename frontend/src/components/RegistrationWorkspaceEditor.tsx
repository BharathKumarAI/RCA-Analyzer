import React, { useState } from 'react';
import { Activity, Info, Key, Settings, Shield } from 'lucide-react';
import { saveIntegration } from '../services/api';
import type { IntegrationDefinition, Principal, ToolDefinition } from '../types/api';

interface Props {
  tool: ToolDefinition;
  principal: Principal;
  onSaved: () => Promise<void>;
}

export function RegistrationWorkspaceEditor({ tool, principal, onSaved }: Props) {
  const registration = tool.registration!;
  const platform = Boolean(registration.platform_definition);
  const scope = platform ? 'platform' : 'project';
  const source = registration.platform_definition || registration.definition;
  const [form, setForm] = useState<IntegrationDefinition>(source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = !platform && Boolean(registration.platform_definition && !registration.platform_definition.allow_project_override);
  const canEdit = !locked && (platform
    ? principal.roles.includes('PLATFORM_ADMIN')
    : principal.roles.includes('PLATFORM_ADMIN') || principal.roles.includes('PROJECT_OWNER'));
  const changed = JSON.stringify(form) !== JSON.stringify(source);

  const update = <K extends keyof IntegrationDefinition>(key: K, value: IntegrationDefinition[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setMessage('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const definition = scope === 'platform'
        ? Object.fromEntries(Object.entries(form).filter(([key]) => !['system_name', 'environment_dependency', 'tool_environment', 'project_environment_ids'].includes(key))) as unknown as IntegrationDefinition
        : form;
      await saveIntegration(scope, registration.id, {
        definition,
        expected_revision: platform ? registration.platform_revision : registration.project_revision,
        expected_platform_revision: platform ? '' : registration.platform_revision,
      });
      await onSaved();
      setMessage('Registration saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save registration.');
    } finally {
      setBusy(false);
    }
  };

  return <form className="prism-connector-container" onSubmit={save}>
    <header className="prism-header">
      <div className="prism-header-main">
        <div className="prism-breadcrumbs"><span>Tools</span><span className="sep">/</span><span>Integrations</span><span className="sep">/</span><span className="active-crumb">{form.name}</span></div>
        <div className="prism-title-row"><div className="prism-icon-badge"><Settings size={20} /></div><div><h2 className="prism-title">{form.name}</h2><p className="prism-subtitle">{form.description || 'Saved integration registration'}</p></div></div>
      </div>
      <div className="prism-header-controls"><span className="prism-scope-pill"><Shield size={12} /> Scope: <b>{platform ? 'Platform registration' : 'Project registration'}</b></span></div>
    </header>
    <nav className="prism-nav-bar" aria-label="Integration sections">
      <button type="button" className="prism-nav-tab" onClick={() => document.getElementById('registration-identity')?.scrollIntoView({ block: 'start' })}>Identity</button>
      <button type="button" className="prism-nav-tab" onClick={() => document.getElementById('registration-connection')?.scrollIntoView({ block: 'start' })}>Connection</button>
      <button type="button" className="prism-nav-tab" onClick={() => document.getElementById('registration-auth')?.scrollIntoView({ block: 'start' })}>Authentication</button>
      <button type="button" className="prism-nav-tab" onClick={() => document.getElementById('registration-behavior')?.scrollIntoView({ block: 'start' })}>Behavior</button>
    </nav>
    <main className="prism-content-grid">
      <div className="prism-grid-col">
        <section className="prism-card" id="registration-identity">
          <div className="prism-card-header"><div className="prism-card-title-wrap"><div className="prism-card-icon"><Info size={16} /></div><div><h3 className="prism-card-title">Basic Information</h3><p className="prism-card-desc">Name and description of this registered integration.</p></div></div></div>
          <div className="prism-card-body"><div className="prism-form-grid">
            <label className="prism-field-group"><span className="prism-field-label">Name</span><input className="prism-input" required maxLength={120} value={form.name} onChange={event => update('name', event.target.value)} disabled={!canEdit || busy} /></label>
            <label className="prism-field-group"><span className="prism-field-label">Integration ID</span><input className="prism-input locked" value={registration.id} readOnly /></label>
            <label className="prism-field-group full-width"><span className="prism-field-label">Description</span><textarea className="prism-textarea" rows={3} value={form.description} onChange={event => update('description', event.target.value)} disabled={!canEdit || busy} /></label>
          </div><p className="prism-field-hint">{form.kind.toUpperCase()} integration · {form.transport.replaceAll('_', ' ')}</p></div>
        </section>
        <section className="prism-card" id="registration-connection">
          <div className="prism-card-header"><div className="prism-card-title-wrap"><div className="prism-card-icon"><Settings size={16} /></div><div><h3 className="prism-card-title">Connection</h3><p className="prism-card-desc">Where this integration connects.</p></div></div></div>
          <div className="prism-card-body"><div className="prism-form-grid">
            <label className="prism-field-group"><span className="prism-field-label">Transport</span><select className="prism-select" value={form.transport} onChange={event => {
              const transport = event.target.value as IntegrationDefinition['transport'];
              setForm(current => ({ ...current, transport, endpoint: transport === 'stdio' ? '' : current.endpoint,
                command: '', args: [], env: {}, auth_method: 'none', secret_reference: '' }));
              setMessage('');
            }} disabled={!canEdit || busy}>{form.kind === 'mcp' ? <><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">Command (stdio)</option></> : <><option value="a2a_jsonrpc">A2A JSON-RPC</option><option value="a2a_rest">A2A HTTP / REST</option></>}</select></label>
            {form.transport === 'stdio' ? <>
              <label className="prism-field-group"><span className="prism-field-label">Executable</span><input className="prism-input" required maxLength={2048} value={form.command || ''} onChange={event => update('command', event.target.value)} disabled={!canEdit || busy} /></label>
              <label className="prism-field-group full-width"><span className="prism-field-label">Arguments (one per line)</span><textarea className="prism-textarea" rows={4} value={(form.args || []).join('\n')} onChange={event => update('args', event.target.value ? event.target.value.split('\n') : [])} disabled={!canEdit || busy} /></label>
            </> : <label className="prism-field-group full-width"><span className="prism-field-label">Endpoint</span><input className="prism-input" type="url" required maxLength={2048} value={form.endpoint} onChange={event => update('endpoint', event.target.value)} disabled={!canEdit || busy} /></label>}
          </div></div>
        </section>
      </div>
      <div className="prism-grid-col">
        <section className="prism-card" id="registration-auth">
          <div className="prism-card-header"><div className="prism-card-title-wrap"><div className="prism-card-icon"><Key size={16} /></div><div><h3 className="prism-card-title">Authentication</h3><p className="prism-card-desc">Credential references for the saved connection.</p></div></div></div>
          <div className="prism-card-body"><div className="prism-form-grid">
            <label className="prism-field-group"><span className="prism-field-label">Method</span><select className="prism-select" value={form.auth_method} onChange={event => { setForm(current => ({ ...current, auth_method: event.target.value as IntegrationDefinition['auth_method'], secret_reference: '' })); setMessage(''); }} disabled={!canEdit || busy || form.transport === 'stdio'}><option value="none">None</option><option value="bearer">Bearer token reference</option></select></label>
            {form.auth_method === 'bearer' && <label className="prism-field-group full-width"><span className="prism-field-label">Credential reference</span><input className="prism-input" required pattern="env://[A-Z][A-Z0-9_]{0,127}" value={form.secret_reference} onChange={event => update('secret_reference', event.target.value)} disabled={!canEdit || busy} /><span className="prism-field-hint">Use a server environment reference, such as env://MCP_API_TOKEN.</span></label>}
          </div></div>
        </section>
        <section className="prism-card" id="registration-behavior">
          <div className="prism-card-header"><div className="prism-card-title-wrap"><div className="prism-card-icon"><Activity size={16} /></div><div><h3 className="prism-card-title">Behavior</h3><p className="prism-card-desc">Connection timeout and override policy.</p></div></div></div>
          <div className="prism-card-body"><div className="prism-form-grid">
            <label className="prism-field-group"><span className="prism-field-label">Timeout (seconds)</span><input className="prism-input" type="number" min={1} max={120} required value={form.timeout_seconds} onChange={event => update('timeout_seconds', Number(event.target.value))} disabled={!canEdit || busy} /></label>
            {platform && <label className="prism-field-group"><span className="prism-field-label">Project overrides</span><select className="prism-select" value={form.allow_project_override ? 'allowed' : 'locked'} onChange={event => update('allow_project_override', event.target.value === 'allowed')} disabled={!canEdit || busy}><option value="allowed">Allowed</option><option value="locked">Locked</option></select></label>}
          </div></div>
        </section>
      </div>
    </main>
    {canEdit && <footer className="prism-sticky-footer"><div className="prism-footer-left"><span className="prism-field-hint">Changes save to the {scope} registration.</span></div><div className="prism-footer-right"><button type="button" className="btn btn-secondary" onClick={() => { setForm(source); setError(''); setMessage(''); }} disabled={!changed || busy}>Discard changes</button><button type="submit" className="btn btn-primary" disabled={!changed || busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></footer>}
    {error && <div className="prism-alert-banner error" role="alert">{error}</div>}
    {message && <div className="prism-alert-banner success" role="status">{message}</div>}
  </form>;
}
