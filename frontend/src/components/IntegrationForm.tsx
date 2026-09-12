import React, { useEffect, useRef, useState } from 'react';
import { ApiError, resetProjectIntegration, saveIntegration, testIntegration } from '../services/api';
import { IntegrationDefinition, Principal, ToolDefinition } from '../types/api';

export function IntegrationForm({ tool, principal, onClose, onSaved }: {
  tool?: ToolDefinition; principal: Principal; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const record = tool?.registration;
  const platformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const projectEditor = platformAdmin || principal.roles.some(role => ['TENANT_ADMIN', 'PROJECT_OWNER', 'PROJECT_MANAGER'].includes(role));
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<'platform' | 'project'>(platformAdmin && (!record || record.scope_level === 'platform_default') ? 'platform' : 'project');
  const [id, setId] = useState(record?.id || '');
  const initial: IntegrationDefinition = record?.definition || {
    name: tool?.name || '', kind: tool?.type === 'a2a' ? 'a2a' : 'mcp', endpoint: '',
    description: '', auth_method: 'none', secret_reference: '',
    transport: tool?.type === 'a2a' ? 'a2a_jsonrpc' : 'streamable_http',
    timeout_seconds: 30, allow_project_override: true,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'reachable' | 'failed' | 'blocked'; message: string; latency_ms?: number } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const locked = scope === 'project' && record?.platform_definition && !record.platform_definition.allow_project_override;
  const canSave = (scope === 'platform' ? platformAdmin : projectEditor) && !locked;
  const savedDefinition = scope === 'platform'
    ? record?.platform_definition
    : record?.project_revision
      ? record.definition
      : null;
  const hasSavedConnection = Boolean(
    record && savedDefinition
      && (scope === 'platform' ? record.platform_revision && !record.project_revision : record.project_revision)
      && JSON.stringify(form) === JSON.stringify(savedDefinition)
  );

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  const changeScope = (value: 'platform' | 'project') => {
    setScope(value);
    setForm(value === 'platform' ? record?.platform_definition || initial : initial);
    setTestResult(null);
    setError('');
  };
  const field = <K extends keyof IntegrationDefinition>(key: K, value: IntegrationDefinition[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setTestResult(null);
  };
  const finish = async () => {
    try {
      await onSaved();
      setSaved(true);
      onClose();
    } catch (failure) {
      setSaved(true);
      setError(failure instanceof Error
        ? `Saved successfully, but the catalog could not refresh: ${failure.message}`
        : 'Saved successfully, but the catalog could not refresh. Use Refresh catalog after closing.');
    }
  };
  const testSavedConnection = async () => {
    if (!record || !hasSavedConnection) return;
    setTesting(true); setTestResult(null); setError('');
    try {
      const result = await testIntegration(record.id);
      setTestResult({ status: result.status, message: result.message, latency_ms: result.latency_ms });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to test saved connection.');
    } finally { setTesting(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await saveIntegration(scope, id, {
        definition: form,
        expected_revision: record ? (scope === 'platform' ? record.platform_revision : record.project_revision) : '',
        expected_platform_revision: scope === 'project' ? record?.platform_revision || '' : '',
      });
      await finish();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 422
        ? 'Check the fields. Use an HTTPS URL without credentials or query parameters, and an env:// credential reference for bearer authentication.'
        : failure instanceof ApiError && failure.status === 409
          ? `This configuration changed elsewhere. Reload before saving again. ${failure.message}`
          : failure instanceof Error ? failure.message : 'Unable to save integration.');
    } finally { setSaving(false); }
  };
  const reset = async () => {
    if (!record) return;
    setSaving(true); setError('');
    try { await resetProjectIntegration(record.id, record.project_revision); await finish(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to reset project settings.'); }
    finally { setSaving(false); }
  };

  return <dialog ref={dialog} className="integration-dialog" aria-labelledby="integration-title" aria-describedby="integration-description" onCancel={event => {
    if (saving) event.preventDefault(); else onClose();
  }}>
    <form onSubmit={submit}>
      <h2 id="integration-title">{record ? 'Configure integration' : 'Add MCP or A2A integration'}</h2>
      <p id="integration-description">Save a connection for your platform or project. Agent access and live execution are not enabled by registration.</p>
      {error && <div role="alert" className="notice-banner">{error}</div>}
      {saved && <p role="status">Settings saved. The catalog could not refresh; close this form and refresh the workspace.</p>}
      <fieldset disabled={saving || saved}>
        <label>Save to
          <select value={scope} onChange={event => changeScope(event.target.value as 'platform' | 'project')}>
            {platformAdmin && (!record || record.platform_definition) && <option value="platform">Platform default</option>}
            <option value="project">This project — {principal.project_id}</option>
          </select>
        </label>
        <p>{scope === 'platform' ? 'Available to projects in this tenant. Projects inherit these settings unless an override is allowed.' : record?.platform_definition ? 'Overrides the inherited settings for this project only.' : 'Available only in this project.'}</p>
        {locked && <p role="status">The platform administrator has locked project overrides.</p>}
        {!canSave && !locked && <p role="status">Your role can view these settings but cannot edit them.</p>}
        <fieldset disabled={!canSave}>
          <label>Integration ID<input required pattern="[a-z][a-z0-9_-]{0,63}" maxLength={64} value={id} disabled={!!record} placeholder="incident-tools" onChange={event => setId(event.target.value)} /></label>
          <label>Name<input required maxLength={120} value={form.name} onChange={event => field('name', event.target.value)} /></label>
          <label>Type<select value={form.kind} disabled={!!record} onChange={event => {
            const kind = event.target.value as 'mcp' | 'a2a';
            setForm(current => ({ ...current, kind, transport: kind === 'mcp' ? 'streamable_http' : 'a2a_jsonrpc' }));
            setTestResult(null);
          }}><option value="mcp">MCP server</option><option value="a2a">A2A agent</option></select></label>
          <label>{form.kind === 'mcp' ? 'Server endpoint' : 'Agent endpoint or agent-card URL'}<input required type="url" maxLength={2048} placeholder={form.kind === 'mcp' ? 'https://service.example.com/mcp' : 'https://agent.example.com or …/agent-card.json'} value={form.endpoint} onChange={event => field('endpoint', event.target.value)} /></label>
          <label>Connection protocol<select value={form.transport} onChange={event => field('transport', event.target.value as IntegrationDefinition['transport'])}>
            {form.kind === 'mcp' ? <><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option></> : <><option value="a2a_jsonrpc">A2A JSON-RPC</option><option value="a2a_rest">A2A HTTP / REST</option></>}
          </select></label>
          <label>Authentication<select value={form.auth_method} onChange={event => { setForm(current => ({ ...current, auth_method: event.target.value as 'none' | 'bearer', secret_reference: '' })); setTestResult(null); }}><option value="none">None</option><option value="bearer">Bearer token reference</option></select></label>
          {form.auth_method === 'bearer' && <label>Credential reference<input required pattern="env://[A-Z][A-Z0-9_]{0,127}" value={form.secret_reference} placeholder="env://MCP_API_TOKEN" onChange={event => field('secret_reference', event.target.value)} /><small>Reference a server environment variable. Do not paste the token.</small></label>}
          <label>Timeout (seconds)<input required type="number" min={1} max={120} value={form.timeout_seconds} onChange={event => field('timeout_seconds', Number(event.target.value))} /></label>
          <label>Description<textarea maxLength={1000} value={form.description} onChange={event => field('description', event.target.value)} /></label>
          {scope === 'platform' && <label className="integration-checkbox"><input type="checkbox" checked={form.allow_project_override} onChange={event => field('allow_project_override', event.target.checked)} /> Allow project overrides</label>}
        </fieldset>
      </fieldset>
      {testResult && <div
        className={`integration-test-result ${testResult.status}`}
        role="status"
        aria-live="polite"
      >
        <strong>{testResult.status.toUpperCase()}</strong> {testResult.message}
        {testResult.latency_ms !== undefined && <span>{testResult.latency_ms}ms</span>}
      </div>}
      <div className="integration-actions">
        {hasSavedConnection && <button type="button" className="btn btn-open" disabled={saving || testing || saved} onClick={() => void testSavedConnection()}>{testing ? 'Testing…' : 'Test saved connection'}</button>}
        {record?.platform_definition && record.project_revision && scope === 'project' && projectEditor && <button type="button" className="btn btn-secondary" disabled={saving || saved} onClick={() => void reset()}>Use platform defaults</button>}
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Close</button>
        {canSave && <button type="submit" className="btn btn-primary" disabled={saving || saved}>{saving ? 'Saving…' : 'Save integration'}</button>}
      </div>
    </form>
  </dialog>;
}
