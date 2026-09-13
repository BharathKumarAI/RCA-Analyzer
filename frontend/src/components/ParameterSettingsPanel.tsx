import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Save } from 'lucide-react';
import { defineParameter, fetchParameters, setParameterOverride } from '../services/api';
import '../styles/admin-configuration.css';
import type { ParameterDefinitionRow, Principal } from '../types/api';

type PanelScope = 'platform' | 'project';

interface ParameterSettingsPanelProps {
  principal: Principal;
  scope: PanelScope;
  tool?: string;
  excludeNames?: string[];
}

const formatValue = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const parseValue = (raw: string, type: ParameterDefinitionRow['value_type']) => {
  if (type === 'boolean') { if (!['true', 'false'].includes(raw)) throw new Error('Choose true or false.'); return raw === 'true'; }
  if (type === 'integer') {
    if (!/^-?\d+$/.test(raw.trim())) throw new Error('Enter a whole number.');
    if (!Number.isSafeInteger(Number(raw))) throw new Error('Enter a valid whole number.');
    return Number(raw);
  }
  if (type === 'number') {
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Enter a valid number.');
    return Number(raw);
  }
  if (type === 'json') return JSON.parse(raw);
  return raw;
};

export function ParameterSettingsPanel({ principal, scope, tool, excludeNames }: ParameterSettingsPanelProps) {
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPlatformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const canProjectOverride = isPlatformAdmin || principal.roles.includes('PROJECT_OWNER');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await fetchParameters(scope === 'project' ? 'project' : undefined);
      setParameters(rows);
      setValues(Object.fromEntries(rows.map(row => [`${row.tool}.${row.variable_name}`, formatValue(scope === 'project' ? row.effective_value : row.default_value)])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load parameter definitions.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [scope, tool]);

  const visible = useMemo(() => parameters.filter(row => (!tool || row.tool === tool) && !excludeNames?.includes(row.variable_name) && (scope === 'project' ? row.project_visible : true)), [parameters, scope, tool, excludeNames]);
  const save = async (row: ParameterDefinitionRow) => {
    const key = `${row.tool}.${row.variable_name}`;
    setSaving(key); setError(null); setNotice(null);
    try {
      const value = parseValue(values[key] ?? '', row.value_type);
      let restartRequired = false;
      if (scope === 'platform') {
        const result = await defineParameter(row.tool, row.variable_name, { value_type: row.value_type, description: row.description, default_value: value, allow_project_override: row.allow_project_override, scope: row.scope, icon: row.icon || 'settings', expected_revision: row.revision });
        restartRequired = Boolean(result?.restart_required);
      } else {
        await setParameterOverride(row.tool, row.variable_name, { value, expected_revision: row.override_revision ?? 0, expected_definition_revision: row.revision });
      }
      setNotice(restartRequired ? `${key} saved. Runtime changes require an API restart.` : `${key} saved.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save parameter.'); }
    finally { setSaving(null); }
  };

  return <section aria-label={`${scope} runtime parameters`} style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div><h3 style={{ margin: 0 }}>{scope === 'platform' ? 'Platform runtime parameters' : 'Project runtime parameters'}</h3><p className="page-subtitle" style={{ margin: '4px 0 0' }}>{scope === 'platform' ? 'Edit the complete persisted definition catalog.' : 'Edit project-visible overrides within this project scope.'}</p></div>
      <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
    </div>
    <datalist id="parameter-booleans"><option value="true" /><option value="false" /></datalist>
    {error && <div className="notice-banner red" role="alert"><AlertCircle size={14} /> {error}</div>}
    {notice && <div className="notice-banner green" role="status"><CheckCircle2 size={14} /> {notice}</div>}
    {loading ? <p role="status">Loading parameter definitions…</p> : visible.length === 0 ? <p className="page-subtitle">No parameters are available in this scope.</p> : <div style={{ display: 'grid', gap: 8 }}>
      {visible.map(row => { const key = `${row.tool}.${row.variable_name}`; const canEdit = scope === 'platform' ? isPlatformAdmin : canProjectOverride && row.scope === 'project' && row.allow_project_override; return <div key={key} className="parameter-setting-row">
        <div><code>{key}</code><div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>{row.value_type} · {row.scope === 'platform_only' ? 'Platform only' : row.scope === 'project' ? 'Project workspace' : 'Platform default'}</div></div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>{row.description}</div>
        <input list={row.value_type === 'boolean' ? 'parameter-booleans' : undefined} aria-label={`Value for ${key}`} disabled={!canEdit} value={values[key] ?? ''} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} style={{ minWidth: 0, padding: '8px 9px', background: 'var(--bg)', color: 'var(--tx)', border: '1px solid var(--line)', borderRadius: 4, fontFamily: row.value_type === 'json' || row.value_type === 'secret_ref' ? 'var(--font-mono)' : undefined }} />
        {row.restart_required && <small>Restart pending. Active value: {formatValue(row.active_value)}</small>}
        <button type="button" className="btn btn-primary" disabled={!canEdit || saving === key} onClick={() => void save(row)}><Save size={13} /> {saving === key ? 'Saving…' : 'Save'}</button>
      </div>; })}
    </div>}
  </section>;
}
