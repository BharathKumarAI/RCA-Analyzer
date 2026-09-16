import React, { useState } from 'react';
import {
  Network,
  Cpu,
  GitBranch,
  Bot,
  Zap,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RotateCw,
  Terminal,
  Info,
  ExternalLink,
} from 'lucide-react';

interface DagNode {
  id: string;
  label: string;
  category: 'intake' | 'agent' | 'join' | 'specialist' | 'synthesis';
  branch: string;
  adkClass: string;
  description: string;
  tools: string[];
  executionSemantics: string;
}

const ARCHITECTURE_NODES: DagNode[] = [
  {
    id: 'intake',
    label: 'Principal & Scope Intake',
    category: 'intake',
    branch: 'Gateway & Scope Resolution',
    adkClass: 'FastAPI Middleware',
    description: 'Verifies RS256 JWT issuer, audience, signature, and server-side subject membership. Derives project roles via database and enforces 5-level deterministic scope precedence hierarchy.',
    tools: ['Token Authenticator', 'Scope Resolver'],
    executionSemantics: 'Synchronous gateway check before workflow initialization.',
  },
  {
    id: 'triage_jira',
    label: 'Jira Triage Agent',
    category: 'agent',
    branch: 'Incident Telemetry Branch',
    adkClass: 'LlmAgent (ADK Native)',
    description: 'Fetches incident fields via read-only Jira Cloud REST API v3 using cursor-based pagination and in-traversal budgeted ADF parsing. Project-scoped JQL only; writes are unsupported.',
    tools: ['jira_search_jql', 'jira_get_issue'],
    executionSemantics: 'Initiates the incident branch; precedes Splunk log correlation.',
  },
  {
    id: 'triage_splunk',
    label: 'Splunk Investigation Agent',
    category: 'agent',
    branch: 'Incident Telemetry Branch',
    adkClass: 'LlmAgent (ADK Native)',
    description: 'Correlates error clusters and investigates service call anomalies via bounded oneshot Splunk search queries.',
    tools: ['splunk_search_oneshot', 'splunk_correlate_events'],
    executionSemantics: 'Follows Jira triage in the incident branch with bounded search budgets.',
  },
  {
    id: 'attachment_ocr',
    label: 'Attachment Summarizer',
    category: 'agent',
    branch: 'Attachment Branch (Independent)',
    adkClass: 'LlmAgent (ADK Native)',
    description: 'Local bounded extraction and OCR for uploaded diagnostic files and incident logs. Runs independently in parallel without remote URL fetching or macros.',
    tools: ['ocr_extract_text', 'bounded_file_parser'],
    executionSemantics: 'Executes independently in parallel with the incident branch.',
  },
  {
    id: 'join_node',
    label: 'ADK JoinNode Barrier',
    category: 'join',
    branch: 'Workflow Join Barrier',
    adkClass: 'JoinNode (ADK Native)',
    description: 'Deterministic barrier that synchronizes the incident branch and attachment summarization branch before specialist dispatch and synthesis.',
    tools: [],
    executionSemantics: 'Waits for both parallel branches to complete before advancing the workflow.',
  },
  {
    id: 'specialist_agents',
    label: 'Approved Specialist AgentTools',
    category: 'specialist',
    branch: 'Specialist Evaluation',
    adkClass: 'AgentTool (ADK Native Dynamic)',
    description: 'Database-approved project specialists submitted via `/api/v1/agent-configurations`. Wrapped as ADK AgentTool instances only after review by a same-scope administrator.',
    tools: ['project_approved_tools'],
    executionSemantics: 'Invoked conditionally after the JoinNode barrier based on incident characteristics.',
  },
  {
    id: 'synthesis',
    label: 'Final RCA Synthesis Agent',
    category: 'synthesis',
    branch: 'Synthesis & Deductions',
    adkClass: 'LlmAgent (ADK Native)',
    description: 'Deductively synthesizes verified findings, generates multi-methodology causal explanations, and prepares evidence-grounded incident summaries.',
    tools: ['rca_evidence_compiler'],
    executionSemantics: 'Final node in the root workflow graph before persisting the completed investigation.',
  },
];

