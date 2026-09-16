import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Save, Lock, ShieldCheck } from 'lucide-react';
import { NotificationBanner } from './NotificationBanner';
import { defineParameter, fetchParameters, setParameterOverride } from '../services/api';
import '../styles/admin-configuration.css';
import type { ParameterDefinitionRow, Principal } from '../types/api';
import {
  areAllowedValuesScalar,
  parseTypedValue,
  valuesMatch,
} from '../utils/parameterValues';

type PanelScope = 'platform' | 'project';

interface ParameterSettingsPanelProps {
  principal: Principal;
  scope: PanelScope;
  tool?: string;
  excludeNames?: string[];
  includeNames?: string[];
}

const formatValue = (value: unknown): string =>
  value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

const parseValue = (raw: string, type: ParameterDefinitionRow['value_type'], allowedValues?: unknown[] | null): unknown => {
  const parsed = parseTypedValue(raw, type);
  if (allowedValues?.length && !allowedValues.some(value => valuesMatch(parsed, value))) {
    throw new Error(`Value must be one of: ${allowedValues.map(item => JSON.stringify(item)).join(', ')}`);
  }
  return parsed;
};

export function ParameterSettingsPanel({ principal, scope, tool, excludeNames, includeNames }: ParameterSettingsPanelProps) {
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPlatformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const canProjectOverride = isPlatformAdmin || principal.roles.includes('PROJECT_OWNER');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchParameters(scope === 'project' ? 'project' : undefined);
      setParameters(rows);
      setValues(
        Object.fromEntries(
          rows.map(row => [
            `${row.tool}.${row.variable_name}`,
            formatValue(scope === 'project' ? row.effective_value : row.default_value),
          ])
        )
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load parameter definitions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [scope, tool]);

  const visible = useMemo(
    () =>
      parameters.filter(
        row =>
          (!tool || row.tool === tool) &&
          !excludeNames?.includes(row.variable_name) &&
          (!includeNames || includeNames.includes(row.variable_name)) &&
          (scope === 'project' ? row.project_visible : true)
      ),
    [parameters, scope, tool, excludeNames, includeNames]
  );

  const isEditable = (row: ParameterDefinitionRow) => {
    if (row.enabled === false) return false;
    if (row.effective_state === 'DISABLED') return false;
    if (scope === 'platform') {
      return isPlatformAdmin;
    }
    return canProjectOverride && row.scope === 'project' && row.allow_project_override;
  };

  const getEffectiveStateDisplay = (row: ParameterDefinitionRow) => {
    if (row.enabled === false) return { label: 'Disabled by platform policy', type: 'disabled' };
    if (row.effective_state === 'DISABLED') return { label: 'Inherited disabled state', type: 'disabled' };
    if (row.effective_state === 'INHERIT') return { label: 'Inherits platform default', type: 'inherit' };
    if (row.effective_state === 'SET') return { label: 'Project override set', type: 'set' };
    return { label: 'Platform default active', type: 'default' };
  };

  const resolveScopeLabel = (row: ParameterDefinitionRow) =>
    row.scope === 'platform_only'
      ? 'Platform policy'
      : row.scope === 'project'
      ? 'Project override permitted'
      : 'Runtime profile';

  const hasAllowedValues = (row: ParameterDefinitionRow) =>
    Array.isArray(row.allowed_values) && row.allowed_values.length > 0;

  const formatAllowedValues = (row: ParameterDefinitionRow) =>
    hasAllowedValues(row) ? row.allowed_values!.map(item => formatValue(item)).join(' | ') : '';

  const save = async (row: ParameterDefinitionRow) => {
    const key = `${row.tool}.${row.variable_name}`;
    setSaving(key);
    setError(null);
    setNotice(null);
    try {
      const value = parseValue(values[key] ?? '', row.value_type, row.allowed_values ?? null);
      let restartRequired = false;
      if (scope === 'platform') {
        const result = await defineParameter(row.tool, row.variable_name, {
          value_type: row.value_type,
          description: row.description,
          default_value: value,
          allow_project_override: row.allow_project_override,
          scope: row.scope,
          icon: row.icon || 'settings',
          category: row.category,
          subcategory: row.subcategory ?? null,
          allowed_values: row.allowed_values ?? null,
          enabled: row.enabled ?? true,
          expected_revision: row.revision,
        });
        restartRequired = Boolean(result?.restart_required);
      } else {
        await setParameterOverride(row.tool, row.variable_name, {
          value,
          expected_revision: row.override_revision ?? 0,
          expected_definition_revision: row.revision,
        });
      }
      setNotice(
        restartRequired
          ? `${key} saved. Runtime configuration change requires an API restart.`
          : `${key} saved.`
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save parameter.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section aria-label={`${scope} runtime parameters`} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>
            {scope === 'platform' ? 'Platform Policy Controls' : 'Project Workspace Overrides'}
          </h3>
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
            {scope === 'platform'
              ? 'Enforce deployment baselines, security boundaries, and connector defaults across all projects.'
              : 'Tune operational parameters and active connector limits within this project scope.'}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <datalist id="parameter-booleans">
        <option value="true" />
        <option value="false" />
      </datalist>

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      {notice && (
        <NotificationBanner
          type="success"
          message={notice}
          onClose={() => setNotice(null)}
          style={{ marginBottom: 12 }}
        />
      )}

      {loading ? (
        <p role="status">Loading parameter definitions…</p>
      ) : visible.length === 0 ? (
        <p className="page-subtitle">No parameters are available in this scope.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visible.map(row => {
            const key = `${row.tool}.${row.variable_name}`;
            const canEdit = isEditable(row);
            const stateInfo = getEffectiveStateDisplay(row);
            const isScalarAllowed = areAllowedValuesScalar(row.allowed_values);
            const isRowDisabled = row.enabled === false || row.effective_state === 'DISABLED';

            return (
              <div
                key={key}
                className={`parameter-setting-row ${isRowDisabled ? 'is-disabled-state' : ''} ${!canEdit ? 'is-locked-state' : ''}`}
                style={{
                  borderLeft:
                    row.effective_state === 'SET'
                      ? '3px solid #22c55e'
                      : isRowDisabled
                      ? '3px solid var(--acc-rose, #ef4444)'
                      : '3px solid var(--line)',
                  background: isRowDisabled ? 'rgba(239, 68, 68, 0.03)' : undefined,
                }}
              >
                <div>
                  {/* Taxonomy Breadcrumb */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{row.main || row.tool}</span>
                    <span>/</span>
                    <span>{row.category || 'operational'}</span>
                    {row.subcategory && (
                      <>
                        <span>/</span>
                        <span style={{ color: 'var(--acc)' }}>{row.subcategory}</span>
                      </>
                    )}
                    <span
                      style={{
                        marginLeft: 'auto',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        background:
                          stateInfo.type === 'set'
                            ? 'rgba(34, 197, 94, 0.15)'
                            : stateInfo.type === 'disabled'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'var(--card-subtle)',
                        color:
                          stateInfo.type === 'set'
                            ? '#22c55e'
                            : stateInfo.type === 'disabled'
                            ? 'var(--acc-rose, #ef4444)'
                            : 'var(--muted)',
                        border: '1px solid var(--line)',
                      }}
                    >
                      {row.effective_state || (row.enabled === false ? 'DISABLED' : 'SET')}
                    </span>
                  </div>

                  <code>{key}</code>

                  <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>
                    {row.value_type} · {resolveScopeLabel(row)}
                  </div>

                  <div
                    style={{
                      color:
                        stateInfo.type === 'disabled'
                          ? 'var(--danger, #ef4444)'
                          : stateInfo.type === 'set'
                          ? '#22c55e'
                          : 'var(--muted)',
                      fontSize: 11,
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {isRowDisabled ? <Lock size={11} /> : stateInfo.type === 'set' ? <ShieldCheck size={11} /> : null}
                    {stateInfo.label}
                  </div>

                  {hasAllowedValues(row) && !isScalarAllowed && (
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                      Allowed values: {formatAllowedValues(row)}
                    </div>
                  )}
                </div>

                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{row.description}</div>

                {/* Value Input: Constrained Dropdown if scalar allowed_values; otherwise standard input */}
                <div>
                  {isScalarAllowed ? (
                    <select
                      aria-label={`Value for ${key}`}
                      disabled={!canEdit}
                      value={values[key] ?? ''}
                      onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        padding: '8px 9px',
                        background: 'var(--bg)',
                        color: 'var(--tx)',
                        border: '1px solid var(--line)',
                        borderRadius: 4,
                      }}
                    >
                      {row.allowed_values!.map((optVal, idx) => {
                        const strVal = formatValue(optVal);
                        return (
                          <option key={idx} value={strVal}>
                            {strVal}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input
                      list={row.value_type === 'boolean' ? 'parameter-booleans' : undefined}
                      aria-label={`Value for ${key}`}
                      disabled={!canEdit}
                      value={values[key] ?? ''}
                      onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        padding: '8px 9px',
                        background: 'var(--bg)',
                        color: 'var(--tx)',
                        border: '1px solid var(--line)',
                        borderRadius: 4,
                        fontFamily:
                          row.value_type === 'json' || row.value_type === 'secret_ref'
                            ? 'var(--font-mono)'
                            : undefined,
                      }}
                    />
                  )}

                  {row.restart_required && (
                    <small style={{ color: 'var(--acc-amber, #f59e0b)', display: 'block', marginTop: 3 }}>
                      Restart pending. Active value: {formatValue(row.active_value)}
                    </small>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canEdit || saving === key}
                  onClick={() => void save(row)}
                  title={!canEdit ? 'Editing locked by governance or scope' : 'Save parameter changes'}
                >
                  <Save size={13} /> {saving === key ? 'Saving…' : 'Save'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
