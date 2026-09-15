import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { applyProjectTemplate, fetchProjectTemplateBinding, fetchHarnessLibrary } from '../services/api';
import type { ProjectTemplateBinding, HarnessResponse } from '../types/api';

/** Published templates share the same selection and revision checks as the runtime. */
export function ProjectHarnessSetup({ canEdit, onApplied }: { canEdit: boolean; onApplied: () => Promise<void> }) {
  const [binding, setBinding] = useState<ProjectTemplateBinding | null>(null);
  const [harness, setHarness] = useState<HarnessResponse | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try {
      const [nextBinding, nextHarness] = await Promise.all([fetchProjectTemplateBinding(), fetchHarnessLibrary()]);
      setBinding(nextBinding); setHarness(nextHarness);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load project agents. Try again.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const template = binding?.templates.find(item => `${item.template_id}@${item.version}` === selected);
  const apply = async () => {
    if (!template || !binding) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await applyProjectTemplate(template, binding);
      setNotice(`${template.name} ${template.version} applied. New investigations now use its settings.`);
      await onApplied();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the template. Your selection is preserved.'); }
    finally { setBusy(false); }
  };
  return <section className="ps-card ps-harness-setup" aria-labelledby="project-agents-title" aria-busy={busy}>
    <div className="ps-card-header"><div>
      <h2 id="project-agents-title" className="ps-card-title">Choose how your project investigates</h2>
      <p className="ps-card-subtitle">A harness is the set of agents, tools and workflow used for an investigation. Start with a published project template or keep the current setup.</p>
    </div><button className="btn btn-secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />Refresh</button></div>
    {error && <p className="ps-alert-banner error" role="alert">{error} Refresh to review the latest versions before trying again.</p>}
    {notice && <p className="ps-alert-banner success" role="status"><CheckCircle2 size={16} />{notice}</p>}
    {!binding && busy && <p role="status">Loading published templates and active agents…</p>}
    {binding && <>
      <h3>Published project templates</h3>
      {binding.templates.length ? <>
        <label className="ps-form-label" htmlFor="project-template">Choose a template</label>
        <select id="project-template" className="ps-form-select" value={selected} disabled={busy || !canEdit} onChange={event => setSelected(event.target.value)}>
          <option value="">Keep the current setup</option>
          {binding.templates.map(item => <option key={`${item.template_id}@${item.version}`} value={`${item.template_id}@${item.version}`}>{item.name} · {item.version}</option>)}
        </select>
        {template && <div className="ps-template-review">
          <h3>Review {template.name}</h3>
          <p>This updates these project settings immediately: {Object.keys(template.definition).map(key => key.replaceAll('_', ' ')).join(', ')}. Other project settings and parameter overrides are kept.</p>
          <details><summary>Inspect the template settings</summary><pre>{JSON.stringify(template.definition, null, 2)}</pre></details>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy || !canEdit}>{busy ? 'Applying…' : 'Apply this template'}</button>
        </div>}
      </> : <p>No published project templates are available. Keep the current harness or ask a platform administrator to publish a template.</p>}
      <p className="ps-form-hint">{binding.binding ? `Applied template: ${binding.binding.template_id} ${binding.binding.template_version}. Synchronization: ${binding.status.toLowerCase().replaceAll('_', ' ')}.` : 'This project uses its current harness settings without a managed template.'}</p>
    </>}
    {harness && <>
      <h3>Current project agents</h3>
      {harness.effective_agents.length ? <ul className="ps-agent-list">{harness.effective_agents.map(id => {
        const definition = harness.document.agents.find(item => item.definition.id === id)?.definition;
        return <li key={id}><strong>{definition?.name || id}</strong><p>{definition?.description || 'Selected by the project harness.'}</p></li>;
      })}</ul> : <p>No agents are currently selected. Review the harness before starting an investigation.</p>}
      <p>Custom agents require approval from another administrator before they can be used.</p>
      <div className="ps-review-sections"><a className="btn btn-secondary" href="#harness-library">Manage harness <ExternalLink size={14} /></a><a className="btn btn-secondary" href="#agents">Review custom agents <ExternalLink size={14} /></a></div>
    </>}
  </section>;
}