export const Orchestration: React.FC = () => {
  const [selectedNode, setSelectedNode] = useState<DagNode>(ARCHITECTURE_NODES[1]);

  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        overflowY: 'auto',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header Banner */}
      <div
        className="platform-card"
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--accent-indigo), var(--accent-rose))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(99, 102, 241, 0.25)',
            }}
          >
            <Network size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--ink-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                }}
              >
                GOOGLE ADK WORKFLOW TOPOLOGY • ARCHITECTURE REFERENCE
              </span>
              <span className="badge badge-teal">Native ADK Graph</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              Agent Orchestration & Workflow DAG
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Declarative reference of the Google ADK root workflow graph, join barriers, and specialist handoffs as specified in architecture documentation.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-magenta">Deterministic Graph</span>
        </div>
      </div>

      {/* Info Notice Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '14px 18px',
          borderRadius: '8px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          fontSize: '12.5px',
          color: 'var(--ink-secondary)',
          lineHeight: 1.5,
        }}
      >
        <Info size={18} style={{ color: 'var(--accent-indigo)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ color: 'var(--ink-primary)' }}>Architecture Reference:</strong> The ADK workflow graph topology below illustrates the static execution contract defined in <code>app/agents/workflow.py</code> and <code>docs/architecture.md</code>. Real-time run traces, event logs, and measured tool latencies are captured dynamically under <strong>Investigations</strong>.
        </div>
      </div>

      {/* Main Visualizer & Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 380px)', gap: '20px' }}>
        {/* Left: Workflow Visual DAG */}
        <div
          className="platform-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Execution Graph Pipeline
            </div>
            <span style={{ fontSize: '11px', color: 'var(--ink-tertiary)' }}>Click node to inspect contract</span>
          </div>

          {/* Flow Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {ARCHITECTURE_NODES.map((node, index) => {
              const isSelected = selectedNode.id === node.id;
              return (
                <div key={node.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div
                    onClick={() => setSelectedNode(node)}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(244, 63, 94, 0.08)' : 'var(--bg-elevated)',
                      border: isSelected ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '8px',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isSelected ? 'var(--accent-rose)' : 'var(--accent-teal)',
                          flexShrink: 0,
                        }}
                      >
                        {node.category === 'agent' ? <Bot size={17} /> : node.category === 'join' ? <GitBranch size={17} /> : <Cpu size={17} />}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                          {node.label}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                          {node.branch}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span className="badge badge-neutral" style={{ fontSize: '10.5px' }}>
                        {node.adkClass}
                      </span>
                    </div>
                  </div>

                  {index < ARCHITECTURE_NODES.length - 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--ink-tertiary)', padding: '2px 0', fontSize: '12px' }}>
                      ↓
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Node Details Inspector */}
        <div
          className="platform-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            height: 'fit-content',
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
            <span className="badge badge-rose" style={{ textTransform: 'uppercase', fontSize: '10.5px' }}>
              {selectedNode.category} NODE
            </span>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-primary)', margin: '8px 0 0 0' }}>
              {selectedNode.label}
            </h2>
            <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary)', margin: '6px 0 0 0', lineHeight: 1.55 }}>
              {selectedNode.description}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>
                ADK Implementation Primitive
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink-primary)', marginTop: '4px', fontFamily: "'JetBrains Mono', monospace" }}>
                {selectedNode.adkClass}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>
                Execution Semantics
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '4px', lineHeight: 1.5 }}>
                {selectedNode.executionSemantics}
              </div>
            </div>

            {selectedNode.tools.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>
                  Supported Domain Tools
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {selectedNode.tools.map((t, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--accent-rose)',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
