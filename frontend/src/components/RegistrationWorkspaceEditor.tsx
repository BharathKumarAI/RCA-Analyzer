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

  return <form className="rca_assist-connector-container" onSubmit={save}>
    <header className="rca_assist-header">
      <div className="rca_assist-header-main">
        <div className="rca_assist-breadcrumbs"><span>Tools</span><span className="sep">/</span><span>Integrations</span><span className="sep">/</span><span className="active-crumb">{form.name}</span></div>
        <div className="rca_assist-title-row"><div className="rca_assist-icon-badge"><Settings size={20} /></div><div><h2 className="rca_assist-title">{form.name}</h2><p className="rca_assist-subtitle">{form.description || 'Saved integration registration'}</p></div></div>
      </div>
      <div className="rca_assist-header-controls"><span className="rca_assist-scope-pill"><Shield size={12} /> Scope: <b>{platform ? 'Platform registration' : 'Project registration'}</b></span></div>
    </header>
    <nav className="rca_assist-nav-bar" aria-label="Integration sections">
      <button type="button" className="rca_assist-nav-tab" onClick={() => document.getElementById('registration-identity')?.scrollIntoView({ block: 'start' })}>Identity</button>
      <button type="button" className="rca_assist-nav-tab" onClick={() => document.getElementById('registration-connection')?.scrollIntoView({ block: 'start' })}>Connection</button>
      <button type="button" className="rca_assist-nav-tab" onClick={() => document.getElementById('registration-auth')?.scrollIntoView({ block: 'start' })}>Authentication</button>
      <button type="button" className="rca_assist-nav-tab" onClick={() => document.getElementById('registration-behavior')?.scrollIntoView({ block: 'start' })}>Behavior</button>
    </nav>
    <main className="rca_assist-content-grid">
      <div className="rca_assist-grid-col">
        <section className="rca_assist-card" id="registration-identity">
          <div className="rca_assist-card-header"><div className="rca_assist-card-title-wrap"><div className="rca_assist-card-icon"><Info size={16} /></div><div><h3 className="rca_assist-card-title">Basic Information</h3><p className="rca_assist-card-desc">Name and description of this registered integration.</p></div></div></div>
          <div className="rca_assist-card-body"><div className="rca_assist-form-grid">
            <label className="rca_assist-field-group"><span className="rca_assist-field-label">Name</span><input className="rca_assist-input" required maxLength={120} value={form.name} onChange={event => update('name', event.target.value)} disabled={!canEdit || busy} /></label>
            <label className="rca_assist-field-group"><span className="rca_assist-field-label">Integration ID</span><input className="rca_assist-input locked" value={registration.id} readOnly /></label>
            <label className="rca_assist-field-group full-width"><span className="rca_assist-field-label">Description</span><textarea className="rca_assist-textarea" rows={3} value={form.description} onChange={event => update('description', event.target.value)} disabled={!canEdit || busy} /></label>
          </div><p className="rca_assist-field-hint">{form.kind.toUpperCase()} integration · {form.transport.replaceAll('_', ' ')}</p></div>
        </section>
        <section className="rca_assist-card" id="registration-connection">
          <div className="rca_assist-card-header"><div className="rca_assist-card-title-wrap"><div className="rca_assist-card-icon"><Settings size={16} /></div><div><h3 className="rca_assist-card-title">Connection</h3><p className="rca_assist-card-desc">Where this integration connects.</p></div></div></div>
          <div className="rca_assist-card-body"><div className="rca_assist-form-grid">
            <label className="rca_assist-field-group"><span className="rca_assist-field-label">Transport</span><select className="rca_assist-select" value={form.transport} onChange={event => {
              const transport = event.target.value as IntegrationDefinition['transport'];
              setForm(current => ({ ...current, transport, endpoint: transport === 'stdio' ? '' : current.endpoint,
                command: '', args: [], env: {}, auth_method: 'none', secret_reference: '' }));
              setMessage('');
            }} disabled={!canEdit || busy}>{form.kind === 'mcp' ? <><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">Command (stdio)</option></> : <><option value="a2a_jsonrpc">A2A JSON-RPC</option><option value="a2a_rest">A2A HTTP / REST</option></>}</select></label>
            {form.transport === 'stdio' ? <>
              <label className="rca_assist-field-group"><span className="rca_assist-field-label">Executable</span><input className="rca_assist-input" required maxLength={2048} value={form.command || ''} onChange={event => update('command', event.target.value)} disabled={!canEdit || busy} /></label>
              <label className="rca_assist-field-group full-width"><span className="rca_assist-field-label">Arguments (one per line)</span><textarea className="rca_assist-textarea" rows={4} value={(form.args || []).join('\n')} onChange={event => update('args', event.target.value ? event.target.value.split('\n') : [])} disabled={!canEdit || busy} /></label>
            </> : <label className="rca_assist-field-group full-width"><span className="rca_assist-field-label">Endpoint</span><input className="rca_assist-input" type="url" required maxLength={2048} value={form.endpoint} onChange={event => update('endpoint', event.target.value)} disabled={!canEdit || busy} /></label>}
          </div></div>
        </section>
      </div>
      <div className="rca_assist-grid-col">
        <section className="rca_assist-card" id="registration-auth">
          <div className="rca_assist-card-header"><div className="rca_assist-card-title-wrap"><div className="rca_assist-card-icon"><Key size={16} /></div><div><h3 className="rca_assist-card-title">Authentication</h3><p className="rca_assist-card-desc">Credential references for the saved connection.</p></div></div></div>
          <div className="rca_assist-card-body"><div className="rca_assist-form-grid">
            <label className="rca_assist-field-group"><span className="rca_assist-field-label">Method</span><select className="rca_assist-select" value={form.auth_method} onChange={event => { setForm(current => ({ ...current, auth_method: event.target.value as IntegrationDefinition['auth_method'], secret_reference: '' })); setMessage(''); }} disabled={!canEdit || busy || form.transport === 'stdio'}><option value="none">None</option><option value="bearer">Bearer token reference</option></select></label>
            {form.auth_method === 'bearer' && <label className="rca_assist-field-group full-width"><span className="rca_assist-field-label">Credential reference</span><input className="rca_assist-input" required pattern="env://[A-Z][A-Z0-9_]{0,127}" value={form.secret_reference} onChange={event => update('secret_reference', event.target.value)} disabled={!canEdit || busy} /><span className="rca_assist-field-hint">Use a server environment reference, such as env://MCP_API_TOKEN.</span></label>}
          </div></div>
        </section>
        <section className="rca_assist-card" id="registration-behavior">
          <div className="rca_assist-card-header"><div className="rca_assist-card-title-wrap"><div className="rca_assist-card-icon"><Activity size={16} /></div><div><h3 className="rca_assist-card-title">Behavior</h3><p className="rca_assist-card-desc">Connection timeout and override policy.</p></div></div></div>
          <div className="rca_assist-card-body"><div className="rca_assist-form-grid">
            <label className="rca_assist-field-group"><span className="rca_assist-field-label">Timeout (seconds)</span><input className="rca_assist-input" type="number" min={1} max={120} required value={form.timeout_seconds} onChange={event => update('timeout_seconds', Number(event.target.value))} disabled={!canEdit || busy} /></label>
            {platform && <label className="rca_assist-field-group"><span className="rca_assist-field-label">Project overrides</span><select className="rca_assist-select" value={form.allow_project_override ? 'allowed' : 'locked'} onChange={event => update('allow_project_override', event.target.value === 'allowed')} disabled={!canEdit || busy}><option value="allowed">Allowed</option><option value="locked">Locked</option></select></label>}
          </div></div>
        </section>
      </div>
    </main>
    {canEdit && <footer className="rca_assist-sticky-footer"><div className="rca_assist-footer-left"><span className="rca_assist-field-hint">Changes save to the {scope} registration.</span></div><div className="rca_assist-footer-right"><button type="button" className="btn btn-secondary" onClick={() => { setForm(source); setError(''); setMessage(''); }} disabled={!changed || busy}>Discard changes</button><button type="submit" className="btn btn-primary" disabled={!changed || busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></footer>}
    {error && <div className="rca_assist-alert-banner error" role="alert">{error}</div>}
    {message && <div className="rca_assist-alert-banner success" role="status">{message}</div>}
  </form>;
}
