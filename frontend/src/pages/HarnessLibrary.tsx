import React, { useEffect, useMemo, useState } from 'react';
import { Bot, BookOpen, Boxes, Check, Layers, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiError, fetchHarnessLibrary, resetHarnessLibrary, submitAgentYaml, updateHarnessLibrary, updatePlatformHarness } from '../services/api';
import { HarnessDocument, HarnessLibraryItem, HarnessResourceKind, HarnessResponse, HarnessSelection } from '../types/api';

const kinds: Array<{ id: HarnessResourceKind; label: string; icon: React.ReactNode }> = [
  { id: 'agent', label: 'Agents', icon: <Bot size={15} /> },
  { id: 'skill', label: 'Skills', icon: <Sparkles size={15} /> },
  { id: 'capability', label: 'Capabilities', icon: <Layers size={15} /> },
  { id: 'plugin', label: 'Plugin bundles', icon: <Boxes size={15} /> },
];
type LibraryResponse = HarnessResponse & {
  permissions?: { manage_project: boolean; manage_platform: boolean };
  skills?: Array<{ id: string; name?: string; description?: string; immutable?: boolean; enabled?: boolean; customizable?: boolean }>;
  capabilities?: Array<{ id: string; name?: string; description?: string; enabled?: boolean; customizable?: boolean }>;
};
const key = (item: HarnessLibraryItem) => `${item.kind}:${item.id}`;
const toItems = (response: LibraryResponse): HarnessLibraryItem[] => [
  ...response.document.agents.map(agent => ({ id: agent.definition.id, name: agent.definition.name, kind: 'agent' as const, description: agent.definition.description, version: agent.definition.version, source: 'platform' as const, inherited: response.effective_agents.includes(agent.definition.id), selected: !(response.selection.disabled_agents || []).includes(agent.definition.id) && (response.selection.agents.length === 0 || response.selection.agents.includes(agent.definition.id)), customizable: response.permissions?.manage_project !== false && agent.enabled, immutable: false, status: agent.enabled ? 'template' : 'disabled' })),
  ...response.document.plugins.map(plugin => ({ id: plugin.id, name: plugin.name, kind: 'plugin' as const, description: plugin.description, source: 'platform' as const, inherited: response.effective_plugins.includes(plugin.id), selected: !(response.selection.disabled_plugins || []).includes(plugin.id) && (response.selection.plugins.length === 0 || response.selection.plugins.includes(plugin.id)), customizable: response.permissions?.manage_project !== false && plugin.enabled, status: plugin.enabled ? 'template' : 'disabled' })),
  ...(response.skills || []).map(skill => ({ id: skill.id, name: skill.name || skill.id, kind: 'skill' as const, description: skill.description, source: 'platform' as const, inherited: response.effective_skills?.includes(skill.id) ?? skill.enabled !== false, selected: !(response.selection.disabled_skills || []).includes(skill.id), customizable: skill.customizable ?? !skill.immutable, immutable: skill.immutable, status: skill.enabled === false ? 'disabled' : 'platform' })),
  ...(response.capabilities || []).map(capability => ({ id: capability.id, name: capability.name || capability.id, kind: 'capability' as const, description: capability.description, source: 'platform' as const, inherited: response.effective_capabilities?.includes(capability.id) ?? capability.enabled !== false, selected: !(response.selection.disabled_capabilities || []).includes(capability.id), customizable: capability.customizable ?? capability.enabled !== false, status: capability.enabled === false ? 'disabled' : 'platform' })),
];

