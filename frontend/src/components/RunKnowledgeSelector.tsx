import { useEffect, useState } from 'react';
import { fetchKnowledge, getSessionGeneration, request } from '../services/api';
import type { KnowledgeItem, KnowledgeScopes, RunConnectorSelections } from '../types/api';
import '../styles/knowledge.css';

export interface RunKnowledgeSelection { environmentId: string; documentIds: string[] }

export function RunKnowledgeSelector({ capability, connectors, value, onChange, disabled = false }: {
  capability: string; connectors: RunConnectorSelections; value: RunKnowledgeSelection;
  onChange: (value: RunKnowledgeSelection) => void; disabled?: boolean;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [scopes, setScopes] = useState<KnowledgeScopes | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const generation = getSessionGeneration();
    Promise.all([fetchKnowledge(), request<KnowledgeScopes>('/api/v1/knowledge/scopes')]).then(([documents, catalog]) => {
      if (active && generation === getSessionGeneration()) { setItems(documents); setScopes(catalog); setError(''); }
    }).catch(cause => { if (active && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Knowledge selections could not load.'); });
    return () => { active = false; };
  }, [refresh]);
  const environments = value.environmentId ? [value.environmentId] : Object.values(connectors).flatMap(item => item.environment_id ? [item.environment_id] : []);
  const instances = Object.values(connectors).map(item => item.instance_id);
  const available = items.filter(item => item.status === 'approved' && item.okf_eligibility?.eligible !== false && [
    [item.associations?.capability_ids, capability ? [capability] : []],
    [item.associations?.environment_ids, environments],
    [item.associations?.connector_instance_ids, instances],
  ].every(([allowed, selected]) => !allowed?.length || allowed.some(id => selected?.includes(id))));
  const unavailable = value.documentIds.filter(id => !available.some(item => item.id === id));
  return <details className="run-knowledge-selector"><summary>Reference documents{value.documentIds.length ? ` · ${value.documentIds.length} selected` : ''}</summary>
    <p>Relevant approved knowledge is retrieved automatically. You can also select up to three documents for this investigation.</p>
    {error && <p role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => setRefresh(count => count + 1)}>Retry</button></p>}
    <fieldset disabled={disabled || !scopes}><legend className="knowledge-visually-hidden">Knowledge selection</legend>
      {!!scopes?.environment_ids.length && <label>Environment<select value={value.environmentId} onChange={event => onChange({ environmentId: event.target.value, documentIds: [] })}><option value="">Use source selection; otherwise project-wide</option>{scopes.environment_ids.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Approved documents<select multiple size={Math.min(4, Math.max(2, available.length))} value={value.documentIds} onChange={event => { const ids = Array.from(event.target.selectedOptions, option => option.value); if (ids.length > 3) { setError('Select at most three documents.'); return; } setError(''); onChange({ ...value, documentIds: ids }); }}>{available.map(item => <option key={item.id} value={item.id}>{item.title} · revision {item.revision}{item.associations?.required ? ' · required' : ''}</option>)}</select></label>
      {!available.length && <p>No approved documents match this capability and environment.</p>}
      {!!unavailable.length && <p role="alert">Your selection includes documents unavailable in the current scope. Clear or update the selection before running.</p>}
      <button type="button" className="btn btn-secondary" onClick={() => onChange({ environmentId: '', documentIds: [] })}>Clear references</button>
    </fieldset>
  </details>;
}
