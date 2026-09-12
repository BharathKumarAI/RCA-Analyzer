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
import { validateHarness } from './validation/validationEngine';
import { serializeAgentToYaml } from './compiler/adk/agentConfig/serializer';
import type { AdkComponent, AdkAgentComponent, AdkWorkflowComponent, ConfigFileDefinition, HarnessDefinition, StudioViewMode } from './types/harness';
import { downloadStudioBlob, exportStudioBundle, fetchStudioDrafts, fetchStudioWorkspace, importStudioBundle, reviewStudioDraft, saveStudioDraft, StudioDiagnostic, StudioDraftSummary, StudioGraph, validateStudioWorkspace } from './harnessApi';
import '../../styles/harness-studio.css';

interface HarnessStudioPageProps { tenantId?: string; projectId?: string; }
interface WorkspaceState { files: Record<string, string>; graph: StudioGraph; diagnostics: StudioDiagnostic[]; compatibility: Record<string, unknown>; revision: string; active_revision?: string | null; draft_id?: string | null; status: string; permissions: { edit?: boolean; review?: boolean; [key: string]: unknown }; capability: string; capabilities?: Array<Record<string, unknown>>; [key: string]: unknown; }

const errorDiagnostics = (diagnostics: StudioDiagnostic[]) => diagnostics.some(item => item.severity === 'error');

