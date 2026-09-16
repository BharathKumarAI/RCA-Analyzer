import React, { useCallback, useEffect, useRef, useState } from 'react';
import YAML from 'yaml';
import { AlertCircle, Bot, Check, ChevronDown, Download, FileCode, Folder, Layers, PanelLeft, PanelLeftClose, Play, RefreshCw, Save, Send, ShieldCheck, Upload, X } from 'lucide-react';
import { StudioGraphCanvas } from './canvas/StudioGraphCanvas';
import { ModuleLibrary, StudioLibraryModule } from './library/ModuleLibrary';
import { InspectorPanel } from './inspector/InspectorPanel';
import { Playground } from './playground/Playground';
import { FileTreeExplorer } from './yaml/FileTreeExplorer';
import { YamlSynchronizer } from './yaml/YamlSynchronizer';
import { ValidationPanel } from './validation/ValidationPanel';
import { serializeAgentToYaml } from './compiler/adk/agentConfig/serializer';
import type { AdkComponent, AdkAgentComponent, AdkWorkflowComponent, ConfigFileDefinition, HarnessDefinition } from './types/harness';
import { downloadStudioBlob, exportStudioBundle, fetchStudioDrafts, fetchStudioWorkspace, importStudioBundle, reviewStudioDraft, saveStudioDraft, StudioDiagnostic, StudioDraftSummary, StudioGraph, StudioTrace, StudioWorkspace, validateStudioWorkspace } from './harnessApi';
import '../../styles/harness-studio.css';

interface HarnessStudioPageProps { tenantId?: string; projectId?: string; }
type WorkspaceState = StudioWorkspace;

const errorDiagnostics = (diagnostics: StudioDiagnostic[]) => diagnostics.some(item => item.severity === 'error');

function asComponents(graph: StudioGraph, files: Record<string, string>): Record<string, AdkComponent> {
  const components: Record<string, AdkComponent> = {};
  graph.nodes.forEach(node => {
    const details = node.details || {};
    const kind = node.kind.toLowerCase();
    const isWorkflow = ['workflow', 'group', 'graph', 'sequence', 'parallel', 'loop', 'join', 'router', 'function'].some(token => kind.includes(token));
    const source = node.source === 'python' || node.source === 'code' ? 'python' : node.source === 'registry' ? 'rca_assist_registry' : 'adk_yaml';
    const origin = { source: source as AdkAgentComponent['origin']['source'], editable: node.editable !== false && node.enabled !== false, filePath: node.ref || node.source || undefined, componentId: node.id };
    if (isWorkflow) {
      const children = graph.nodes.filter(child => child.parent === node.id);
      const childIds = new Set(children.map(child => child.id));
      const workflow: AdkWorkflowComponent = {
        kind: 'workflow', id: node.id, name: node.label, description: typeof details.description === 'string' ? details.description : undefined,
        nodes: children.map(child => ({ id: child.id, name: child.label, type: /join/i.test(child.kind) ? 'join' : /tool|function/i.test(child.kind) ? 'function' : 'agent', agentRef: { type: 'registry', componentId: child.id } })),
        edges: graph.edges.filter(edge => childIds.has(edge.source) && childIds.has(edge.target)).map((edge, index) => ({ id: `${edge.source}:${edge.target}:${index}`, fromNode: edge.source, toNode: edge.target, label: edge.kind })), origin,
      };
      components[node.id] = workflow;
    } else {
      const agent: AdkAgentComponent = {
        kind: 'agent', id: node.id, agentClass: String(details.agent_class || details.class_name || node.kind || 'LlmAgent'), name: node.label,
        model: typeof details.model === 'string' ? details.model : undefined, description: typeof details.description === 'string' ? details.description : node.reason || undefined,
        modelProfile: typeof details.model_profile === 'string' ? details.model_profile : undefined, stageModel: typeof details.stage_model === 'string' ? details.stage_model : undefined,
        instruction: typeof details.instruction === 'string' ? details.instruction : undefined,
        tools: Array.isArray(details.tools) ? details.tools.map(tool => typeof tool === 'string' ? { name: tool } : tool as { name: string; args?: Record<string, unknown> }) : [],
        origin,
      };
      components[node.id] = agent;
    }
  });
  graph.nodes.forEach(node => {
    const component = components[node.id];
    if (component?.kind === 'agent') {
      component.sub_agents = graph.edges.filter(edge => edge.source === node.id && (edge.kind === 'sub_agent' || edge.kind === 'workflow' || edge.kind === 'contains')).map(edge => ({ type: 'registry', componentId: edge.target }));
    }
  });
  // Keep file-backed components visible even when the server has no resolved node.
  Object.keys(files).filter(path => /\.ya?ml$/i.test(path)).forEach(path => {
    if (Object.values(components).some(component => component.origin.filePath === path)) return;
  });
  return components;
}

