import { useEffect, useId, useRef, useState } from 'react';
import { discoverJiraQueryFields, jiraConditionCount, previewJiraQuery, testJiraQuery, type JiraFilter, type JiraGroup, type JiraProjectRole, type JiraQuery, type JiraQueryField, type JiraQueryMatches, type JiraQueryMetadata } from '../../services/jiraQueries';

function Conditions({ group, fields, onChange, depth = 0, count, disabled }: {
  group: JiraGroup; fields: JiraQueryField[]; onChange: (value: JiraGroup) => void; depth?: number; count: number; disabled: boolean;
}) {
  const replace = (index: number, value: JiraFilter) => onChange({ ...group, filters: group.filters.map((item, i) => i === index ? value : item) });
  return <fieldset disabled={disabled} className="jira-query-group"><legend>{depth ? `Nested group ${depth}` : 'Issue filters'}</legend>
    <label>Match <select value={group.match} onChange={event => onChange({ ...group, match: event.target.value as JiraGroup['match'] })}><option value="all">All conditions (AND)</option><option value="any">Any condition (OR)</option></select></label>
    {group.filters.map((filter, index) => {
      const field = fields.find(item => item.id === filter.field);
      const values = Array.isArray(filter.value) ? filter.value.join('\n') : filter.value ?? '';
      return <div key={index} className="jira-query-condition">
        <label>Field<select value={filter.field} onChange={event => { const next = fields.find(item => item.id === event.target.value); if (next) replace(index, { field: next.id, operator: next.operators[0], value: '' }); }}>
          {!field && <option value={filter.field}>{filter.field} — reload field metadata</option>}{fields.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
        </select></label>
        <label>Operator<select value={filter.operator} onChange={event => replace(index, { ...filter, operator: event.target.value, value: event.target.value.includes('EMPTY') ? null : event.target.value.includes('IN') ? [] : '' })}>
          {!field?.operators.includes(filter.operator) && <option value={filter.operator}>{filter.operator}</option>}{field?.operators.map(operator => <option key={operator} value={operator}>{operator}</option>)}
        </select></label>
        {!filter.operator.includes('EMPTY') && <label>{filter.operator.includes('IN') ? 'Values (one per line)' : `Value${field?.value_type === 'number' ? ' (number)' : ''}`}
          {filter.operator.includes('IN') ? <textarea rows={2} maxLength={25600} value={values} onChange={event => replace(index, { ...filter, value: event.target.value.split('\n').map(value => field?.value_type === 'number' && value.trim() ? Number(value) : value) })} />
            : <input maxLength={512} type={field?.value_type === 'number' ? 'number' : 'text'} value={values} onChange={event => replace(index, { ...filter, value: field?.value_type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value })} />}
        </label>}
        <button type="button" className="btn btn-secondary" aria-label={`Remove condition ${index + 1}`} onClick={() => onChange({ ...group, filters: group.filters.filter((_, i) => i !== index) })}>Remove</button>
      </div>;
    })}
    {group.groups.map((child, index) => <div key={index}><Conditions group={child} fields={fields} depth={depth + 1} count={count} disabled={disabled} onChange={value => onChange({ ...group, groups: group.groups.map((item, i) => i === index ? value : item) })} /><button type="button" className="btn btn-secondary" aria-label={`Remove nested group ${index + 1}`} onClick={() => onChange({ ...group, groups: group.groups.filter((_, i) => i !== index) })}>Remove group</button></div>)}
    <div className="jira-query-actions"><button type="button" className="btn btn-secondary" disabled={!fields.length || count >= 30} onClick={() => onChange({ ...group, filters: [...group.filters, { field: fields[0].id, operator: fields[0].operators[0], value: '' }] })}>Add condition</button>
      <button type="button" className="btn btn-secondary" disabled={depth >= 4 || count >= 29 || !fields.length} onClick={() => onChange({ ...group, groups: [...group.groups, { match: 'all', filters: [{ field: fields[0].id, operator: fields[0].operators[0], value: '' }], groups: [] }] })}>Add nested group</button></div>
  </fieldset>;
}

export function JiraQueryBuilder({ projectId, instanceId, revision, environments, query, onQueryChange, mapping, savedMapping, onMappingChange, customJql, readOnly }: {
  projectId: string; instanceId?: string; revision?: number; environments: { id: string; name: string }[];
  query: JiraQuery; onQueryChange: (value: JiraQuery) => void; mapping: Record<string, string>; savedMapping: Record<string, string>;
  onMappingChange: (value: Record<string, string>) => void; customJql: string; readOnly: boolean;
}) {
  const titleId = useId();
  const [environment, setEnvironment] = useState('');
  const [metadata, setMetadata] = useState<JiraQueryMetadata | null>(null);
  const [preview, setPreview] = useState<JiraQueryMetadata | null>(null);
  const [matches, setMatches] = useState<JiraQueryMatches | null>(null);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const snapshot = JSON.stringify({ projectId, instanceId, revision, environment, query, mapping, customJql, limit });
  useEffect(() => { request.current?.abort(); setBusy(false); setPreview(null); setMatches(null); setError(null); return () => request.current?.abort(); }, [snapshot]);
  useEffect(() => { setMetadata(null); }, [projectId, instanceId, revision, environment]);
  const mappingChanged = JSON.stringify(Object.entries(mapping).sort()) !== JSON.stringify(Object.entries(savedMapping).sort());
  const unavailable = readOnly || !instanceId || busy || (environments.length > 0 && !environments.some(item => item.id === environment));
  const perform = async (action: 'metadata' | 'preview' | 'structured' | 'custom') => {
    if (unavailable || (action !== 'metadata' && mappingChanged)) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setPreview(null); setMatches(null);
    try {
      if (action === 'metadata') { const result = await discoverJiraQueryFields(projectId, instanceId!, environment || undefined, controller.signal); if (!controller.signal.aborted) setMetadata(result); }
      else if (action === 'preview') { const result = await previewJiraQuery(projectId, instanceId!, query, environment || undefined, controller.signal); if (!controller.signal.aborted) { setMetadata(result); setPreview(result); } }
      else { const result = await testJiraQuery(projectId, instanceId!, action === 'custom' ? { custom_jql: customJql } : { query }, limit, environment || undefined, controller.signal); if (!controller.signal.aborted) setMatches(result); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Jira query request failed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const fields = metadata?.query_fields || [];
  const selected = query.assignees || { member_ids: [], role_ids: [] };
  const updateAssignees = (value: typeof selected) => onQueryChange({ ...query, assignees: value.member_ids.length || value.role_ids.length ? value : null });
  return <section className="jira-query-builder" aria-labelledby={titleId}>
    <h3 id={titleId}>Jira query builder</h3><p>Build filters from this Jira instance’s searchable fields. The server always adds the saved Jira project scope. Query tests read issues; they do not enable polling or a connection.</p>
    {!instanceId && <p>Save this connection before loading fields or testing queries.</p>}
    {environments.length > 0 && <label>Saved environment<select value={environment} disabled={busy} onChange={event => setEnvironment(event.target.value)}><option value="">Choose environment</option>{environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <button type="button" className="btn btn-secondary" disabled={unavailable} onClick={() => void perform('metadata')}>Load fields and project members</button>
    {metadata && <p role="status">Field metadata from saved connection revision {metadata.instance_revision}. {fields.length} supported searchable fields.</p>}
    <Conditions group={query} fields={fields} count={jiraConditionCount(query)} disabled={readOnly || busy} onChange={group => onQueryChange({ ...query, ...group })} />
    <fieldset disabled={readOnly || busy}><legend>Sort results</legend>{query.order_by.map((sort, index) => <div key={index} className="jira-query-condition"><label>Sort field<select value={sort.field} onChange={event => onQueryChange({ ...query, order_by: query.order_by.map((item, i) => i === index ? { ...item, field: event.target.value } : item) })}>{!fields.some(item => item.id === sort.field) && <option value={sort.field}>{sort.field}</option>}{fields.filter(item => item.sortable).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Order<select value={sort.direction} onChange={event => onQueryChange({ ...query, order_by: query.order_by.map((item, i) => i === index ? { ...item, direction: event.target.value as 'ASC' | 'DESC' } : item) })}><option value="ASC">Ascending</option><option value="DESC">Descending</option></select></label><button type="button" className="btn btn-secondary" onClick={() => onQueryChange({ ...query, order_by: query.order_by.filter((_, i) => i !== index) })}>Remove sort</button></div>)}<button type="button" className="btn btn-secondary" disabled={query.order_by.length >= 3 || !fields.some(item => item.sortable)} onClick={() => { const field = fields.find(item => item.sortable); if (field) onQueryChange({ ...query, order_by: [...query.order_by, { field: field.id, direction: 'ASC' }] }); }}>Add sort</button></fieldset>
    <fieldset disabled={readOnly || busy}><legend>Assignees from saved project membership</legend><p>Choose members or project roles. Every selected member needs a saved canonical Jira account ID. Role membership is resolved by the server when testing.</p>
      {(['PROJECT_OWNER', 'PROJECT_MANAGER', 'PROJECT_ANALYST', 'PROJECT_VIEWER'] as JiraProjectRole[]).map(role => <label className="jira-query-check" key={role}><input type="checkbox" checked={selected.role_ids.includes(role)} onChange={event => updateAssignees({ ...selected, role_ids: event.target.checked ? [...selected.role_ids, role] : selected.role_ids.filter(item => item !== role) })} />{role.replace('PROJECT_', '').toLowerCase()}</label>)}
      {metadata?.members.map(member => <div key={member.subject} className="jira-query-condition"><label className="jira-query-check"><input type="checkbox" checked={selected.member_ids.includes(member.subject)} onChange={event => updateAssignees({ ...selected, member_ids: event.target.checked ? [...selected.member_ids, member.subject] : selected.member_ids.filter(item => item !== member.subject) })} />{member.name} ({member.subject})</label><label>Jira account ID<input maxLength={128} value={mapping[member.subject] || ''} onChange={event => { const next = { ...mapping }; if (event.target.value) next[member.subject] = event.target.value; else delete next[member.subject]; onMappingChange(next); }} /></label></div>)}
      {metadata && selected.member_ids.filter(subject => !metadata.members.some(member => member.subject === subject)).map(subject => <label className="jira-query-check" key={subject}><input type="checkbox" checked onChange={() => updateAssignees({ ...selected, member_ids: selected.member_ids.filter(item => item !== subject) })} />{subject} — unavailable in the current member list; remove before testing</label>)}
      {metadata && Object.keys(mapping).filter(subject => !metadata.members.some(member => member.subject === subject)).map(subject => <p key={subject}>Saved account mapping for unavailable member {subject} <button type="button" className="btn btn-secondary" onClick={() => { const next = { ...mapping }; delete next[subject]; onMappingChange(next); }}>Remove mapping</button></p>)}
      {metadata?.members.length === 250 && <p>The member list is bounded to 250 active project members.</p>}
      {!metadata && <p>Load project members to select people and configure account IDs.</p>}
    </fieldset>
    {mappingChanged && <p role="status">Save this connection to apply the changed member account mappings before validating or testing a query.</p>}
    <p>Builder filters and custom JQL are saved separately. Tests use the saved connection and account mappings; unsaved connection credentials or scope are not tested.</p>
    <div className="jira-query-actions"><label>Maximum matches<input type="number" min={1} max={50} step={1} value={limit} disabled={busy} onChange={event => setLimit(Number(event.target.value))} /></label>
      <button type="button" className="btn btn-secondary" disabled={unavailable || mappingChanged} onClick={() => void perform('preview')}>Validate builder</button>
      <button type="button" className="btn btn-primary" disabled={unavailable || mappingChanged || !Number.isInteger(limit) || limit < 1 || limit > 50} onClick={() => void perform('structured')}>Test builder matches</button>
      <button type="button" className="btn btn-secondary" disabled={unavailable || mappingChanged || !customJql.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50} onClick={() => void perform('custom')}>Test custom JQL matches</button></div>
    {busy && <p role="status">Reading Jira…</p>}{error && <p role="alert" className="project-error">{error}</p>}
    {preview?.jql && <div><p>Jira validated the syntax. Matching issues have not been read.</p><pre>{preview.jql}</pre></div>}
    {matches && <div aria-live="polite"><p>{matches.returned_count} issues returned at {new Date(matches.tested_at * 1000).toLocaleString()} using saved revision {matches.instance_revision}.{matches.possibly_truncated ? ' More matches may exist; this is a bounded sample.' : ''}</p><pre>{matches.jql}</pre>{matches.issues.length ? <div className="jira-query-table"><table><caption>Read-only Jira issue matches</caption><thead><tr><th scope="col">Issue</th><th scope="col">Summary</th><th scope="col">Status</th><th scope="col">Priority</th></tr></thead><tbody>{matches.issues.map(issue => <tr key={issue.key}><th scope="row">{issue.key}</th><td>{issue.summary}</td><td>{issue.status ?? 'Unknown'}</td><td>{issue.priority ?? 'Unknown'}</td></tr>)}</tbody></table></div> : <p>No matching issues were returned.</p>}</div>}
  </section>;
}
