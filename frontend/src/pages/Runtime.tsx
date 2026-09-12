import React, { useState, useEffect } from 'react';
import {
  Zap,
  Cpu,
  Activity,
  GitBranch,
  ArrowRight,
  Radio,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Sliders,
  Code2,
  FileSearch,
  CheckCircle2,
  Shield,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import { SystemHealth } from '../types/api';
import { ApiError, fetchConfig } from '../services/api';

interface RuntimeProps {
  health: SystemHealth;
}

interface NodeSpec {
  id: string;
  name: string;
  type: string;
  stageName: string;
  model: string;
  thinking: string;
  outputLimit: string;
  tools: string[];
  concurrency: string;
  inputs: string;
  outputs: string;
  description: string;
  adkCode: string;
}

const NODES_SPEC: Record<string, NodeSpec> = {
  root: {
    id: 'root',
    name: 'Root ADK Entrypoint',
    type: 'google.adk.Runner / ExecutionRunner',
    stageName: 'Request Lifespan & Scope Boundary',
    model: 'N/A (Deterministic Orchestration Engine)',
    thinking: 'None',
    outputLimit: 'Uncapped',
    tools: ['FastAPI Router', 'SQLAlchemy Run Store', 'Principal JWT RS256 Scope'],
    concurrency: 'Occupies 1 of 4 Concurrent Runs slots (HTTP 429 when saturated)',
    inputs: 'Authenticated RS256 token, Tenant ID, Project ID, Incident ID, bounded attachments',
    outputs: 'Run ID, Session state, SSE event stream (/api/v1/runs/{id}/events)',
    description: 'Native ADK Runner initializes the execution context, enforces the 120s UTC hard deadline, validates tenant/project boundary isolation, and kicks off RootWorkflow graph execution.',
    adkCode: `runner = Runner(
    workflow=root_workflow,
    session=session,
    timeout_seconds=120
)
await runner.run_async(inputs)`
  },
  planning: {
    id: 'planning',
    name: 'Request Planning Stage',
    type: 'google.adk.LlmAgent',
    stageName: 'Request Orchestrator',
    model: 'gemini-2.5-flash',
    thinking: 'High (8,192 tokens budget)',
    outputLimit: '4,096 tokens',
    tools: ['Declarative Capability Resolver'],
    concurrency: 'Acquires 1 of 4 parallel model semaphore slots',
    inputs: 'User investigation prompt, Incident ID, tenant capabilities configuration',
    outputs: 'Structured orchestration execution plan and parallel branch parameters',
    description: 'Evaluates incident urgency, parses custom user parameters, and prepares the downstream parallel execution branches for Incident Triage and Document Extraction.',
    adkCode: `planning_agent = LlmAgent(
    name="request_planner",
    model="gemini-2.5-flash",
    instruction="Analyze incident scope and formulate parallel investigation branches.",
    thinking_budget=8192,
    output_limit=4096
)`
  },
  triage: {
    id: 'triage',
    name: '1. Jira Triage LlmAgent',
    type: 'google.adk.LlmAgent',
    stageName: 'Jira Incident Triage',
    model: 'gemini-2.5-flash-lite',
    thinking: 'Low (1,024 tokens budget)',
    outputLimit: '2,048 tokens',
    tools: ['itsm.get_ticket (Read-only Jira connector)'],
    concurrency: 'Acquires 1 model semaphore slot',
    inputs: 'Ticket ID / Key (e.g. INC-84920) within tenant boundary',
    outputs: 'Structured triage_result: Priority, summary, affected service components, timeline start/end bounds',
    description: 'Queries read-only Jira connector to extract issue metadata, severity, component ownership, and affected service timeline windows.',
    adkCode: `triage_agent = LlmAgent(
    name="triage_agent",
    model="gemini-2.5-flash-lite",
    instruction="Extract ticket priority, affected services, and outage timeline bounds.",
    tools=[get_ticket_tool],
    thinking_budget=1024
)`
  },
  logs: {
    id: 'logs',
    name: '2. Log Investigator LlmAgent',
    type: 'google.adk.LlmAgent',
    stageName: 'Splunk Observability Miner',
    model: 'gemini-2.5-flash',
    thinking: 'Low (2,048 tokens budget)',
    outputLimit: '4,096 tokens',
    tools: ['log_search.query_range (Read-only Splunk connector)'],
    concurrency: 'Acquires 1 model semaphore slot; strictly bounded search',
    inputs: 'triage_result timeline window, service tags, error signatures',
    outputs: 'Correlated log clusters, stack traces, anomalous event frequency counts',
    description: 'Executes bounded, time-scoped Splunk queries to discover error spikes, stack traces, and anomaly patterns occurring during the incident window.',
    adkCode: `log_agent = LlmAgent(
    name="log_investigator",
    model="gemini-2.5-flash",
    instruction="Query Splunk for error rate spikes and correlate exceptions within triage timeline.",
    tools=[query_range_tool],
    thinking_budget=2048
)`
  },
  extraction: {
    id: 'extraction',
    name: 'File Investigator LlmAgent',
    type: 'google.adk.LlmAgent',
    stageName: 'Bounded Document OCR & Evidence',
    model: 'gemini-2.5-flash-lite',
    thinking: 'Min (512 tokens budget)',
    outputLimit: '2,048 tokens',
    tools: ['Local CAS Reader (NO external network tools, local bounded OCR, max 10MB)'],
    concurrency: 'Executes in parallel with Branch A (Incident Branch)',
    inputs: 'Content-addressed SHA-256 local file attachments',
    outputs: 'Redacted structural summaries, extracted configuration diffs, and evidence items',
    description: 'Processes local-only attachments with bounded parallel OCR and CAS deduplication, producing redacted evidence summaries without network calls.',
    adkCode: `file_agent = LlmAgent(
    name="file_investigator",
    model="gemini-2.5-flash-lite",
    instruction="Summarize pre-extracted local CAS attachment text with strict PII redaction.",
    tools=[cas_read_tool],
    thinking_budget=512
)`
  },
  join: {
    id: 'join',
    name: 'ADK JoinNode Barrier',
    type: 'google.adk.JoinNode',
    stageName: 'Evidence Join Barrier',
    model: 'N/A (Deterministic ADK Graph Node)',
    thinking: 'None',
    outputLimit: 'Bounded by evidence cap (max 100 items)',
    tools: ['SQLAlchemy Evidence Ledger Store'],
    concurrency: 'Barrier synchronization: waits for both Branch A and Branch B to complete',
    inputs: 'Branch A findings (triage + logs) + Branch B findings (file attachments)',
    outputs: 'Consolidated, deduplicated evidence ledger passed to downstream specialist router',
    description: 'Native ADK JoinNode blocks until both parallel branches finish, deterministically merging incident telemetry and file evidence under the 100-item cap.',
    adkCode: `join_node = JoinNode(
    name="evidence_join_barrier",
    join_type="all_completed",
    upstream=[incident_branch, attachment_branch]
)`
  },
  router: {
    id: 'router',
    name: 'Specialist Router',
    type: 'google.adk.Workflow / Dynamic Router',
    stageName: 'Approved Specialist AgentTools',
    model: 'gemini-2.5-flash',
    thinking: 'Low (1,024 tokens budget)',
    outputLimit: '4,096 tokens',
    tools: ['Approved AgentTool instances (cryptographic content hash verified)'],
    concurrency: 'Dispatches only to approved, same-scope specialist definitions',
    inputs: 'Consolidated evidence ledger from JoinNode',
    outputs: 'Domain-specialized diagnostic hypotheses and forensic evaluations',
    description: 'Dispatches evidence to approved specialist agents (e.g. database forensics, network topology). Only same-scope admin-approved definitions are active.',
    adkCode: `specialist_tools = [
    AgentTool(agent=approved_specialist_agent)
    for approved_specialist in approved_registry
]
router = SpecialistRouter(tools=specialist_tools)`
  },
  synthesis: {
    id: 'synthesis',
    name: 'RCA Synthesizer LlmAgent',
    type: 'google.adk.LlmAgent',
    stageName: 'Root Cause Synthesizer',
    model: 'gemini-2.5-flash',
    thinking: 'High (8,192 tokens budget)',
    outputLimit: '8,192 tokens',
    tools: ['Persistence Write Tool (SQLAlchemy run completion)'],
    concurrency: 'Terminal execution step; releases all allocated semaphores',
    inputs: 'Complete joined evidence, specialist analyses, and timeline chronology',
    outputs: 'Final Root Cause Analysis Report: Primary Cause, Fault Tree, Remediation Checklist',
    description: 'Final synthesis agent synthesizes the comprehensive root cause narrative, constructs the timeline, maps the fault tree, and generates actionable remediation items.',
    adkCode: `synthesizer = LlmAgent(
    name="rca_synthesizer",
    model="gemini-2.5-flash",
    instruction="Synthesize complete root cause analysis report, timeline, and actionable remediation.",
    thinking_budget=8192,
    output_limit=8192
)`
  }
};

export const Runtime: React.FC<RuntimeProps> = ({ health }) => {
  const [config, setConfig] = useState<any>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => { fetchConfig().then(setConfig).catch((reason: unknown) => setConfigError(reason instanceof ApiError ? reason.message : 'Unable to load runtime configuration.')); }, []);
  const [selectedNode, setSelectedNode] = useState<string>('synthesis');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1.0);
  const [showInspector, setShowInspector] = useState<boolean>(true);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.15, 1.6));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.15, 0.7));
  const handleZoomReset = () => setZoom(1.0);

  const configuredStage = config?.model_profiles?.stages?.[selectedNode];
  const activeNodeData: NodeSpec = {
    ...(NODES_SPEC[selectedNode] || NODES_SPEC.synthesis),
    ...(!configuredStage && NODES_SPEC[selectedNode]?.type.includes('LlmAgent') ? { model: '—', thinking: '—', outputLimit: '—' } : {}),
    ...(configuredStage ? {
      model: configuredStage.model || NODES_SPEC.synthesis.model,
      thinking: configuredStage.thinking_level ? `${configuredStage.thinking_level} (configured)` : NODES_SPEC.synthesis.thinking,
      outputLimit: configuredStage.max_output_tokens ? `${configuredStage.max_output_tokens} tokens` : NODES_SPEC.synthesis.outputLimit,
      description: 'Configured stage from the server model profile.',
    } : {}),
  };
  const execution = config?.execution || {};
  const stageConfig = (node: string) => config?.model_profiles?.stages?.[node] || config?.model_profiles?.stages?.orchestrator;
  const modelLabel = (node: string, fallback: string) => stageConfig(node)?.model || fallback;
  const thinkingLabel = (node: string, fallback: string) => stageConfig(node)?.thinking_level ? `${stageConfig(node).thinking_level} Think` : fallback;

  // Render the core interactive workflow topology graph
  const renderWorkflowGraph = (isModal: boolean) => (
    <div
      className="topology-graph-inner"
      style={{
        transform: `scale(${zoom})`,
        transformOrigin: 'top center',
        minWidth: isModal ? '880px' : '820px'
      }}
    >
      {/* Step 1: Root & Planning */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
        <div
          onClick={() => setSelectedNode('root')}
          className={`topology-node-card ${selectedNode === 'root' ? 'selected' : ''}`}
          style={{ padding: '12px 20px', textAlign: 'center', minWidth: '220px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '2px' }}>
            <Zap size={13} style={{ color: 'var(--acc)' }} />
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Root ADK Entrypoint</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>ExecutionRunner.execute()</span>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '3px' }}>RS256 Scope Boundary</span>
        </div>

        <ArrowRight size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />

        <div
          onClick={() => setSelectedNode('planning')}
          className={`topology-node-card ${selectedNode === 'planning' ? 'selected' : ''}`}
          style={{ padding: '12px 20px', textAlign: 'center', minWidth: '220px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '2px' }}>
            <Sliders size={13} style={{ color: 'var(--acc)' }} />
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Pre-Flight Planning</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>Request Planning Stage</span>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '3px' }}>{modelLabel('orchestrator', 'Configured model')} ({thinkingLabel('orchestrator', 'Configured thinking')})</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--muted)', fontSize: '12px' }}>
        <span style={{ height: '1px', width: '80px', background: 'var(--line)' }} />
        <span>&darr; Forks into Parallel Evidence Acquisition</span>
        <span style={{ height: '1px', width: '80px', background: 'var(--line)' }} />
      </div>

      {/* Step 2: Parallel Branches (Incident Branch vs Attachment Branch) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '20px' }}>
        {/* Left Branch: Incident Branch */}
        <div style={{ background: 'var(--card)', padding: '18px', borderRadius: '10px', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--acc)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={13} /> BRANCH A: INCIDENT INVESTIGATION (ORDERED)
            </span>
            <span style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--bg)', padding: '2px 6px', borderRadius: '4px' }}>
              Sequential Sub-Pipeline
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              onClick={() => setSelectedNode('triage')}
              className={`topology-node-card ${selectedNode === 'triage' ? 'selected' : ''}`}
              style={{ padding: '12px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700 }}>1. Triage LlmAgent</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{modelLabel('triage', 'Configured model')} ({thinkingLabel('triage', 'Configured thinking')})</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                Calls governed <code style={{ color: 'var(--acc)' }}>itsm.get_ticket</code> tool
              </span>
            </div>

            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '11px' }}>
              &darr; Passes <code style={{ color: 'var(--text)' }}>triage_result</code>
            </div>

            <div
              onClick={() => setSelectedNode('logs')}
              className={`topology-node-card ${selectedNode === 'logs' ? 'selected' : ''}`}
              style={{ padding: '12px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700 }}>2. Log Investigator LlmAgent</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{modelLabel('logs', 'Configured model')} ({thinkingLabel('logs', 'Configured thinking')})</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                Calls governed <code style={{ color: 'var(--acc)' }}>log_search.query_range</code> tool
              </span>
            </div>
          </div>
        </div>

        {/* Right Branch: Attachment Branch */}
        <div style={{ background: 'var(--card)', padding: '18px', borderRadius: '10px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileSearch size={13} /> BRANCH B: ATTACHMENT BRANCH (INDEPENDENT)
            </span>
            <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
              Bounded Local OCR
            </span>
          </div>

          <div
            onClick={() => setSelectedNode('extraction')}
            className={`topology-node-card ${selectedNode === 'extraction' ? 'selected' : ''}`}
            style={{
              padding: '16px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700 }}>File Investigator LlmAgent</span>
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{modelLabel('extraction', 'Configured model')} ({thinkingLabel('extraction', 'Configured thinking')})</span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--muted)', margin: 0, lineHeight: 1.4 }}>
              Summarizes pre-extracted, redacted attachment text stored in CAS without calling external network tools.
            </p>
            <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
              ✓ Strict PII Redaction & Local Sandboxing
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--muted)', fontSize: '12px' }}>
        <span style={{ height: '1px', width: '80px', background: 'var(--line)' }} />
        <span>&darr; Native JoinNode Barrier (Waits for all branches to finish)</span>
        <span style={{ height: '1px', width: '80px', background: 'var(--line)' }} />
      </div>

      {/* Step 3: Join Node -> Router -> Synthesis */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
        <div
          onClick={() => setSelectedNode('join')}
          className={`topology-node-card ${selectedNode === 'join' ? 'selected' : ''}`}
          style={{ padding: '12px 18px', textAlign: 'center', minWidth: '180px' }}
        >
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>ADK JoinNode</span>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>Evidence Join Barrier</span>
          <span style={{ fontSize: '10px', color: 'var(--acc)', display: 'block', marginTop: '2px' }}>Max {execution.max_evidence_items ?? '—'} Evidence Items</span>
        </div>

        <ArrowRight size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />

        <div
          onClick={() => setSelectedNode('router')}
          className={`topology-node-card ${selectedNode === 'router' ? 'selected' : ''}`}
          style={{ padding: '12px 18px', textAlign: 'center', minWidth: '180px' }}
        >
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Specialist Router</span>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>Approved AgentTools</span>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>SHA-256 Hash Verified</span>
        </div>

        <ArrowRight size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />

        <div
          onClick={() => setSelectedNode('synthesis')}
          className={`topology-node-card ${selectedNode === 'synthesis' ? 'selected' : ''}`}
          style={{ padding: '12px 18px', textAlign: 'center', minWidth: '200px' }}
        >
          <span style={{ fontSize: '10px', color: '#10b981', display: 'block', fontWeight: 700 }}>Terminal Synthesis</span>
          <span style={{ fontSize: '12px', fontWeight: 700 }}>RCA Synthesizer LlmAgent</span>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>{modelLabel('synthesis', 'Configured model')} ({thinkingLabel('synthesis', 'Configured thinking')})</span>
        </div>
      </div>
    </div>
  );

  // Render the Inspector Panel for the selected node
  const renderNodeInspector = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
        <div>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--acc)', textTransform: 'uppercase' }}>
            Node Architectural Inspector
          </span>
          <h4 style={{ fontSize: '15px', fontWeight: 700, margin: '2px 0 0 0' }}>{activeNodeData.name}</h4>
        </div>
        <span className="badge badge-active" style={{ fontSize: '11px' }}>
          {activeNodeData.type.split('.').pop()}
        </span>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
        {activeNodeData.description}
      </p>

      {/* Specifications Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Model Profile</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{activeNodeData.model}</span>
        </div>
        <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Thinking Budget</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{activeNodeData.thinking}</span>
        </div>
        <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Max Output Cap</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{activeNodeData.outputLimit}</span>
        </div>
        <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Stage Mapping</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{activeNodeData.stageName}</span>
        </div>
      </div>

      {/* Bound Tools & Security Scope */}
      <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
        <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
          Bound Tools & Capabilities
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {activeNodeData.tools.map((tool, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
              <Shield size={12} style={{ color: 'var(--acc)' }} />
              <code>{tool}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Data Ingress & Egress */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ background: 'var(--bg)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Input Contract:</span>
          <span style={{ fontSize: '11px', color: 'var(--text)' }}>{activeNodeData.inputs}</span>
        </div>
        <div style={{ background: 'var(--bg)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', fontWeight: 600 }}>Output Contract:</span>
          <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>{activeNodeData.outputs}</span>
        </div>
      </div>

      {/* Python ADK Implementation Snippet */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Code2 size={12} /> Illustrative ADK Architecture Snippet
          </span>
          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>app/orchestrator/</span>
        </div>
        <pre style={{ margin: 0, padding: '12px', background: 'var(--card-subtle)', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '11px', color: 'var(--text)', overflowX: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
          <code>{activeNodeData.adkCode}</code>
        </pre>
      </div>
    </div>
  );

  return (
    <div className="view-container">
      {/* Header Banner */}
      {configError && <div className="card" style={{ color: 'var(--danger)' }}>{configError}<button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button></div>}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Runtime <span>Engine</span> & ADK Workflow
          </h1>
          <p className="hero-lede">
            Configured Google ADK workflow topology. The diagram describes the server configuration; live run stage execution is reported on the Runs page.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Engine:</b> Google ADK 2.9 Native
            </span>
            <span className="hero-stat-chip">
              <b>Runtime Mode:</b> {health.mode.toUpperCase()}
            </span>
            <span className="hero-stat-chip">
              <b>Max Concurrent Runs:</b> {execution.max_concurrent_runs ?? '—'}
            </span>
            <span className="hero-stat-chip">
              <b>Model Semaphore:</b> {execution.max_parallel_models ?? '—'} Parallel LLMs
            </span>
            <span className="hero-stat-chip">
              <b>Hard Deadline:</b> {execution.run_timeout_seconds ?? '—'}s UTC
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: health.mode === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)', padding: '6px 12px', borderRadius: '8px', border: `1px solid ${health.mode === 'live' ? '#10b981' : '#3b82f6'}` }}>
            <Radio size={14} className="pulse" style={{ color: health.mode === 'live' ? '#10b981' : '#3b82f6' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: health.mode === 'live' ? '#10b981' : '#3b82f6' }}>
              {health.mode.toUpperCase()} EXECUTION MODE
            </span>
          </div>
        </div>
      </section>

      {/* ADK Native Workflow Graph Visualization Card */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GitBranch size={15} style={{ color: 'var(--acc)' }} /> Native ADK Workflow Topology (Incident & File Evidence Join)
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              google-adk Workflow Graph with JoinNode & Specialist AgentTools (Click nodes to inspect)
            </span>
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Zoom Controls */}
            <div className="zoom-toolbar">
              <button type="button" className="zoom-btn" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut size={13} />
              </button>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '0 4px', minWidth: '42px', textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" className="zoom-btn" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn size={13} />
              </button>
              <button type="button" className="zoom-btn" onClick={handleZoomReset} title="Reset Zoom">
                <RotateCcw size={13} />
              </button>
            </div>

            {/* Toggle Inline Inspector */}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => setShowInspector(!showInspector)}
            >
              <Info size={13} />
              <span>{showInspector ? 'Hide Inspector' : 'Show Inspector'}</span>
            </button>

            {/* Fullscreen Expand Button */}
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '11px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              onClick={() => setIsExpanded(true)}
              title="Expand workflow topology to almost full-screen popup modal"
            >
              <Maximize2 size={13} />
              <span>Expand to Fullscreen</span>
            </button>
          </div>
        </div>

        {/* Scrollable Container for Topology Graph */}
        <div className="topology-scroll-container" style={{ maxHeight: '620px' }}>
          {renderWorkflowGraph(false)}
        </div>

        {/* Inline Inspector Drawer (when enabled) */}
        {showInspector && (
          <div style={{ marginTop: '16px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--line)' }}>
            {renderNodeInspector()}
          </div>
        )}
      </div>

      {/* Almost Fullscreen Popup Modal */}
      {isExpanded && (
        <div className="topology-modal-overlay" onClick={() => setIsExpanded(false)}>
          <div className="topology-modal-dialog" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="topology-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'var(--acc-subtle)', border: '1px solid var(--acc)' }}>
                  <GitBranch size={18} style={{ color: 'var(--acc)' }} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                      Native ADK Workflow Topology (Incident & File Evidence Join)
                    </h2>
                    <span className="badge badge-active" style={{ fontSize: '10px' }}>
                      ADK 2.9 GRAPH
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    High-Fidelity Interactive Graph with JoinNode Barrier & Specialist Agent Routing
                  </span>
                </div>
              </div>

              {/* Modal Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="zoom-toolbar">
                  <button type="button" className="zoom-btn" onClick={handleZoomOut} title="Zoom Out">
                    <ZoomOut size={14} />
                  </button>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '0 6px', minWidth: '46px', textAlign: 'center' }}>
                    {Math.round(zoom * 100)}%
                  </span>
                  <button type="button" className="zoom-btn" onClick={handleZoomIn} title="Zoom In">
                    <ZoomIn size={14} />
                  </button>
                  <button type="button" className="zoom-btn" onClick={handleZoomReset} title="Reset Zoom">
                    <RotateCcw size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setIsExpanded(false)}
                  title="Close Fullscreen View (Esc)"
                  style={{ width: '32px', height: '32px', borderRadius: '6px' }}
                >
                  <Minimize2 size={16} />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setIsExpanded(false)}
                  title="Close (Esc)"
                  style={{ width: '32px', height: '32px', borderRadius: '6px' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body (Scrollable Canvas + Inspector) */}
            <div className="topology-modal-body">
              <div className="topology-modal-canvas">
                {renderWorkflowGraph(true)}
              </div>

              <div className="topology-modal-inspector">
                {renderNodeInspector()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Concurrency Semaphores & Runtime Specs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={15} style={{ color: 'var(--acc)' }} /> Concurrency & Semaphore Limits
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max Parallel Models</span>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>{execution.max_parallel_models ?? '—'} (Semaphore)</span>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>Protects rate limits</span>
            </div>

            <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max Concurrent Runs</span>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>{execution.max_concurrent_runs ?? '—'} Active Runs</span>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>HTTP 429 when busy</span>
            </div>

            <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max LLM Calls / Run</span>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>{execution.max_llm_calls ?? '—'} Model Calls</span>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>Hard budget cap</span>
            </div>

            <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Max Evidence Items</span>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>{execution.max_evidence_items ?? '—'} Items</span>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>Bounded context</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={15} style={{ color: 'var(--acc)' }} /> OpenTelemetry (OTel) Instrumentation
          </h3>

          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
            Native OpenTelemetry traces wrap every agent invocation, tool callback, and database query. Traces are exported via gRPC/HTTP OTLP without customer payload leaks.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ background: 'var(--bg)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>Cloud Trace Span Filter:</span>
              <span style={{ color: '#10b981', fontWeight: 700 }}>ALLOWLISTED METADATA ONLY</span>
            </div>
            <div style={{ background: 'var(--bg)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>SSE Stream Endpoint:</span>
              <span>GET /api/v1/runs/&#123;id&#125;/events</span>
            </div>
            <div style={{ background: 'var(--bg)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>Cancellation Contract:</span>
              <span>POST /api/v1/runs/&#123;id&#125;/cancel</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