function toHarness(workspace: WorkspaceState, previous?: HarnessDefinition): HarnessDefinition {
  const fileEntries = Object.entries(workspace.files || {});
  const configurationFiles: ConfigFileDefinition[] = fileEntries.map(([path, content]) => ({ path, content, kind: path.includes('rca_assist') || path.includes('harness') ? 'rca_assist_harness' : 'adk_agent' }));
  const root = workspace.graph.nodes.find(node => !node.parent || /root|orchestrator/i.test(node.kind)) || workspace.graph.nodes[0];
  const components = asComponents(workspace.graph, workspace.files || {});
  const supported = Array.isArray(workspace.compatibility?.supported) ? workspace.compatibility.supported.map(String) : [];
  return {
    apiVersion: 'rca_assist/v1', compatibility: { adkVersion: String(workspace.compatibility?.adk_version || workspace.compatibility?.adkVersion || '2.9.0'), agentConfigSchemaVersion: String(workspace.compatibility?.schema_version || workspace.compatibility?.agentConfigSchemaVersion || ''), features: { agentConfig: supported.includes('LlmAgent'), workflowRuntime: supported.some(item => ['Workflow', 'SequentialAgent', 'ParallelAgent'].includes(item)), taskApi: supported.includes('Task'), plugins: supported.includes('Plugin'), a2a: supported.includes('A2A') } },
    metadata: { id: `${workspace.capability}-harness`, name: String(workspace.capability || previous?.metadata.name || 'Harness Studio'), projectId: previous?.metadata.projectId || '', tenantId: previous?.metadata.tenantId || '', version: Number(workspace.revision || 0) || 1, revision: workspace.revision, etag: workspace.revision, updatedAt: new Date().toISOString(), updatedBy: 'workspace' },
    adk: { root: { type: 'registry', componentId: root?.id || '' }, components, configurationFiles, activeFilePath: previous?.adk.activeFilePath && configurationFiles.some(file => file.path === previous.adk.activeFilePath) ? previous.adk.activeFilePath : configurationFiles[0]?.path || '' },
    harness: previous?.harness || { tools: [], connectors: [], skills: [], memory: [], policies: [], optimizers: [], evaluations: [], observability: { tracing: true, feedback: false }, extensions: {} },
    runtimeGraph: workspace.graph,
  };
}

function normalizeWorkspace(payload: WorkspaceState): WorkspaceState {
  return { ...payload, files: payload.files || {}, graph: { nodes: payload.graph?.nodes || [], edges: payload.graph?.edges || [] }, diagnostics: payload.diagnostics || [], permissions: payload.permissions || {}, capability: payload.capability || 'incident_triage' };
}

