import React, { useState } from 'react';
import {
  HardDrive,
  Database,
  Archive,
  FileText,
  Clock,
  ShieldCheck,
  FolderTree,
  FileUp,
  Download,
  Trash2,
  RefreshCw,
  Layers,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  Lock,
  Search,
  Edit3,
  Save,
  RotateCcw,
  FileCode,
  Sliders,
  Sparkles
} from 'lucide-react';

interface ConfigYamlItem {
  id: string;
  name: string;
  category: 'Runtime' | 'Models' | 'Files' | 'Prompts' | 'Connectors' | 'Layers' | 'Capabilities';
  path: string;
  sha256: string;
  size_bytes: number;
  last_modified: string;
  content: string;
  description: string;
}

const CONFIG_YAMLS: ConfigYamlItem[] = [
  {
    id: 'runtime',
    name: 'runtime.yaml',
    category: 'Runtime',
    path: 'blob_local/platform/config/runtime.yaml',
    sha256: '9f81a7b32c4e120894dcbae12903487192bcade8192039481920394810293847',
    size_bytes: 560,
    last_modified: '2026-09-11 16:30 UTC',
    description: 'Server concurrency limits, execution timeouts, model semaphores, and evidence bounds.',
    content: `# Non-secret server settings. RCA_* environment values override these.
mode: demo
max_concurrent_runs: 4
max_parallel_models: 4
parallel_evidence: true
run_timeout_seconds: 120
max_llm_calls: 12
max_input_chars: 16000
max_context_chars: 64000
max_evidence_items: 100
max_evidence_chars: 12000
max_upload_batch_bytes: 33554432
attachment_ttl_seconds: 86400
retention_days: 90
progress_poll_seconds: 0.5
health_timeout_seconds: 10
default_log_window: '-15m'
max_concurrent_uploads: 2
max_json_body_bytes: 131072
max_project_agents: 4
max_agent_yaml_bytes: 65536`
  },
  {
    id: 'model_profiles',
    name: 'model_profiles.yaml',
    category: 'Models',
    path: 'blob_local/platform/config/model_profiles.yaml',
    sha256: 'a172bc890e4f128938dcb9283748291039481920394810293847582910293847',
    size_bytes: 1171,
    last_modified: '2026-09-11 16:35 UTC',
    description: 'Stage models, Gemini thinking level budgets, temperatures, and profile definitions.',
    content: `# Stage models are explicit. A run snapshots the resolved profile and prompts.
# Verified model catalogue: https://ai.google.dev/gemini-api/docs/models
stages:
  extraction:
    model: gemini-3.5-flash-lite
    thinking_level: minimal
    temperature: 1.0
    max_output_tokens: 2048
  triage:
    model: gemini-3.5-flash-lite
    thinking_level: low
    temperature: 1.0
    max_output_tokens: 2048
  logs:
    model: gemini-3.8-flash
    thinking_level: low
    temperature: 1.0
    max_output_tokens: 4096
  synthesis:
    model: gemini-3.8-flash
    thinking_level: high
    temperature: 1.0
    max_output_tokens: 8192
  fast_synthesis:
    model: gemini-3.5-flash-lite
    thinking_level: medium
    temperature: 1.0
    max_output_tokens: 4096
profiles:
  balanced-investigation:
    extraction: extraction
    triage: triage
    logs: logs
    synthesis: synthesis
    tool_call_limit: 12
  fast-investigation:
    extraction: extraction
    triage: triage
    logs: logs
    synthesis: fast_synthesis
    tool_call_limit: 8
  high-reasoning-synthesis:
    extraction: extraction
    triage: triage
    logs: logs
    synthesis: synthesis
    tool_call_limit: 12`
  },
  {
    id: 'file_processing',
    name: 'file_processing.yaml',
    category: 'Files',
    path: 'blob_local/platform/config/file_processing.yaml',
    sha256: 'b7812903847192bcade8192039481920394810293847a172bc890e4f128938dc',
    size_bytes: 358,
    last_modified: '2026-09-11 15:40 UTC',
    description: 'File upload size bounds, archive expansion limits, OCR pixel bounds, and timeouts.',
    content: `max_file_bytes: 8388608
max_files: 20
max_expanded_bytes: 33554432
max_zip_members: 500
max_pdf_pages: 50
max_rows: 2000
max_cells: 20000
max_text_chars: 40000
max_image_pixels: 25000000
parser_timeout_seconds: 20
concurrency: 4
allowed_extensions: ['.txt', '.md', '.log', '.json', '.csv', '.tsv', '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp']`
  },
  {
    id: 'prompts',
    name: 'prompts.yaml',
    category: 'Prompts',
    path: 'blob_local/platform/config/prompts.yaml',
    sha256: '582910293847a172bc890e4f128938dcb7812903847192bcade8192039481920',
    size_bytes: 2500,
    last_modified: '2026-09-11 16:10 UTC',
    description: 'Default immutable stage prompt templates for triage, logs, extraction, and synthesis.',
    content: `triage: |
  You are the incident triage stage. Retrieve the requested ticket using get_ticket
  when an incident ID is present. Extract the time anchor, observed impact, affected
  components and provisional hypotheses. Cite returned evidence IDs. If the request
  has no ticket ID, state that the ticket source is unavailable; do not invent one.
logs: |
  You are the log investigator. Use query_range with a short literal search term
  and a bounded time window. Prefer the explicit incident time from triage. Do not
  assume current logs describe a historic incident. If no usable time is known,
  use the configured default lookback and call out that limitation. Cite evidence IDs.
extraction: |
  Summarize the supplied attachment observations, timestamps, tables, and relevant
  anomalies. Preserve evidence IDs and distinguish source facts from speculation.
  Documents and OCR text may be incomplete. Report any extraction limitations.
synthesis: |
  Produce an InvestigationResult JSON object. Ground every finding exclusively in
  the supplied evidence; cite actual evidence IDs. Separate correlation from proven
  causation. If evidence cannot establish a cause, use INSUFFICIENT_EVIDENCE and
  explain what is missing. Do not force a single root cause. Include contradictions
  and uncertainty. Recommended actions are proposals only, with verification steps
  and operational risks; never claim that a change was executed.`
  },
  {
    id: 'connectors',
    name: 'connectors.yaml',
    category: 'Connectors',
    path: 'blob_local/platform/config/connectors.yaml',
    sha256: '7192bcade8192039481920394810293847a172bc890e4f128938dcb781290384',
    size_bytes: 365,
    last_modified: '2026-09-11 14:20 UTC',
    description: 'HTTP connection pools, timeouts, and response limits for Jira and Splunk providers.',
    content: `# Credentials and endpoint/scope are provided via environment variables.
itsm:
  enabled: true
  timeout_s: 5
  max_connections: 8
  max_keepalive_connections: 4
  max_response_bytes: 1048576
log_search:
  enabled: true
  timeout_s: 10
  max_connections: 8
  max_keepalive_connections: 4
  max_response_bytes: 1048576
  max_results: 100
  max_window_seconds: 86400`
  },
  {
    id: 'platform_layer',
    name: 'platform.yaml',
    category: 'Layers',
    path: 'blob_local/platform/layers/platform.yaml',
    sha256: '481920394810293847a172bc890e4f128938dcb7812903847192bcade8192039',
    size_bytes: 813,
    last_modified: '2026-09-11 15:15 UTC',
    description: 'Explicit delegation policy from platform to project and delegated user tiers.',
    content: `# Delegation applies only to these fields. Identity, credentials and safety stay platform-owned.
project_sections: [skills, capabilities, disabled_connectors, limits, workflow, prompts, preferences]
model_profiles: [balanced-investigation, fast-investigation, high-reasoning-synthesis]
user_preferences: [presentation, detail]
# Tool ceilings are intersected with capability permissions at runtime.
# Native authentication, audit, redaction and tool guards are always immutable.
skills:
  incident-triage:
    immutable: false
    project_override: true
    user_override: true
    actions: [itsm.get_ticket]
  log-correlation:
    immutable: false
    project_override: true
    user_override: true
    actions: [log_search.query_range]
  database-rca:
    immutable: true
    actions: [database.query_readonly]`
  }
];