export const HarnessLibrary: React.FC = () => {
  const [items, setItems] = useState<HarnessLibraryItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState('');
  const [projectRevision, setProjectRevision] = useState('');
  const [document, setDocument] = useState<HarnessDocument | null>(null);
  const [canManageProject, setCanManageProject] = useState(false);
  const [canManagePlatform, setCanManagePlatform] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState(false);
  const [platformText, setPlatformText] = useState('');
  const [kind, setKind] = useState<HarnessResourceKind>('agent');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetchHarnessLibrary() as LibraryResponse;
      setCanManageProject(response.permissions?.manage_project ?? true);
      setCanManagePlatform(response.permissions?.manage_platform ?? false);
      const nextItems = toItems(response);
      setItems(nextItems); setRevision(response.revision); setProjectRevision(response.project_revision || ''); setDocument(response.document);
      setSelected(new Set(nextItems.filter(item => item.selected).map(item => key(item))));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Unable to load the harness library.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => items.filter(item => item.kind === kind && `${item.name} ${item.id} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())), [items, kind, query]);
  const counts = useMemo(() => kinds.map(entry => ({ ...entry, count: items.filter(item => item.kind === entry.id).length })), [items]);
  const toggle = (item: HarnessLibraryItem) => {
    if (!canManageProject || item.immutable || !item.customizable && item.source === 'platform') return;
    setSelected(current => { const next = new Set(current); if (next.has(key(item))) next.delete(key(item)); else next.add(key(item)); return next; });
  };
  const save = async () => {
    setSaving(true); setNotice(null); setError(null);
    try {
      const selection: HarnessSelection = {
        agents: [],
        disabled_agents: items.filter(item => item.kind === 'agent' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        plugins: [],
        disabled_plugins: items.filter(item => item.kind === 'plugin' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        disabled_skills: items.filter(item => item.kind === 'skill' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        disabled_capabilities: items.filter(item => item.kind === 'capability' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
      };
      const response = await updateHarnessLibrary(selection, revision, projectRevision);
      const nextItems = toItems(response); setItems(nextItems); setRevision(response.revision); setProjectRevision(response.project_revision || ''); setSelected(new Set(nextItems.filter(item => item.selected).map(item => key(item)))); setNotice('Project harness selection saved.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Unable to save project harness selection.'); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    if (!window.confirm('Reset this project to the platform harness defaults?')) return;
    setSaving(true); setNotice(null); setError(null);
    try { const response = await resetHarnessLibrary(projectRevision); const nextItems = toItems(response); setItems(nextItems); setRevision(response.revision); setProjectRevision(response.project_revision || ''); setSelected(new Set(nextItems.filter(item => item.selected).map(item => key(item)))); setNotice('Project harness reset to platform defaults.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Unable to reset the project harness.'); }
    finally { setSaving(false); }
  };
  const savePlatform = async () => {
    if (!document) return;
    setSaving(true); setError(null);
    try { const parsed = JSON.parse(platformText) as HarnessDocument; const response = await updatePlatformHarness(parsed, revision); setDocument(response.document); setRevision(response.revision); setProjectRevision(response.project_revision || ''); setItems(toItems(response)); setSelected(new Set(toItems(response).filter(item => item.selected).map(key))); setNotice('Platform harness templates saved.'); setEditingPlatform(false); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Platform catalog must be valid JSON and pass server validation.'); }
    finally { setSaving(false); }
  };
  const submitTemplate = async (item: HarnessLibraryItem) => {
    const agent = document?.agents.find(entry => entry.definition.id === item.id);
    if (!agent) return;
    setSaving(true); setError(null);
    try { await submitAgentYaml(JSON.stringify(agent.definition, null, 2)); setNotice(`Template '${item.name}' submitted for peer approval.`); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Unable to submit template for approval.'); }
    finally { setSaving(false); }
  };

  const ids = (resourceKind: HarnessResourceKind) => items.filter(item => item.kind === resourceKind && selected.has(key(item))).map(item => item.id);
  return <div className="view-container">
    <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Harness <span>Library</span></h1><p className="hero-lede">Manage shared platform templates and choose which resources each project inherits. Templates require approval before runtime use.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><ShieldCheck size={13} /> Platform governed</span><span className="hero-stat-chip"><b>{selected.size}</b> project resources selected</span></div></div><div className="hero-actions"><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || loading || !document || !canManageProject}><Check size={13} /> {saving ? 'Saving…' : 'Save project selection'}</button><button type="button" className="btn btn-open" onClick={() => void reset()} disabled={saving || loading || !document || !canManageProject}><RotateCcw size={13} /> Reset to platform</button>{canManagePlatform && <button type="button" className="btn btn-secondary" onClick={() => { setPlatformText(JSON.stringify(document, null, 2)); setEditingPlatform(true); }} disabled={!document || saving}>Edit platform catalog</button>}</div></section>
    {notice && <div className="notice-banner" role="status">{notice}</div>}{error && <div className="notice-banner red" role="alert">{error}<button type="button" className="btn btn-secondary" onClick={() => void load()}>Retry</button></div>}
    {editingPlatform && <div className="card" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 15 }}>Platform catalog templates</h2><p className="metric-meta">Edit the data-only catalog. Saving uses the loaded revision and validates all capability, skill, and agent references.</p><textarea value={platformText} onChange={event => setPlatformText(event.target.value)} rows={18} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }} /><div className="card-actions"><button type="button" className="btn btn-primary" onClick={() => void savePlatform()} disabled={saving || !canManagePlatform}>Save platform catalog</button><button type="button" className="btn btn-secondary" onClick={() => setEditingPlatform(false)}>Cancel</button></div></div>}
    <div className="toolbar"><div className="search-box"><Search size={14} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search shared resources…" /></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={13} /> Refresh</button></div>
    <div className="card" style={{ padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{counts.map(entry => <button type="button" key={entry.id} className={`btn ${kind === entry.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(entry.id)}>{entry.icon}{entry.label} ({entry.count})</button>)}<a className="btn btn-secondary" href="#skills"><BookOpen size={13} /> Customize skills</a><a className="btn btn-secondary" href="#project-setup"><Layers size={13} /> Customize capabilities</a></div>
    {loading ? <div className="card empty-state">Loading shared harness resources…</div> : <div className="card-list" style={{ marginTop: 14 }}>{filtered.map(item => { const locked = Boolean(item.immutable || item.source === 'platform' && !item.customizable); const active = selected.has(key(item)); return <article className="card" key={key(item)} style={{ opacity: locked ? .72 : 1 }}><div className="card-top"><div className="card-main"><div className="card-title-row"><h2 className="card-title">{item.name}</h2><span className="brand-badge">{item.kind}</span><span className={`badge ${active ? 'badge-active' : 'badge-neutral'}`}>{active ? 'INCLUDED' : 'EXCLUDED'}</span></div><p className="card-desc">{item.description || item.id}</p><div className="card-meta-pills"><span className="meta-pill">{item.source === 'platform' ? 'Platform template' : 'Project resource'}</span>{active && !item.inherited && <span className="meta-pill">Unavailable under saved platform or project rules</span>}{item.version && <span className="meta-pill">v{item.version}</span>}{locked && <span className="meta-pill">{item.status === 'disabled' ? 'Unavailable' : 'Read only'}</span>}</div></div><div className="card-actions"><button type="button" className={`btn ${active ? 'btn-primary' : 'btn-open'}`} onClick={() => toggle(item)} disabled={locked || saving} aria-pressed={active}><Plus size={13} /> {active ? 'Remove from project' : 'Add to project'}</button>{item.kind === 'agent' && <button type="button" className="btn btn-secondary" onClick={() => void submitTemplate(item)} disabled={saving}>Submit for approval</button>}</div></div></article>; })}{!filtered.length && <div className="card empty-state">No {kind}s match this search.</div>}</div>}
  </div>;
};