export const HarnessStudioPage: React.FC<HarnessStudioPageProps> = ({ tenantId: _tenantId = '', projectId: _projectId = '' }) => {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [drafts, setDrafts] = useState<StudioDraftSummary[]>([]);
  const [harness, setHarness] = useState<HarnessDefinition | null>(null);
  const [mainMode, setMainMode] = useState<'canvas' | 'yaml'>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'inspector' | 'playground' | 'files'>('inspector');
  const [showValidation, setShowValidation] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 1024);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDirty, setLocalDirty] = useState(false);
  const [trace, setTrace] = useState<StudioTrace | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const validationRequest = useRef(0);
  const capability = workspace?.capability || 'incident_triage';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [workspacePayload, draftPayload] = await Promise.all([fetchStudioWorkspace(capability), fetchStudioDrafts(capability).catch(() => [])]);
      const loaded = normalizeWorkspace(workspacePayload);
      setDrafts(draftPayload);
      setWorkspace(loaded); setHarness(toHarness(loaded)); setSelectedNodeId(null); setSelectedCatalogId(null); setLocalDirty(false); setTrace(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load Harness Studio workspace'); }
    finally { setLoading(false); }
  }, [capability]);
  const resumeDraft = async (draftId: string) => {
    if (!draftId) { void load(); return; }
    setLoading(true); setError(null);
    try { const loaded = normalizeWorkspace(await fetchStudioWorkspace(capability, draftId)); setWorkspace(loaded); setHarness(toHarness(loaded)); setSelectedNodeId(null); setSelectedCatalogId(null); setLocalDirty(false); setTrace(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load draft'); }
    finally { setLoading(false); }
  };
  const refreshDrafts = async () => {
    try { setDrafts(await fetchStudioDrafts(capability)); } catch { /* Draft discovery is supplementary to the active workspace. */ }
  };
  useEffect(() => { void load(); }, [load]);

  const activeFile = harness?.adk.configurationFiles.find(file => file.path === harness.adk.activeFilePath) || harness?.adk.configurationFiles[0];
  const selectedComponent = harness && selectedNodeId && harness.adk.components[selectedNodeId] ? (() => { const component = harness.adk.components[selectedNodeId]; return { ...component, origin: { ...component.origin, editable: component.origin.editable && workspace?.permissions.edit !== false } }; })() : null;
  const selectedCatalog = workspace?.catalog?.find(item => item.id === selectedCatalogId) || null;
  const managePage = selectedCatalog && typeof selectedCatalog.details?.manage_page === 'string' && new Set(['capabilities', 'parameters', 'tools', 'skills', 'policy', 'runtime', 'optimization']).has(selectedCatalog.details.manage_page) ? selectedCatalog.details.manage_page : null;
  const diagnostics = workspace?.diagnostics || [];
  const revisionLabel = workspace && workspace.revision.length > 18 ? `${workspace.revision.slice(0, 10)}…${workspace.revision.slice(-6)}` : workspace?.revision || '';
  const dirty = localDirty;
  const libraryModules: StudioLibraryModule[] = workspace?.catalog?.map(item => ({ id: item.id, name: item.label, description: item.description || String(item.details?.description || item.source || 'Resolved by the active backend workspace'), category: item.category, kind: item.kind, editable: item.editable, source: item.source, details: item.details })) || workspace?.graph.nodes.map(node => ({ id: node.id, name: node.label, description: node.reason || String(node.details?.description || node.ref || 'Resolved by the active backend workspace'), category: node.parent ? 'Internal components' : 'Resolved workflow', kind: node.kind, editable: node.editable, source: node.ref || node.source, details: node.details })) || [];

  const selectLibraryModule = (id: string) => {
    const catalogItem = workspace?.catalog?.find(item => item.id === id);
    const graphId = typeof catalogItem?.details?.graph_id === 'string' ? catalogItem.details.graph_id : id;
    if (workspace?.graph.nodes.some(node => node.id === graphId)) {
      setSelectedCatalogId(null); setSelectedNodeId(graphId);
    } else {
      setSelectedNodeId(null); setSelectedCatalogId(id);
    }
    setRightTab('inspector');
  };

  const applyWorkspace = (next: WorkspaceState, previousGraph?: StudioGraph) => {
    const normalized = normalizeWorkspace(next);
    if (errorDiagnostics(normalized.diagnostics) && previousGraph) normalized.graph = previousGraph;
    setWorkspace(normalized); setHarness(previous => toHarness(normalized, previous || undefined));
  };

  const handleApplyYamlChanges = async (path: string, content: string) => {
    if (!workspace) return;
    const files = { ...workspace.files, [path]: content };
    setWorkspace(current => current ? { ...current, files } : current);
    setHarness(current => current ? { ...current, adk: { ...current.adk, configurationFiles: current.adk.configurationFiles.map(file => file.path === path ? { ...file, content, isDirty: true } : file) } } : current);
    setLocalDirty(true);
    const requestId = ++validationRequest.current;
    try {
      const result = normalizeWorkspace(await validateStudioWorkspace(files, workspace.capability));
      if (requestId !== validationRequest.current) return;
      const validated = { ...workspace, files, diagnostics: result.diagnostics, graph: errorDiagnostics(result.diagnostics) ? workspace.graph : result.graph, compatibility: result.compatibility };
      applyWorkspace(validated, workspace.graph);
      if (errorDiagnostics(result.diagnostics)) setMessage('YAML is saved in the editor, but the previous valid graph is still shown.');
      else setMessage('YAML validated. Save the draft to persist this revision.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'YAML validation failed'); }
  };

  const saveDraft = async () => {
    if (!workspace) return;
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await saveStudioDraft({ files: workspace.files, capability: workspace.capability, expected_revision: workspace.revision, draft_id: workspace.draft_id })); applyWorkspace(result); setLocalDirty(false); await refreshDrafts(); setMessage('Draft saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Draft save failed'); }
    finally { setSaving(false); }
  };
  const review = async (action: 'submit' | 'approve' | 'reject' | 'revoke') => {
    if (!workspace?.draft_id) { setError('Save a draft before requesting review.'); return; }
    const reason = window.prompt(`Reason for ${action}`, action === 'submit' ? 'Submitted from Harness Studio' : '') || '';
    if (!reason.trim()) return;
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await reviewStudioDraft(workspace.draft_id, action, workspace.revision, reason)); applyWorkspace(result); setLocalDirty(false); await refreshDrafts(); setMessage(`Draft ${action}ed.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `Unable to ${action} draft`); }
    finally { setSaving(false); }
  };
  const handleImport = async (file: File) => {
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await importStudioBundle(file, capability)); applyWorkspace(result); setLocalDirty(false); await refreshDrafts(); setSelectedNodeId(null); setSelectedCatalogId(null); setMessage('Bundle imported as a draft.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Bundle import failed'); }
    finally { setSaving(false); if (importRef.current) importRef.current.value = ''; }
  };
  const handleExport = async () => {
    setShowExportMenu(false);
    try { downloadStudioBlob(await exportStudioBundle(capability, workspace?.draft_id), `${capability}-harness.zip`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Bundle export failed'); }
  };

  const updateComponent = (updated: AdkComponent) => {
    if (!harness || !workspace) return;
    const path = updated.origin.filePath;
    if (!path || updated.kind !== 'agent') return;
    let content = serializeAgentToYaml(updated);
    try {
      const source = YAML.parse(workspace.files[path] || '') as Record<string, unknown>;
      if (source && typeof source === 'object') {
        source.agent_class = updated.agentClass;
        source.name = updated.name;
        if (updated.description) source.description = updated.description;
        else delete source.description;
        if (updated.instruction) source.instruction = updated.instruction;
        else delete source.instruction;
        if (updated.tools?.length) source.tools = updated.tools.map(tool => tool.args && Object.keys(tool.args).length ? { name: tool.name, args: tool.args } : { name: tool.name });
        else delete source.tools;
        const rca = source['x-rca'] && typeof source['x-rca'] === 'object' ? { ...(source['x-rca'] as Record<string, unknown>) } : {};
        if (updated.modelProfile) rca.model_profile = updated.modelProfile;
        if (updated.stageModel) rca.stage_model = updated.stageModel;
        if (Object.keys(rca).length) source['x-rca'] = rca;
        content = YAML.stringify(source);
      }
    } catch { /* The YAML editor owns syntax diagnostics; preserve its source if it is currently invalid. */ }
    const files = { ...workspace.files, [path]: content };
    const nextHarness = { ...harness, adk: { ...harness.adk, components: { ...harness.adk.components, [updated.id]: updated }, configurationFiles: harness.adk.configurationFiles.map(file => file.path === path ? { ...file, content, isDirty: true } : file) } };
    setHarness(nextHarness); setWorkspace({ ...workspace, files }); setLocalDirty(true);
  };

  if (loading) return <div className="harness-studio-root hs-loading"><RefreshCw size={17} className="hs-spin" /> Loading resolved workspace…</div>;
  if (!harness || !workspace) return <div className="harness-studio-root hs-error-state"><AlertCircle size={18} /><div><strong>Harness Studio could not load the backend workspace.</strong><p>{error || 'No workspace data was returned.'}</p><button type="button" className="btn btn-primary" onClick={() => void load()}>Retry</button></div></div>;

  return (
    <div className="harness-studio-root">
      <header className="hs-header">
        <div className="hs-header-left"><button type="button" className="icon-btn" onClick={() => setLibraryCollapsed(value => !value)} title={libraryCollapsed ? 'Show module library' : 'Hide module library'}>{libraryCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}</button><div className="hs-breadcrumbs"><strong>HARNESS STUDIO</strong><span>/</span><span>{harness.metadata.name}</span><span>/</span><span className="hs-breadcrumb-file">{activeFile?.path || 'workspace'}</span></div><div className={`hs-status-pill ${dirty ? 'dirty' : workspace.status}`}><span />{dirty ? 'Unsaved' : workspace.status.replace('_', ' ')} <span className="hs-revision-value" title={workspace.revision}>{revisionLabel}</span></div></div>
        <div className="hs-header-center"><div className="hs-view-segmented"><button type="button" className={`hs-view-btn ${mainMode === 'canvas' ? 'active' : ''}`} onClick={() => setMainMode('canvas')}><Layers size={13} /> Graph</button><button type="button" className={`hs-view-btn ${mainMode === 'yaml' ? 'active' : ''}`} onClick={() => setMainMode('yaml')}><FileCode size={13} /> YAML</button></div>{drafts.length > 0 && <select className="hs-draft-select" value={workspace.draft_id || ''} onChange={event => void resumeDraft(event.target.value)} aria-label="Resume draft"><option value="">Active workspace</option>{drafts.map(draft => <option key={draft.draft_id} value={draft.draft_id}>{draft.status} · {draft.draft_id.slice(0, 14)}</option>)}</select>}</div>
        <div className="hs-header-right"><button type="button" className="btn btn-secondary" onClick={() => setShowValidation(true)}><ShieldCheck size={13} /> {diagnostics.filter(item => item.severity === 'error').length ? `${diagnostics.filter(item => item.severity === 'error').length} errors` : 'Validated'}</button><input ref={importRef} type="file" accept=".zip,.yaml,.yml,application/zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport(file); }} /><button type="button" className="btn btn-secondary" onClick={() => importRef.current?.click()}><Upload size={13} /> Import</button><div className="hs-export-wrap"><button type="button" className="btn btn-secondary" onClick={() => setShowExportMenu(value => !value)}><Download size={13} /> Export <ChevronDown size={11} /></button>{showExportMenu && <div className="hs-export-menu"><button type="button" onClick={() => void handleExport()}><Download size={13} /> Download project archive</button><button type="button" onClick={() => { setShowExportMenu(false); if (activeFile) downloadStudioBlob(new Blob([activeFile.content], { type: 'text/yaml' }), activeFile.path.split('/').pop() || 'config.yaml'); }}><FileCode size={13} /> Download active YAML</button></div>}</div><button type="button" className="btn btn-primary" disabled={saving || workspace.permissions.edit === false} onClick={() => void saveDraft()}>{saving ? <RefreshCw size={13} className="hs-spin" /> : <Save size={13} />} Save draft</button></div>
      </header>
      {(error || message) && <div className={`hs-global-notice ${error ? 'error' : 'success'}`}>{error ? <AlertCircle size={14} /> : <Check size={14} />}<span>{error || message}</span><button type="button" onClick={() => { setError(null); setMessage(null); }} aria-label="Dismiss"><X size={13} /></button></div>}
      <div className={`hs-workspace ${libraryCollapsed ? 'library-collapsed' : ''} ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
        {!libraryCollapsed && <ModuleLibrary modules={libraryModules} onSelectModule={selectLibraryModule} />}
        {mainMode === 'canvas' ? <StudioGraphCanvas harness={harness} trace={trace} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : activeFile ? <YamlSynchronizer activeFile={activeFile} onApplyChanges={handleApplyYamlChanges} /> : <div className="hs-graph-empty">No editable YAML files are present in this workspace.</div>}
        {!inspectorCollapsed && <aside className="hs-right-panel"><div className="hs-panel-tabs"><button type="button" className={`hs-tab-btn ${rightTab === 'inspector' ? 'active' : ''}`} onClick={() => setRightTab('inspector')}><Bot size={13} /> Inspector</button><button type="button" className={`hs-tab-btn ${rightTab === 'playground' ? 'active' : ''}`} onClick={() => setRightTab('playground')}><Play size={13} /> Run</button><button type="button" className={`hs-tab-btn ${rightTab === 'files' ? 'active' : ''}`} onClick={() => setRightTab('files')}><Folder size={13} /> Files</button><button type="button" className="hs-panel-collapse" onClick={() => setInspectorCollapsed(true)} aria-label="Hide inspector" title="Hide inspector">×</button></div><div className="hs-panel-content">{rightTab === 'inspector' && (selectedComponent ? <InspectorPanel component={selectedComponent} harness={harness} onUpdateComponent={updateComponent} /> : selectedCatalog ? <div className="hs-panel-content hs-catalog-inspector"><span className="hs-kicker">CATALOG COMPONENT</span><h3>{selectedCatalog.label}</h3><div className="hs-inspector-provenance"><span>{selectedCatalog.category}</span>{selectedCatalog.editable === false && <span className="hs-inspector-readonly">Read only</span>}</div><p>{selectedCatalog.description}</p><div className="hs-form-hint">Kind: <code>{selectedCatalog.kind}</code></div>{selectedCatalog.source && <div className="hs-form-hint">Source: <code>{selectedCatalog.source}</code></div>}{selectedCatalog.source && harness.adk.configurationFiles.some(file => file.path === selectedCatalog.source) && <button type="button" className="btn btn-secondary" onClick={() => { setHarness(current => current ? { ...current, adk: { ...current.adk, activeFilePath: selectedCatalog.source! } } : current); setMainMode('yaml'); }}>Open source YAML</button>}{managePage && <a className="btn btn-secondary" href={`#${managePage}`}>Manage configuration</a>}{selectedCatalog.details && <details className="hs-catalog-details"><summary>Resolved details</summary><pre>{JSON.stringify(selectedCatalog.details, null, 2)}</pre></details>}</div> : <div className="hs-panel-empty">Select a resolved component in the graph to inspect it.</div>)}{rightTab === 'playground' && <Playground harness={harness} capability={capability} onTrace={setTrace} />}{rightTab === 'files' && <FileTreeExplorer files={harness.adk.configurationFiles} activeFilePath={harness.adk.activeFilePath} onSelectFile={path => { setHarness(current => current ? { ...current, adk: { ...current.adk, activeFilePath: path } } : current); setMainMode('yaml'); }} />}</div>{(workspace.draft_id && workspace.status !== 'APPROVED' || workspace.permissions.review || (workspace.permissions.revoke && workspace.status === 'APPROVED')) && <div className="hs-review-bar"><div><span className="hs-kicker">REVISION CONTROL</span><strong>{workspace.active_revision ? `Active ${workspace.active_revision}` : 'Draft review'}</strong></div><div className="hs-review-actions">{workspace.draft_id && workspace.status === 'DRAFT' && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void review('submit')}><Send size={12} /> Submit</button>}{workspace.permissions.review && workspace.draft_id && workspace.status === 'PENDING' && <><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void review('approve')}><Check size={12} /> Approve</button><button type="button" className="btn btn-quiet" disabled={saving} onClick={() => void review('reject')}>Reject</button></>}{workspace.permissions.revoke && workspace.draft_id && workspace.status === 'APPROVED' && <button type="button" className="btn btn-quiet" disabled={saving} onClick={() => void review('revoke')}>Revoke active</button>}</div></div>}</aside>}
        {inspectorCollapsed && <button type="button" className="hs-inspector-reopen" onClick={() => setInspectorCollapsed(false)} aria-label="Show inspector">Show inspector</button>}
      </div>
      {showValidation && <ValidationPanel diagnostics={diagnostics} onClose={() => setShowValidation(false)} />}
    </div>
  );
};