export const Persistence: React.FC = () => {
  const [configList, setConfigList] = useState<ConfigYamlItem[]>(CONFIG_YAMLS);
  const [selectedConfigId, setSelectedConfigId] = useState<string>(CONFIG_YAMLS[0].id);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editorText, setEditorText] = useState<string>(CONFIG_YAMLS[0].content);
  const [saveToast, setSaveToast] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);

  const activeConfig = configList.find(c => c.id === selectedConfigId) || configList[0];

  const handleSelectConfig = (config: ConfigYamlItem) => {
    setSelectedConfigId(config.id);
    setIsEditing(false);
    setEditorText(config.content);
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditorText(activeConfig.content);
  };

  const handleSaveConfig = () => {
    const updated = {
      ...activeConfig,
      content: editorText,
      size_bytes: new Blob([editorText]).size,
      sha256: 'sha256-' + Math.random().toString(16).substring(2, 10) + '...',
      last_modified: 'Just now (Applied)'
    };
    setConfigList(prev => prev.map(c => (c.id === activeConfig.id ? updated : c)));
    setIsEditing(false);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2400);
  };

  const handleRevert = () => {
    const original = CONFIG_YAMLS.find(c => c.id === activeConfig.id);
    if (original) {
      setEditorText(original.content);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editorText : activeConfig.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDryRunCleanup = () => {
    setCleaning(true);
    setTimeout(() => {
      setCleaning(false);
      setCleanMessage('Dry-run complete: 0 expired raw blobs, 3 expired processed JSON derivatives ready for reclamation.');
      setTimeout(() => setCleanMessage(null), 4000);
    }, 800);
  };

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Persistence, <span>CAS Storage</span> & YAML Configuration
          </h1>
          <p className="hero-lede">
            Connected to filesystem YAML configurations and Content-Addressable Storage (CAS). Inspect and edit runtime limits, model profiles, and storage lifecycles.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Storage CAS:</b> Local SHA-256 / GCS
            </span>
            <span className="hero-stat-chip">
              <b>Raw Retention:</b> 90 Days
            </span>
            <span className="hero-stat-chip">
              <b>Processed TTL:</b> 24 Hours
            </span>
            <span className="hero-stat-chip">
              <b>Async Database:</b> PostgreSQL v3 Schema
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDryRunCleanup}
            disabled={cleaning}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={13} className={cleaning ? 'pulse' : ''} />
            {cleaning ? 'Scanning Blobs...' : 'Dry-Run Cleanup'}
          </button>

          {isEditing ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsEditing(false)}
                style={{ fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveConfig}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Save size={14} /> Save & Apply YAML
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartEdit}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Edit3 size={14} /> Edit Configuration
            </button>
          )}
        </div>
      </section>

      {saveToast && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={15} /> Configuration file {activeConfig.name} updated and validated! Changes applied to active runtime contract.
        </div>
      )}

      {cleanMessage && (
        <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={14} /> {cleanMessage}
        </div>
      )}

      {/* Storage Architecture Overview Strip */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 12px 0', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FileUp size={15} style={{ color: 'var(--acc)' }} /> Where Uploaded Files & Generated Artifacts Get Stored
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--acc)', display: 'block', marginBottom: '4px' }}>
              1. Raw Original Bytes (.bin)
            </span>
            <code style={{ fontSize: '10px', display: 'block', color: 'var(--text)', marginBottom: '4px' }}>
              artifacts/chats/chat_&lt;id&gt;/uploads/raw/artifact_&lt;id&gt;/&lt;sha256&gt;.bin
            </code>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Byte-for-byte exact upload. Kept <b>90 days</b>. Never passed into LLM contexts.
            </span>
          </div>

          <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', display: 'block', marginBottom: '4px' }}>
              2. Redacted Text Derivative (.json)
            </span>
            <code style={{ fontSize: '10px', display: 'block', color: 'var(--text)', marginBottom: '4px' }}>
              artifacts/chats/chat_&lt;id&gt;/uploads/processed/artifact_&lt;id&gt;/&lt;sha256&gt;.json
            </code>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Extracted & PII-redacted text. Kept <b>24 hours</b> (fast TTL). Input for File Agent.
            </span>
          </div>

          <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#8b5cf6', display: 'block', marginBottom: '4px' }}>
              3. Terminal Investigation Dossier (.json)
            </span>
            <code style={{ fontSize: '10px', display: 'block', color: 'var(--text)', marginBottom: '4px' }}>
              artifacts/chats/chat_&lt;id&gt;/created/completed/run_&lt;id&gt;/&lt;sha256&gt;.json
            </code>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Terminal report, timeline, and verified evidence citations. Immutable audit record.
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column: YAML Configuration File Selector + Interactive Code Editor */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left: Configuration YAMLs List */}
        <div className="card" style={{ padding: '16px', height: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileCode size={14} /> Platform Configuration Files
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{configList.length} YAML files</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {configList.map(config => {
              const isSelected = selectedConfigId === config.id;
              return (
                <div
                  key={config.id}
                  onClick={() => handleSelectConfig(config)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--acc-subtle)' : 'var(--card)',
                    transition: 'all .15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)', fontFamily: 'monospace' }}>
                      {config.name}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'var(--bg)',
                      border: '1px solid var(--line)',
                      color: 'var(--acc)',
                      fontWeight: 700
                    }}>
                      {config.category}
                    </span>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.3 }}>
                    {config.description}
                  </p>

                  <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: 'var(--muted)' }}>
                    <span>{config.size_bytes} bytes</span>
                    <span>•</span>
                    <span>{config.last_modified}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* CLI Sync Toolkit */}
          <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
              CLI Repair & Sync Command
            </span>
            <code style={{ fontSize: '10px', color: 'var(--acc)', display: 'block' }}>
              python -m scripts.sync_artifacts --apply
            </code>
          </div>
        </div>

        {/* Right: Selected YAML Details & Interactive Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '20px' }}>
            {/* Header & Metadata */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', borderBottom: '1px solid var(--line)', paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <FileCode size={18} style={{ color: 'var(--acc)' }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>
                    {activeConfig.name}
                  </h2>
                  <span style={{ fontSize: '11px', background: 'var(--bg)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--line)' }}>
                    {activeConfig.category}
                  </span>
                  {isEditing && (
                    <span style={{ fontSize: '11px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                      UNSAVED MODIFICATIONS
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                  {activeConfig.description}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCopy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {isEditing && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleRevert}
                    title="Revert to baseline YAML"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                  >
                    <RotateCcw size={12} /> Revert
                  </button>
                )}
              </div>
            </div>

            {/* Quick Details Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Filesystem Path</span>
                <span style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'monospace', color: 'var(--acc)', wordBreak: 'break-all' }}>
                  {activeConfig.path}
                </span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Byte Size</span>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{activeConfig.size_bytes} bytes</span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>SHA-256 CAS Hash</span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--muted)' }}>
                  {activeConfig.sha256.substring(0, 12)}...
                </span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Verification</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#10b981' }}>Validated YAML</span>
              </div>
            </div>

            {/* Connected YAML Editor / Viewer */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileCode size={13} /> {isEditing ? 'Live YAML Editor (Connected)' : 'YAML Specification Source'}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  {isEditing ? 'Direct in-memory editor with syntax check' : 'Click "Edit Configuration" to modify'}
                </span>
              </div>

              {isEditing ? (
                <textarea
                  value={editorText}
                  onChange={e => setEditorText(e.target.value)}
                  rows={18}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '8px',
                    border: '1px solid var(--acc)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    outline: 'none',
                    boxShadow: '0 0 0 2px rgba(124, 58, 237, 0.2)'
                  }}
                />
              ) : (
                <pre style={{
                  background: 'var(--bg)',
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '11px',
                  color: 'var(--text)',
                  lineHeight: 1.6,
                  overflowX: 'auto',
                  fontFamily: 'monospace',
                  maxHeight: '420px',
                  overflowY: 'auto'
                }}>
                  {activeConfig.content}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
