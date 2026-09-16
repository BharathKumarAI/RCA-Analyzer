import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchConfig, uploadInvestigationFiles } from '../services/api';
import { testProjectCandidate, type ProjectCandidateInput, type ProjectCandidateTest as CandidateResponse } from '../services/projectCandidate';
import type { CapabilityItem, RuntimeConfig } from '../types/api';
import { RunConnectorSelectors, useRunConnectorSelections } from './RunConnectorSelectors';
import { RunKnowledgeSelector, type RunKnowledgeSelection } from './RunKnowledgeSelector';
import { RcaAnalysisPanel } from './RcaAnalysisPanel';

export function ProjectCandidateTest({ yaml, projectRevision, editorVersion, snapshot, validated, canEdit, mode, capabilities, onReceipt, onBusy, onOpenRun }: {
  yaml: string; projectRevision?: string; editorVersion: number; snapshot: string; validated: boolean; canEdit: boolean; mode?: 'demo' | 'live'; capabilities: CapabilityItem[];
  onReceipt: (response: CandidateResponse | null, snapshot: string) => void; onBusy: (busy: boolean) => void; onOpenRun?: (id: string) => void | Promise<void>;
}) {
  const [capability, setCapability] = useState('');
  const [prompt, setPrompt] = useState('');
  const [incident, setIncident] = useState('');
  const [knowledge, setKnowledge] = useState<RunKnowledgeSelection>({ environmentId: '', documentIds: [] });
  const [files, setFiles] = useState<File[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [result, setResult] = useState<CandidateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const source = useRunConnectorSelections(capability);
  const pending = useRef<{ key: string; input: ProjectCandidateInput } | null>(null);
  const running = useRef(false);
  const version = useRef(0);
  const callback = useRef(onReceipt);
  useEffect(() => { callback.current = onReceipt; }, [onReceipt]);
  const inputSnapshot = JSON.stringify({ snapshot, capability, prompt, incident, knowledge, selections: source.selections, files: files.map(file => [file.name, file.size, file.lastModified]) });
  useEffect(() => { version.current++; pending.current = null; setResult(null); setError(null); callback.current(null, snapshot); }, [inputSnapshot, snapshot]);
  useEffect(() => { let active = true; void fetchConfig().then(value => { if (active) { setConfig(value); setConfigError(''); } }).catch(cause => { if (active) setConfigError(cause instanceof Error ? cause.message : 'Upload limits could not load.'); }); return () => { active = false; version.current++; }; }, []);
  const chooseFiles = (selected: File[]) => {
    if (!config) return;
    const limits = config.file_limits;
    if (selected.length > limits.max_files || selected.some(file => file.size > limits.max_file_bytes) || selected.reduce((total, file) => total + file.size, 0) > config.execution.max_upload_batch_bytes) {
      setError({ message: 'Selected files exceed this project’s saved upload limits.', retryable: false }); return;
    }
    setFiles(selected);
  };
  const run = async (retry = false) => {
    if (running.current || !canEdit || !validated || !source.ready || !capability || !prompt.trim() || mode !== 'live') return;
    const current = version.current; running.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      if (!retry || !pending.current) {
        const input: ProjectCandidateInput = { yaml, expected_project_revision: projectRevision, expected_editor_version: editorVersion,
          run: { capability, prompt: prompt.trim(), incident_id: incident.trim() || undefined, connector_selections: source.selections, environment_id: knowledge.environmentId || undefined, knowledge_document_ids: knowledge.documentIds } };
        if (files.length) {
          const uploaded = await uploadInvestigationFiles(files);
          if (current !== version.current) return;
          input.run.chat_id = uploaded.chat_id; input.run.attachment_ids = uploaded.attachments.map(item => item.attachment_id);
        }
        pending.current = { key: crypto.randomUUID(), input };
      }
      const attempt = pending.current!;
      const response = await testProjectCandidate(attempt.input, attempt.key);
      if (current !== version.current) return;
      setResult(response); pending.current = null; callback.current(response, snapshot);
    } catch (cause) {
      if (current !== version.current) return;
      const retryable = pending.current !== null && cause instanceof ApiError && (cause.status === 0 || cause.status >= 500);
      if (!retryable) pending.current = null;
      setError({ message: cause instanceof Error ? cause.message : 'Candidate investigation failed.', retryable });
    } finally { running.current = false; setBusy(false); onBusy(false); }
  };
  return <section className="ps-card" aria-label="Candidate investigation">
    <h2 className="ps-card-title">Test the candidate configuration</h2><p>Run a real investigation with these candidate settings before applying them. Current project settings remain active until you apply a passing result. The server rechecks the exact configuration and its dependencies at apply time.</p>
    {!validated && <p>Save the draft and validate its structure and policy first.</p>}{mode !== 'live' && <p role="status">A passing test requires live execution. Demo mode records a simulation and cannot authorize applying settings.</p>}
    <fieldset disabled={busy || !canEdit} style={{ minWidth: 0, border: 0, padding: 0 }}><legend>Investigation inputs</legend>
      <label className="ps-field-label">Capability<select className="ps-input" value={capability} onChange={event => { setCapability(event.target.value); setKnowledge({ environmentId: '', documentIds: [] }); }}><option value="">Choose a capability</option>{capabilities.filter(item => item.enabled !== false && item.runtime_supported !== false).map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
      <label className="ps-field-label">Investigation request<textarea className="ps-input" rows={3} maxLength={16000} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <label className="ps-field-label">Incident identifier (when required)<input className="ps-input" maxLength={64} value={incident} onChange={event => setIncident(event.target.value)} /></label>
      <RunConnectorSelectors state={source} disabled={busy} />
      <RunKnowledgeSelector capability={capability} connectors={source.selections} value={knowledge} onChange={setKnowledge} disabled={busy} />
      <label className="ps-field-label">Local evidence files (optional)<input type="file" multiple disabled={!config} accept={config?.file_limits.allowed_extensions.join(',')} onChange={event => { chooseFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></label>
      {configError && <p role="alert">{configError} File uploads are unavailable; you can test connected sources or approved knowledge.</p>}
      {!!files.length && <ul>{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name} <button type="button" className="btn btn-secondary" onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}>Remove</button></li>)}</ul>}
    </fieldset>
    <button type="button" className="btn btn-primary" disabled={busy || !canEdit || !validated || !source.ready || !capability || !prompt.trim() || mode !== 'live'} onClick={() => void run()}>{busy ? 'Testing candidate…' : 'Run candidate investigation'}</button>
    {busy && <p role="status">The governed investigation is running. Keep this page open until the saved outcome is available.</p>}
    {error && <div role="alert"><p>{error.message}</p>{error.retryable && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(true)}>Retrieve or retry the same test</button>}</div>}
    {result && <><p role="status">{result.receipt.passed ? 'Candidate passed. Review the recorded evidence, then apply the settings.' : `Candidate did not pass (${result.run.status}). Settings have not been applied.`}</p>{result.run.reason && <p>{result.run.reason}</p>}<p>Run {result.run.run_id} · {result.run.evidence_count} recorded evidence items</p>{result.run.result && <RcaAnalysisPanel analysis={{ run_id: result.run.run_id, status: result.run.status, created_at: result.run.created_at, result: result.run.result }} onOpenRun={onOpenRun} />}</>}
  </section>;
}
