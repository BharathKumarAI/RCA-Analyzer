import { useEffect, useId, useState } from 'react';
import { fetchCapabilities, fetchConnectorTemplates, fetchPrincipal, fetchProjectConnectors, getProjectContext, getSessionGeneration } from '../services/api';
import type { CapabilityItem, ConnectorTemplateItem, ProjectConnectorInstanceItem, RunConnectorSelections } from '../types/api';

interface ConnectorChoice { label: string; value: { instance_id: string; environment_id?: string } }
interface ConnectorGroup { adapter: string; required: boolean; requiresSelection: boolean; choices: ConnectorChoice[] }

export function connectorChoices(capability: CapabilityItem, instances: ProjectConnectorInstanceItem[], templates: ConnectorTemplateItem[]): ConnectorGroup[] {
  const required = capability.required_connectors ?? capability.requires?.connectors ?? [];
  const optional = capability.optional_connectors ?? capability.optional?.connectors ?? [];
  return [...new Set([...required, ...optional])].map(adapter => {
    const choices: ConnectorChoice[] = [];
    const candidates = instances.filter(instance => instance.enabled === true && instance.status === 'enabled').map(instance => ({
      instance,
      template: templates.find(item => (item.system_name === instance.template_id || item.type === instance.template_id) && (item.version || '1.0.0') === (instance.template_version || '1.0.0')),
    })).filter(({ instance, template }) => (template?.provider_adapter_id || instance.template_id) === adapter);
    for (const { instance, template } of candidates) {
      if (!template || (template.status ?? template.availability ?? 'published') !== 'published' || template.platform_enabled === false || template.is_enabled_by_policy === false) continue;
      const allBindings = instance.bindings ?? [];
      const bindings = allBindings.filter(binding => (binding.status ?? 'active') === 'active');
      // A duplicate environment cannot be resolved by the runtime selector.
      const environments = bindings.map(binding => binding.project_env_id).filter(environment => environment && bindings.filter(binding => binding.project_env_id === environment).length === 1);
      const dependent = (instance.definition_json?.environment_dependency || instance.environment_dependency) === 'dependent';
      if (!dependent && allBindings.length === 0 && !instance.environment_connections?.length) choices.push({ label: instance.instance_id, value: { instance_id: instance.instance_id } });
      for (const environment of environments) choices.push({ label: `${instance.instance_id} · ${environment}`, value: { instance_id: instance.instance_id, environment_id: environment } });
    }
    // Another enabled instance still makes automatic resolution ambiguous even
    // when its template version or bindings cannot produce a selectable choice.
    const ambiguousEnvironment = candidates.some(({ instance }) => (instance.bindings ?? []).filter(binding => (binding.status ?? 'active') === 'active').length > 1);
    return { adapter, required: required.includes(adapter), requiresSelection: candidates.length > 1 || ambiguousEnvironment, choices };
  }).filter(group => group.choices.length > 0);
}

const choiceKey = (value?: ConnectorChoice['value']) => value ? JSON.stringify([value.instance_id, value.environment_id ?? null]) : '';

export function connectorSelectionsReady(groups: ConnectorGroup[], selections: RunConnectorSelections): boolean {
  return Object.entries(selections).every(([adapter, value]) => groups.some(group => group.adapter === adapter && group.choices.some(choice => choiceKey(choice.value) === choiceKey(value))))
    && groups.every(group => !group.required || !group.requiresSelection || Boolean(selections[group.adapter]));
}

export async function loadRunConnectorGroups(capabilityId: string): Promise<ConnectorGroup[]> {
  const generation = getSessionGeneration();
  const projectId = getProjectContext() || (await fetchPrincipal()).project_id;
  if (generation !== getSessionGeneration()) throw new Error('Project context changed. Reload investigation sources.');
  const [capabilities, instances, templates] = await Promise.all([fetchCapabilities(), fetchProjectConnectors(projectId), fetchConnectorTemplates('published')]);
  if (generation !== getSessionGeneration()) throw new Error('Project context changed. Reload investigation sources.');
  const capability = capabilities.find(item => item.id === capabilityId && item.is_authorized && item.runtime_supported !== false);
  if (!capability) throw new Error('This investigation capability is unavailable in the selected project.');
  return connectorChoices(capability, instances, templates);
}

export function useRunConnectorSelections(capabilityId: string) {
  const projectId = getProjectContext();
  const scope = JSON.stringify([getSessionGeneration(), projectId, capabilityId]);
  const [state, setState] = useState<{ scope: string; groups: ConnectorGroup[]; error: string | null }>({ scope: '', groups: [], error: null });
  const [selected, setSelected] = useState<{ scope: string; values: RunConnectorSelections }>({ scope: '', values: {} });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ scope: '', groups: [], error: null });
    setSelected(previous => previous.scope === scope ? previous : { scope, values: {} });
    if (!capabilityId) return;
    const load = async () => {
      const groups = await loadRunConnectorGroups(capabilityId);
      if (!cancelled) {
        setState({ scope, groups, error: null });
        setSelected(previous => ({ scope, values: Object.fromEntries(Object.entries(previous.scope === scope ? previous.values : {}).filter(([adapter, value]) => groups.some(group => group.adapter === adapter && group.choices.some(choice => choiceKey(choice.value) === choiceKey(value))))) }));
      }
    };
    void load().catch(cause => { if (!cancelled) setState({ scope, groups: [], error: cause instanceof Error ? cause.message : 'Unable to load project sources.' }); });
    return () => { cancelled = true; };
  }, [capabilityId, projectId, scope, revision]);
  const selections = selected.scope === scope ? selected.values : {};
  const loading = Boolean(capabilityId) && state.scope !== scope;
  const groups = state.scope === scope ? state.groups : [];
  const error = state.scope === scope ? state.error : null;
  const ready = !loading && !error && connectorSelectionsReady(groups, selections);
  return { groups, selections, loading, error, ready,
    setSelections: (values: RunConnectorSelections) => setSelected({ scope, values }),
    reload: () => setRevision(value => value + 1),
  };
}

export function RunConnectorSelectors({ state, disabled = false }: { state: ReturnType<typeof useRunConnectorSelections>; disabled?: boolean }) {
  const id = useId();
  if (state.loading) return <p role="status">Loading project sources…</p>;
  if (state.error) return <div role="alert">Could not load project sources: {state.error} <button type="button" className="btn btn-secondary" onClick={state.reload} disabled={disabled}>Retry sources</button></div>;
  if (!state.groups.length) return null;
  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '12px 0', minWidth: 0 }}>
    <legend>Investigation sources</legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {state.groups.map(group => <label key={group.adapter} htmlFor={`${id}-${group.adapter}`} style={{ display: 'grid', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
        <span>{group.adapter}{group.required ? ' (required)' : ' (optional)'}</span>
        <select id={`${id}-${group.adapter}`} className="form-input" style={{ width: '100%', minWidth: 0 }} required={group.required && group.requiresSelection} value={choiceKey(state.selections[group.adapter])} onChange={event => {
          const choice = group.choices.find(item => choiceKey(item.value) === event.target.value);
          const next = { ...state.selections };
          if (choice) next[group.adapter] = choice.value; else delete next[group.adapter];
          state.setSelections(next);
        }}>
          <option value="">{group.required && group.requiresSelection ? 'Choose instance and environment' : 'Automatic (project configuration)'}</option>
          {group.choices.map(choice => <option key={choiceKey(choice.value)} value={choiceKey(choice.value)}>{choice.label}</option>)}
        </select>
      </label>)}
    </div>
  </fieldset>;
}
