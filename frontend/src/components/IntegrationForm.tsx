import React, { useEffect, useRef, useState } from 'react';
import { ApiError, fetchProjectSetup, previewMcpImport, resetProjectIntegration, saveIntegration, testIntegration } from '../services/api';
import { EnvironmentConfig, IntegrationDefinition, Principal, ToolDefinition } from '../types/api';

export function IntegrationForm({ tool, principal, onClose, onSaved }: {
  tool?: ToolDefinition; principal: Principal; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const record = tool?.registration;
  const platformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const projectEditor = platformAdmin || principal.roles.some(role => ['PROJECT_OWNER'].includes(role));
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<'platform' | 'project'>(platformAdmin && (!record || record.scope_level === 'platform_default') ? 'platform' : 'project');
  const [id, setId] = useState(record?.id || '');
  const initial: IntegrationDefinition = record?.definition || {
    name: tool?.name || '', system_name: tool?.system_name || tool?.name || '', environment_dependency: undefined, tool_environment: '', project_environment_ids: [], kind: tool?.type === 'a2a' ? 'a2a' : 'mcp', endpoint: '',
    description: '', auth_method: 'none', secret_reference: '',
    transport: tool?.type === 'a2a' ? 'a2a_jsonrpc' : 'streamable_http',
    timeout_seconds: 30, allow_project_override: true,
  };
  const [form, setForm] = useState(initial);
  const [systemNameCustomized, setSystemNameCustomized] = useState(Boolean(record?.definition?.system_name));
  const [environments, setEnvironments] = useState<EnvironmentConfig[]>([]);
  const [environmentError, setEnvironmentError] = useState('');
  const [loadingEnvironments, setLoadingEnvironments] = useState(false);
  const [inputMode, setInputMode] = useState<'fields' | 'json' | 'command'>('fields');
  const [importSource, setImportSource] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [imported, setImported] = useState<{ id: string; definition: IntegrationDefinition }[]>([]);
  const reviewImport = async () => {
    if (inputMode === 'fields') return;
    setReviewing(true); setError(''); setImported([]);
    try {
      const result = await previewMcpImport(importSource, inputMode);
      setImported(result.connections);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to read this connection configuration.');
    } finally { setReviewing(false); }
  };
  const chooseImport = (connection: { id: string; definition: IntegrationDefinition }) => {
    if (!record) setId(connection.id);
    setForm({ ...connection.definition, system_name: connection.definition.system_name || connection.definition.name, environment_dependency: connection.definition.environment_dependency, tool_environment: connection.definition.tool_environment || '', project_environment_ids: connection.definition.project_environment_ids || [] });
    setSystemNameCustomized(Boolean(connection.definition.system_name && connection.definition.system_name !== connection.definition.name));
    setInputMode('fields'); setTestResult(null); setError('');
  };
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
  useEffect(() => {
    if (scope !== 'project') return;
    let current = true;
    setLoadingEnvironments(true);
    setEnvironmentError('');
    fetchProjectSetup().then(setup => {
      if (current) setEnvironments((setup.runtime.environments || []).filter(environment => environment.enabled !== false));
    }).catch(failure => {
      if (current) setEnvironmentError(failure instanceof Error ? failure.message : 'Unable to load project environments. Reopen this form to retry.');
    }).finally(() => { if (current) setLoadingEnvironments(false); });
    return () => { current = false; };
  }, [scope]);
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
    event.preventDefault();
    if (inputMode !== 'fields') { await reviewImport(); return; }
    setSaving(true); setError('');
    try {
      const definition = scope === 'platform'
        ? Object.fromEntries(Object.entries(form).filter(([key]) => !['system_name', 'environment_dependency', 'tool_environment', 'project_environment_ids'].includes(key))) as IntegrationDefinition
        : form;
      await saveIntegration(scope, id, {
        definition,
        expected_revision: record ? (scope === 'platform' ? record.platform_revision : record.project_revision) : '',
        expected_platform_revision: scope === 'project' ? record?.platform_revision || '' : '',
      });
      await finish();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 422
        ? failure.message
        : failure instanceof ApiError && failure.status === 409
          ? failure.message
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
    if (saving || reviewing) event.preventDefault(); else onClose();
  }}>
    <form onSubmit={submit}>
      <h2 id="integration-title">{record ? 'Configure integration' : 'Add MCP or A2A integration'}</h2>
      <p id="integration-description">Save a connection for your platform or project. Agent access and live execution are not enabled by registration.</p>
      {error && <div role="alert" className="notice-banner">{error}</div>}
      {saved && <p role="status">Settings saved. The catalog could not refresh; close this form and refresh the workspace.</p>}
      <fieldset disabled={saving || saved || reviewing}>
        <label>Save to
          <select value={scope} onChange={event => changeScope(event.target.value as 'platform' | 'project')}>
            {platformAdmin && (!record || record.platform_definition) && <option value="platform">Platform default</option>}
            <option value="project">This project — {principal.project_id}</option>
          </select>
        </label>
        <p>{scope === 'platform' ? 'Available to projects in this tenant. Projects inherit these settings unless an override is allowed.' : record?.platform_definition ? 'Overrides the inherited settings for this project only.' : 'Available only in this project.'}</p>
        {locked && <p role="status">The platform administrator has locked project overrides.</p>}
        {!canSave && !locked && <p role="status">Your role can view these settings but cannot edit them.</p>}
        {(!record || form.kind === 'mcp') && <div className="integration-input-modes" role="group" aria-label="Connection input method">
          {(['fields', 'command', 'json'] as const).map(mode => <button key={mode} type="button"
            className={`btn ${inputMode === mode ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={inputMode === mode} disabled={!canSave}
            onClick={() => { setInputMode(mode); setImportSource(''); setImported([]); setError(''); }}>
            {mode === 'fields' ? 'Connection form' : mode === 'command' ? 'Paste command' : 'Import JSON'}
          </button>)}
        </div>}
        {inputMode !== 'fields' ? <fieldset disabled={!canSave}>
          <label>{inputMode === 'json' ? 'MCP configuration JSON' : 'MCP server command'}
            <textarea required maxLength={65536} rows={inputMode === 'json' ? 10 : 3}
              spellCheck={false} autoComplete="off" value={importSource}
              placeholder={inputMode === 'json' ? 'Paste an mcpServers object or one server configuration' : 'Paste the executable and its arguments'}
              onChange={event => { setImportSource(event.target.value); setImported([]); setError(''); }} />
          </label>
          <p>{inputMode === 'json'
            ? 'Accepts Claude/Cursor mcpServers JSON with a remote URL or command, args and env. Use environment references instead of tokens.'
            : 'Quotes are supported. Commands run as an executable and arguments, without a shell. The deployment must approve the exact command before testing.'}</p>
          {imported.length > 0 && <div className="integration-import-results" role="region" aria-label="Connections ready to review">
            <p role="status">Choose a connection to review and save. Import another connection separately.</p>
            {imported.map(connection => <button key={connection.id} type="button" className="btn btn-secondary"
              onClick={() => chooseImport(connection)}>{connection.definition.name} — {connection.definition.transport === 'stdio' ? 'Command' : connection.definition.transport === 'sse' ? 'SSE' : 'HTTP'}</button>)}
          </div>}
        </fieldset> : <fieldset disabled={!canSave}>
          <label>Integration ID<input required pattern="[a-z][a-z0-9_-]{0,63}" maxLength={64} value={id} disabled={!!record} placeholder="incident-tools" onChange={event => setId(event.target.value)} /></label>
          <label>Name<input required maxLength={120} value={form.name} onChange={event => {
            const name = event.target.value;
            setForm(current => ({ ...current, name, system_name: systemNameCustomized ? current.system_name : name }));
            setTestResult(null);
          }} /></label>
          {scope === 'project' && <>
            <label>System Name <span aria-hidden="true">*</span><input required maxLength={128} value={form.system_name || ''} placeholder={form.name || 'MCP integration name'} onChange={event => { setSystemNameCustomized(true); field('system_name', event.target.value); }} /><small>Project-scoped runtime identity. It starts from the integration name and remains editable.</small></label>
            <fieldset className="integration-identity-group">
              <legend>Environment scope <span aria-hidden="true">*</span></legend>
              <label><input required type="radio" name="integration-environment-dependency" checked={form.environment_dependency === 'dependent'} onChange={() => field('environment_dependency', 'dependent')} /> Environment dependent</label>
              <label><input required type="radio" name="integration-environment-dependency" checked={form.environment_dependency === 'independent'} onChange={() => { field('environment_dependency', 'independent'); field('project_environment_ids', []); }} /> Environment independent</label>
            </fieldset>
            {form.environment_dependency === 'dependent' && <fieldset>
              <legend>Project environments <span aria-hidden="true">*</span></legend>
              <small>Choose the project environments that use this external tool environment.</small>
              {loadingEnvironments && <p role="status">Loading project environments…</p>}
              {environmentError && <p role="alert">{environmentError}</p>}
              {!loadingEnvironments && !environmentError && environments.length === 0 && <p>Add an active environment in Project Setup before mapping this connection.</p>}
              {environments.map(environment => <label key={environment.id}>
                <input type="checkbox" checked={(form.project_environment_ids || []).includes(environment.id)}
                  onChange={event => field('project_environment_ids', event.target.checked
                    ? [...(form.project_environment_ids || []), environment.id]
                    : (form.project_environment_ids || []).filter(id => id !== environment.id))} />
                {environment.name || environment.id} <small>{environment.name && environment.name !== environment.id ? environment.id : ''}</small>
              </label>)}
              {(form.project_environment_ids || []).filter(id => !environments.some(environment => environment.id === id)).length > 0 && !loadingEnvironments && !environmentError && <div role="alert">
                <p>A saved environment is no longer active. Remove unavailable mappings and select an active environment before saving.</p>
                <button type="button" className="btn btn-secondary" onClick={() => field('project_environment_ids', (form.project_environment_ids || []).filter(id => environments.some(environment => environment.id === id)))}>Remove unavailable mappings</button>
              </div>}
            </fieldset>}
            <label>Tool Environment <span aria-hidden="true">*</span><input required maxLength={128} value={form.tool_environment || ''} placeholder={form.environment_dependency === 'independent' ? 'Shared' : 'Authorized external environment'} onChange={event => field('tool_environment', event.target.value)} /></label>
          </>}
          <label>Type<select value={form.kind} disabled={!!record} onChange={event => {
            const kind = event.target.value as 'mcp' | 'a2a';
            setForm(current => ({ ...current, kind, transport: kind === 'mcp' ? 'streamable_http' : 'a2a_jsonrpc', command: '', args: [], env: {} }));
            setTestResult(null);
          }}><option value="mcp">MCP server</option><option value="a2a">A2A agent</option></select></label>
          <label>Connection protocol<select value={form.transport} onChange={event => {
            const transport = event.target.value as IntegrationDefinition['transport'];
            setForm(current => ({ ...current, transport, endpoint: transport === 'stdio' ? '' : current.endpoint,
              command: '', args: [], env: {}, auth_method: 'none', secret_reference: '' }));
            setTestResult(null);
          }}>
            {form.kind === 'mcp' ? <><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">Command (stdio)</option></> : <><option value="a2a_jsonrpc">A2A JSON-RPC</option><option value="a2a_rest">A2A HTTP / REST</option></>}
          </select></label>
          {form.transport === 'stdio' ? <>
            <label>Executable<input required maxLength={2048} value={form.command || ''} onChange={event => field('command', event.target.value)} /></label>
            <label>Arguments — one per line<textarea value={(form.args || []).join('\n')} spellCheck={false}
              onChange={event => field('args', event.target.value ? event.target.value.split('\n') : [])} /></label>
            {Object.keys(form.env || {}).length > 0 && <label>Environment references<pre className="integration-command-env">{JSON.stringify(form.env, null, 2)}</pre><small>Use Import JSON to change environment references.</small></label>}
            <p>The exact executable, arguments and environment references must be deployment-approved before this connection can be tested.</p>
          </> : <>
            <label>{form.kind === 'mcp' ? 'Server endpoint' : 'Agent endpoint or agent-card URL'}<input required type="url" maxLength={2048} placeholder={form.kind === 'mcp' ? 'https://service.example.com/mcp' : 'https://agent.example.com or …/agent-card.json'} value={form.endpoint} onChange={event => field('endpoint', event.target.value)} /></label>
            <label>Authentication<select value={form.auth_method} onChange={event => { setForm(current => ({ ...current, auth_method: event.target.value as 'none' | 'bearer', secret_reference: '' })); setTestResult(null); }}><option value="none">None</option><option value="bearer">Bearer token reference</option></select></label>
            {form.auth_method === 'bearer' && <label>Credential reference<input required pattern="env://[A-Z][A-Z0-9_]{0,127}" value={form.secret_reference} placeholder="env://MCP_API_TOKEN" onChange={event => field('secret_reference', event.target.value)} /><small>Reference a server environment variable. Do not paste the token.</small></label>}
          </>}
          <label>Timeout (seconds)<input required type="number" min={1} max={120} value={form.timeout_seconds} onChange={event => field('timeout_seconds', Number(event.target.value))} /></label>
          <label>Description<textarea maxLength={1000} value={form.description} onChange={event => field('description', event.target.value)} /></label>
          {scope === 'platform' && <label className="integration-checkbox"><input type="checkbox" checked={form.allow_project_override} onChange={event => field('allow_project_override', event.target.checked)} /> Allow project overrides</label>}
        </fieldset>}
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
        <button type="button" className="btn btn-secondary" disabled={saving || reviewing} onClick={onClose}>Close</button>
        {canSave && <button type="submit" className="btn btn-primary" disabled={saving || saved || reviewing}>{reviewing ? 'Reading…' : inputMode !== 'fields' ? 'Review connections' : saving ? 'Saving…' : 'Save integration'}</button>}
      </div>
    </form>
  </dialog>;
}
