import { useCallback, useEffect, useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import { fetchCapabilities, fetchTools, setProjectAvailability } from '../../services/api';
import type { CapabilityItem, ToolDefinition } from '../../types/api';

export function ConnectorProjectPolicy({ connectorId, readOnly }: { connectorId: string; readOnly: boolean }) {
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [tool, setTool] = useState<ToolDefinition>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [catalog, tools] = await Promise.all([fetchCapabilities(true), fetchTools()]);
    setCapabilities(catalog.filter(capability => [...(capability.requires?.connectors || []), ...(capability.optional?.connectors || [])].includes(connectorId)));
    setTool(tools.find(item => (item.system_name || item.id) === connectorId));
    setError('');
  }, [connectorId]);
  useEffect(() => { void load().catch(error => setError(error instanceof Error ? error.message : 'Unable to load project access.')).finally(() => setLoading(false)); }, [load]);
  async function toggle(kind: 'connectors' | 'capabilities', id: string, current: boolean) {
    setBusy(id); setError('');
    try { await setProjectAvailability(kind, id, !current, current); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to update project access. Refresh and try again.'); }
    finally { setBusy(undefined); }
  }
  return <section className="rca_assist-card" aria-labelledby="connector-capabilities-title">
    <header className="rca_assist-card-header"><div className="rca_assist-card-title-wrap"><div className="rca_assist-card-icon"><Layers size={16} /></div><div><h2 id="connector-capabilities-title" className="rca_assist-card-title">Project capabilities</h2><p className="rca_assist-card-desc">Availability for every connection of this connector in the current project. Changes apply immediately.</p></div></div></header>
    <div className="rca_assist-card-body" aria-busy={loading || Boolean(busy)}>
      {error && <p role="alert" className="cf-error">{error} <button className="btn btn-secondary" onClick={() => { void load().catch(error => setError(String(error))); }}><RefreshCw size={13} /> Retry</button></p>}
      {loading ? <p className="rca_assist-field-hint">Loading project capabilities…</p> : <>
        {tool?.project_enabled !== undefined && (
          <label className="connector-policy-switch">
            <span>
              <strong>Enable {tool.name || connectorId} for Project Investigations</strong>
              <small>{tool.description || 'Authorize workflow capabilities to query this connector for investigation evidence.'}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={tool.project_enabled}
              disabled={readOnly || Boolean(busy)}
              onChange={() => void toggle('connectors', tool.id, tool.project_enabled!)}
            />
          </label>
        )}
        {capabilities.map(capability => <label className="connector-policy-switch" key={capability.id}><span><strong>{capability.name}</strong><small>{capability.description}</small><small>Minimum role: {capability.permissions?.minimum_role || capability.permissions?.allowed_roles?.join(', ') || 'Project policy'}</small></span><input type="checkbox" role="switch" checked={capability.project_enabled ?? capability.enabled ?? false} disabled={readOnly || Boolean(busy) || capability.project_enabled === undefined} onChange={() => void toggle('capabilities', capability.id, capability.project_enabled!)} /></label>)}
        {!capabilities.length && <p className="rca_assist-field-hint">No published capabilities reference this connector.</p>}
      </>}
    </div>
  </section>;
}