function asComponents(graph: StudioGraph, files: Record<string, string>): Record<string, AdkComponent> {
  const components: Record<string, AdkComponent> = {};
  graph.nodes.forEach(node => {
    const details = node.details || {};
    const kind = node.kind.toLowerCase();
    const isWorkflow = kind.includes('workflow') || kind.includes('group') || kind.includes('graph');
    const source = node.source === 'python' || node.source === 'code' ? 'python' : node.source === 'registry' ? 'prism_registry' : 'adk_yaml';
    const origin = { source: source as AdkAgentComponent['origin']['source'], editable: node.editable !== false && node.enabled !== false, filePath: node.ref || undefined, componentId: node.id };
    if (isWorkflow) {
      const workflow: AdkWorkflowComponent = { kind: 'workflow', id: node.id, name: node.label, description: typeof details.description === 'string' ? details.description : undefined, nodes: [], edges: [], origin };
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
  const configurationFiles: ConfigFileDefinition[] = fileEntries.map(([path, content]) => ({ path, content, kind: path.includes('prism') || path.includes('harness') ? 'prism_harness' : 'adk_agent' }));
  const root = workspace.graph.nodes.find(node => !node.parent || /root|orchestrator/i.test(node.kind)) || workspace.graph.nodes[0];
  const components = asComponents(workspace.graph, workspace.files || {});
  return {
    apiVersion: 'prism/v1', compatibility: { adkVersion: String(workspace.compatibility?.adk_version || workspace.compatibility?.adkVersion || '2.9.0'), agentConfigSchemaVersion: String(workspace.compatibility?.schema_version || workspace.compatibility?.agentConfigSchemaVersion || ''), features: { agentConfig: true, workflowRuntime: true, taskApi: true, plugins: true, a2a: true } },
    metadata: { id: `${workspace.capability}-harness`, name: String(workspace.capability || previous?.metadata.name || 'Harness Studio'), projectId: previous?.metadata.projectId || '', tenantId: previous?.metadata.tenantId || '', version: Number(workspace.revision || 0) || 1, revision: workspace.revision, etag: workspace.revision, updatedAt: new Date().toISOString(), updatedBy: 'workspace' },
    adk: { root: { type: 'registry', componentId: root?.id || '' }, components, configurationFiles, activeFilePath: previous?.adk.activeFilePath && configurationFiles.some(file => file.path === previous.adk.activeFilePath) ? previous.adk.activeFilePath : configurationFiles[0]?.path || '' },
    harness: previous?.harness || { tools: [], connectors: [], skills: [], memory: [], policies: [], optimizers: [], evaluations: [], observability: { tracing: true, feedback: false }, extensions: {} },
    runtimeGraph: workspace.graph,
  };
}

function normalizeWorkspace(payload: WorkspaceState): WorkspaceState {
  return { ...payload, files: payload.files || {}, graph: payload.graph || { nodes: [], edges: [] }, diagnostics: payload.diagnostics || [], permissions: payload.permissions || {}, capability: payload.capability || 'incident_triage' };
}

export const HarnessStudioPage: React.FC<HarnessStudioPageProps> = ({ tenantId: _tenantId = '', projectId: _projectId = '' }) => {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [drafts, setDrafts] = useState<StudioDraftSummary[]>([]);
  const [harness, setHarness] = useState<HarnessDefinition | null>(null);
  const [mainMode, setMainMode] = useState<'canvas' | 'yaml'>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'inspector' | 'playground' | 'files'>('inspector');
  const [showValidation, setShowValidation] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDirty, setLocalDirty] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const capability = workspace?.capability || 'incident_triage';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [workspacePayload, draftPayload] = await Promise.all([fetchStudioWorkspace(capability), fetchStudioDrafts(capability).catch(() => [])]);
      const loaded = normalizeWorkspace(workspacePayload);
      setDrafts(draftPayload);
      setWorkspace(loaded); setHarness(toHarness(loaded)); setSelectedNodeId(loaded.graph.nodes[0]?.id || null); setLocalDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load Harness Studio workspace'); }
    finally { setLoading(false); }
  }, [capability]);
  const resumeDraft = async (draftId: string) => {
    if (!draftId) { void load(); return; }
    setLoading(true); setError(null);
    try { const loaded = normalizeWorkspace(await fetchStudioWorkspace(capability, draftId)); setWorkspace(loaded); setHarness(toHarness(loaded)); setSelectedNodeId(loaded.graph.nodes[0]?.id || null); setLocalDirty(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load draft'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [load]);

  const localValidation = harness ? validateHarness(harness) : null;
  const activeFile = harness?.adk.configurationFiles.find(file => file.path === harness.adk.activeFilePath) || harness?.adk.configurationFiles[0];
  const selectedComponent = harness && selectedNodeId ? harness.adk.components[selectedNodeId] : null;
  const diagnostics = workspace?.diagnostics || [];
  const dirty = localDirty;
  const libraryModules: StudioLibraryModule[] = workspace?.graph.nodes.map(node => ({ id: node.id, name: node.label, description: node.reason || String(node.details?.description || node.ref || 'Resolved by the active backend workspace'), category: node.parent ? 'Internal components' : 'Resolved workflow', kind: node.kind, editable: node.editable })) || [];

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
    try {
      const result = normalizeWorkspace(await validateStudioWorkspace(files, workspace.capability));
      const validated = { ...workspace, files, diagnostics: result.diagnostics, graph: errorDiagnostics(result.diagnostics) ? workspace.graph : result.graph, compatibility: result.compatibility };
      applyWorkspace(validated, workspace.graph);
      if (errorDiagnostics(result.diagnostics)) setMessage('YAML is saved in the editor, but the previous valid graph is still shown.');
      else setMessage('YAML validated. Save the draft to persist this revision.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'YAML validation failed'); }
  };

  const saveDraft = async () => {
    if (!workspace) return;
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await saveStudioDraft({ files: workspace.files, capability: workspace.capability, expected_revision: workspace.revision, draft_id: workspace.draft_id })); applyWorkspace(result); setLocalDirty(false); setMessage('Draft saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Draft save failed'); }
    finally { setSaving(false); }
  };
  const review = async (action: 'submit' | 'approve' | 'reject' | 'revoke') => {
    if (!workspace?.draft_id) { setError('Save a draft before requesting review.'); return; }
    const reason = window.prompt(`Reason for ${action}`, action === 'submit' ? 'Submitted from Harness Studio' : '') || '';
    if (!reason.trim()) return;
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await reviewStudioDraft(workspace.draft_id, action, workspace.revision, reason)); applyWorkspace(result); setLocalDirty(false); setMessage(`Draft ${action}ed.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `Unable to ${action} draft`); }
    finally { setSaving(false); }
  };
  const handleImport = async (file: File) => {
    setSaving(true); setError(null);
    try { const result = normalizeWorkspace(await importStudioBundle(file, capability)); applyWorkspace(result); setLocalDirty(false); setSelectedNodeId(result.graph.nodes[0]?.id || null); setMessage('Bundle imported as a draft.'); }
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
        <div className="hs-header-left"><button type="button" className="icon-btn" onClick={() => setLibraryCollapsed(value => !value)} title={libraryCollapsed ? 'Show module library' : 'Hide module library'}>{libraryCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}</button><div className="hs-breadcrumbs"><strong>HARNESS STUDIO</strong><span>/</span><span>{harness.metadata.name}</span><span>/</span><span className="hs-breadcrumb-file">{activeFile?.path || 'workspace'}</span></div><div className={`hs-status-pill ${dirty ? 'dirty' : workspace.status}`}><span />{dirty ? 'Unsaved' : workspace.status.replace('_', ' ')} · {workspace.revision}</div></div>
        <div className="hs-header-center"><div className="hs-view-segmented"><button type="button" className={`hs-view-btn ${mainMode === 'canvas' ? 'active' : ''}`} onClick={() => setMainMode('canvas')}><Layers size={13} /> Graph</button><button type="button" className={`hs-view-btn ${mainMode === 'yaml' ? 'active' : ''}`} onClick={() => setMainMode('yaml')}><FileCode size={13} /> YAML</button></div>{drafts.length > 0 && <select className="hs-draft-select" value={workspace.draft_id || ''} onChange={event => void resumeDraft(event.target.value)} aria-label="Resume draft"><option value="">Active workspace</option>{drafts.map(draft => <option key={draft.draft_id} value={draft.draft_id}>{draft.status} · {draft.draft_id.slice(0, 14)}</option>)}</select>}</div>
        <div className="hs-header-right"><button type="button" className="btn btn-secondary" onClick={() => setShowValidation(true)}><ShieldCheck size={13} /> {diagnostics.filter(item => item.severity === 'error').length ? `${diagnostics.filter(item => item.severity === 'error').length} errors` : 'Validated'}</button><input ref={importRef} type="file" accept=".zip,.yaml,.yml,application/zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport(file); }} /><button type="button" className="btn btn-secondary" onClick={() => importRef.current?.click()}><Upload size={13} /> Import</button><div className="hs-export-wrap"><button type="button" className="btn btn-secondary" onClick={() => setShowExportMenu(value => !value)}><Download size={13} /> Export <ChevronDown size={11} /></button>{showExportMenu && <div className="hs-export-menu"><button type="button" onClick={() => void handleExport()}><Download size={13} /> Download project archive</button><button type="button" onClick={() => { setShowExportMenu(false); if (activeFile) downloadStudioBlob(new Blob([activeFile.content], { type: 'text/yaml' }), activeFile.path.split('/').pop() || 'config.yaml'); }}><FileCode size={13} /> Download active YAML</button></div>}</div><button type="button" className="btn btn-primary" disabled={saving || workspace.permissions.edit === false} onClick={() => void saveDraft()}>{saving ? <RefreshCw size={13} className="hs-spin" /> : <Save size={13} />} Save draft</button></div>
      </header>
      {(error || message) && <div className={`hs-global-notice ${error ? 'error' : 'success'}`}>{error ? <AlertCircle size={14} /> : <Check size={14} />}<span>{error || message}</span><button type="button" onClick={() => { setError(null); setMessage(null); }} aria-label="Dismiss"><X size={13} /></button></div>}
      <div className={`hs-workspace ${libraryCollapsed ? 'library-collapsed' : ''}`}>
        {!libraryCollapsed && <ModuleLibrary modules={libraryModules} onAddModule={() => setMessage('Components are resolved from the backend graph. Edit the YAML source to add or change one.')} />}
        {mainMode === 'canvas' ? <StudioGraphCanvas harness={harness} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : activeFile ? <YamlSynchronizer activeFile={activeFile} onApplyChanges={handleApplyYamlChanges} /> : <div className="hs-graph-empty">No editable YAML files are present in this workspace.</div>}
        <aside className="hs-right-panel"><div className="hs-panel-tabs"><button type="button" className={`hs-tab-btn ${rightTab === 'inspector' ? 'active' : ''}`} onClick={() => setRightTab('inspector')}><Bot size={13} /> Inspector</button><button type="button" className={`hs-tab-btn ${rightTab === 'playground' ? 'active' : ''}`} onClick={() => setRightTab('playground')}><Play size={13} /> Run</button><button type="button" className={`hs-tab-btn ${rightTab === 'files' ? 'active' : ''}`} onClick={() => setRightTab('files')}><Folder size={13} /> Files</button></div><div className="hs-panel-content">{rightTab === 'inspector' && (selectedComponent ? <InspectorPanel component={selectedComponent} harness={harness} onUpdateComponent={updateComponent} onDeleteComponent={() => setMessage('Remove the component from its YAML definition, then validate the workspace.')} onMigrateToWorkflow={() => setMessage('Workflow migration is controlled by the backend YAML schema.')} /> : <div className="hs-panel-empty">Select a resolved component in the graph to inspect it.</div>)}{rightTab === 'playground' && <Playground harness={harness} capability={capability} />}{rightTab === 'files' && <FileTreeExplorer files={harness.adk.configurationFiles} activeFilePath={harness.adk.activeFilePath} onSelectFile={path => { setHarness(current => current ? { ...current, adk: { ...current.adk, activeFilePath: path } } : current); setMainMode('yaml'); }} />}</div>{(workspace.draft_id || workspace.permissions.review) && <div className="hs-review-bar"><div><span className="hs-kicker">REVISION CONTROL</span><strong>{workspace.active_revision ? `Active ${workspace.active_revision}` : 'Draft review'}</strong></div><div className="hs-review-actions">{workspace.draft_id && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void review('submit')}><Send size={12} /> Submit</button>}{workspace.permissions.review && workspace.draft_id && <><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void review('approve')}><Check size={12} /> Approve</button><button type="button" className="btn btn-quiet" disabled={saving} onClick={() => void review('reject')}>Reject</button></>}</div></div>}</aside>
      </div>
      {showValidation && <ValidationPanel healthScore={localValidation?.healthScore || { overall: 0, architecture: 0, governance: 0, reliability: 0, observability: 0, evaluation: 0, findings: [] }} findings={[...(localValidation?.findings || []), ...diagnostics.map(item => ({ tier: 1 as const, tierName: 'Syntax' as const, severity: item.severity, message: `${item.path ? `${item.path}: ` : ''}${item.message}`, remediation: item.line ? `Line ${item.line}${item.column ? `, column ${item.column}` : ''}` : undefined }))]} onSelectNode={id => { setSelectedNodeId(id); setRightTab('inspector'); setShowValidation(false); }} onClose={() => setShowValidation(false)} />}
    </div>
  );
};
