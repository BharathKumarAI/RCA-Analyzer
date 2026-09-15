import { useState } from 'react';
import type { ConnectorTemplateItem, GovernanceTier } from '../../types/api';
import { saveConnectorFieldGovernance } from '../../services/api';

export function ConnectorFieldGovernance({ template, disabled, onSaved }: {
  template: ConnectorTemplateItem; disabled: boolean; onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const fields = template.field_governance || [];
  async function change(name: string, tier: GovernanceTier) {
    setBusy(true); setError(''); setMessage('');
    try {
      await saveConnectorFieldGovernance(template.system_name, template.governance_revision || 0, { [name]: tier });
      await onSaved();
      setMessage('Field access saved. New project edits and runs use this policy.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save field access. Refresh and try again.'); }
    finally { setBusy(false); }
  }
  return <section className="connector-field-governance" aria-labelledby="field-access-heading">
    <h3 id="field-access-heading">Field access</h3>
    <p>Choose who can see and edit each field across projects. Changes save immediately. Removing edit access clears that field’s project parameter overrides; saved connection settings remain locked until an administrator changes them.</p>
    <label className="connector-governance-search">Find a field<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search fields…" /></label>
    {disabled && <p>Save or discard your connection and template edits before changing field access.</p>}
    {error && <p className="connector-policy-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="connector-governance-fields" aria-busy={busy}>
      {fields.filter(field => `${field.label} ${field.variable_name}`.toLowerCase().includes(search.toLowerCase())).map(field =>
        <label key={field.variable_name} className="connector-governance-row">
          <span><strong>{field.label}</strong><small>{field.variable_name.replaceAll('_', ' ')}</small>{!field.editable_allowed && <small>Platform authority required to edit</small>}</span>
          <select aria-label={`${field.label} access`} value={field.tier} disabled={disabled || busy}
            onChange={event => void change(field.variable_name, event.target.value as GovernanceTier)}>
            <option value="platform_only">Platform Only</option>
            <option value="project_editable" disabled={!field.editable_allowed}>Project Editable</option>
            <option value="project_locked">Project Non-Editable</option>
          </select>
        </label>)}
    </div>
  </section>;
}
