import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { JiraFieldMappingCardProps } from './types';

export const JiraFieldMappingCard = ({ mappings, onChange, readOnly = false }: JiraFieldMappingCardProps) => {
  const [search, setSearch] = useState('');
  const visible = mappings.filter(row => `${row.sourceField} ${row.targetField}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="connector-field-mapping" aria-label="Jira custom field mapping">
    <div className="connector-field-mapping-heading"><div><h3>Field mapping</h3><p>Map a verified Jira custom field ID to its incident evidence label.</p></div><span>{mappings.length} fields</span></div>
    <label className="connector-search"><input aria-label="Search field mappings" placeholder="Find a field or label…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {visible.map(row => <div className="connector-mapping-row" key={row.id}>
      <label>Jira field ID<input className="prism-input mono" value={row.sourceField} pattern="customfield_[0-9]{1,12}" placeholder="customfield_…" disabled={readOnly} onChange={event => onChange(mappings.map(item => item.id === row.id ? {...item, sourceField: event.target.value} : item))} /></label>
      <label>Evidence label<input className="prism-input" value={row.targetField} maxLength={128} disabled={readOnly} onChange={event => onChange(mappings.map(item => item.id === row.id ? {...item, targetField: event.target.value} : item))} /></label>
      <button type="button" className="btn btn-secondary" aria-label={`Remove mapping ${row.sourceField || 'new field'}`} disabled={readOnly} onClick={() => onChange(mappings.filter(item => item.id !== row.id))}><Trash2 size={14} /></button>
    </div>)}
    {!visible.length && <p className="prism-field-hint">{search ? 'No fields match your search.' : 'No custom fields mapped. Add IDs verified in your Jira instance.'}</p>}
    {!readOnly && <button type="button" className="btn btn-secondary" disabled={mappings.length >= 100} onClick={() => {setSearch(''); onChange([...mappings, {id: crypto.randomUUID(), sourceField:'', targetField:'', fieldType:'string', required:false, defaultValue:''}]);}}><Plus size={14} /> Add field mapping</button>}
  </section>;
};
