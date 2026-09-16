import React, { useState } from 'react';
import {
  BookOpen,
  Terminal,
  Cpu,
  Layers,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  Copy,
  Check,
  Search,
  ExternalLink,
  Code2,
  Database,
  Network,
  Wrench,
  Container,
} from 'lucide-react';

export const Docs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'how-to-use' | 'how-it-works' | 'how-to-request' | 'tools-connectors' | 'mcp' | 'tester'>('how-to-use');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Interactive Schema Tester state
  const [testToolSchema, setTestToolSchema] = useState(
    JSON.stringify(
      {
        name: 'splunk_search_oneshot',
        description: 'Execute bounded read-only oneshot search query against Splunk Enterprise log index',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string (e.g. index=prod_gateway status>=500)' },
            earliest_time: { type: 'string', default: '-1h', description: 'Earliest relative or absolute time boundary' },
            latest_time: { type: 'string', default: 'now', description: 'Latest time boundary' },
          },
          required: ['query'],
        },
        is_read_only: true,
        connector_type: 'SPLUNK',
      },
      null,
      2
    )
  );
  const [schemaValidationResult, setSchemaValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleValidateSchema = () => {
    try {
      const parsed = JSON.parse(testToolSchema);
      if (!parsed.name || typeof parsed.name !== 'string') {
        throw new Error("Missing required string property: 'name'");
      }
      if (!parsed.description || typeof parsed.description !== 'string') {
        throw new Error("Missing required string property: 'description'");
      }
      if (!parsed.parameters || typeof parsed.parameters !== 'object') {
        throw new Error("Missing required object property: 'parameters'");
      }
      setSchemaValidationResult({
        valid: true,
        message: `Tool '${parsed.name}' schema is valid for Google ADK AgentTool binding. (Read-only: ${parsed.is_read_only !== false})`,
      });
    } catch (err: any) {
      setSchemaValidationResult({
        valid: false,
        message: `Schema Validation Error: ${err.message}`,
      });
    }
  };

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
              background: 'linear-gradient(135deg, var(--accent-indigo), var(--accent-teal))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(99, 102, 241, 0.25)',
            }}
          >
            <BookOpen size={24} />
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
                PLATFORM PLAYBOOKS & KNOWLEDGE
              </span>
              <span className="badge badge-teal">Google ADK Architecture</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              Operational Playbooks & Developer Docs
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Comprehensive operational blueprints, Google ADK workflow architecture, tool schema contracts, and interactive testers.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '10px',
          overflowX: 'auto',
        }}
      >
        {[
          { id: 'how-to-use', label: '1. Incident Triage Guide' },
          { id: 'how-it-works', label: '2. ADK Architecture & Topology' },
          { id: 'how-to-request', label: '3. Specialist Agents & Requests' },
          { id: 'tools-connectors', label: '4. Tools & Connectors Registry' },
          { id: 'mcp', label: '5. Model Context Protocol (MCP)' },
          { id: 'tester', label: '6. Schema Validator & Playground' },
        ].map((t) => {
          const isSelected = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: isSelected ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                background: isSelected ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-card)',
                color: isSelected ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {activeTab === 'how-to-use' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="platform-card" style={{ padding: '20px', borderRadius: '10px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-primary)', marginBottom: '8px' }}>
                Incident Investigation Standard Operating Procedure (SOP)
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
                Follow this standard 4-stage operational journey for triaging production alerts, validating root causes, and executing safe mitigations.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
                <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-rose)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>1</div>
                    <strong style={{ fontSize: '13px', color: 'var(--ink-primary)' }}>Pick & Acknowledge</strong>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Monitor the Live Triage Board Focus Queue. Click "Inspect" on highest-urgency tickets and acknowledge ownership to stop unassigned queue timer.
                  </p>
                </div>

                <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-amber)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>2</div>
                    <strong style={{ fontSize: '13px', color: 'var(--ink-primary)' }}>Review RCA Hypotheses</strong>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Inspect the saved summary, evidence, and uncertainties. Validate findings against their sources before acting.
                  </p>
                </div>

                <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-teal)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>3</div>
                    <strong style={{ fontSize: '13px', color: 'var(--ink-primary)' }}>Execute Grounded Tools</strong>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Under the Tools tab, execute read-only Jira issue searches or Splunk error log correlations to verify telemetry before acting.
                  </p>
                </div>

                <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent-indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>4</div>
                    <strong style={{ fontSize: '13px', color: 'var(--ink-primary)' }}>Handoff or Resolve</strong>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Review findings, save a local investigation note, and record the responsible team. Connected source systems remain read only.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'how-it-works' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="platform-card" style={{ padding: '20px', borderRadius: '10px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-primary)', marginBottom: '8px' }}>
                Google ADK Root Workflow Architecture
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
                RCA assist uses native Google ADK <code>LlmAgent</code>, <code>Workflow</code>, <code>JoinNode</code>, <code>AgentTool</code>, and <code>FunctionTool</code> primitives. The request path traverses FastAPI &rarr; authenticated settings/scope &rarr; capability resolution &rarr; SQLAlchemy async persistence &rarr; ADK root workflow.
              </p>

              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '16px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  color: 'var(--accent-teal)',
                  lineHeight: 1.6,
                  marginTop: '12px',
                }}
              >
                FastAPI Request (RS256 Verified Principal)<br />
                &nbsp;&nbsp;↓<br />
                5-Level Deterministic Scope Resolution (project + instance + env → project-wide → platform default)<br />
                &nbsp;&nbsp;↓<br />
                ADK Root Workflow Graph:<br />
                &nbsp;&nbsp;├── Triage Branch: Jira Triage Agent → Splunk Investigation Agent<br />
                &nbsp;&nbsp;└── Attachment Summarization Branch: Local bounded OCR & Text Extraction<br />
                &nbsp;&nbsp;↓<br />
                JoinNode (Synchronizes parallel branches and aggregates evidence)<br />
                &nbsp;&nbsp;↓<br />
                Approved Specialist AgentTools (Database-first approved custom agents)<br />
                &nbsp;&nbsp;↓<br />
                Final Synthesis Agent (Generates grounded root cause report & recommendations)
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tester' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="platform-card" style={{ padding: '20px', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
                  Interactive Tool Schema Validator
                </h2>
                <button
                  onClick={handleValidateSchema}
                  className="btn btn-primary"
                  style={{ padding: '6px 14px', fontSize: '12px', gap: '6px' }}
                >
                  <Play size={12} />
                  <span>Validate Schema</span>
                </button>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', marginBottom: '14px' }}>
                Validate tool JSON schemas against the Google ADK <code>FunctionTool</code> contract before registering them in the capability catalog.
              </p>

              <textarea
                value={testToolSchema}
                onChange={(e) => setTestToolSchema(e.target.value)}
                rows={12}
                style={{
                  width: '100%',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  color: 'var(--ink-primary)',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />

              {schemaValidationResult && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: schemaValidationResult.valid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                    border: schemaValidationResult.valid ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(244, 63, 94, 0.3)',
                    color: schemaValidationResult.valid ? 'var(--accent-teal)' : 'var(--accent-rose)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {schemaValidationResult.valid ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <span>{schemaValidationResult.message}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {(activeTab === 'how-to-request' || activeTab === 'tools-connectors' || activeTab === 'mcp') && (
          <div className="platform-card" style={{ padding: '24px', borderRadius: '10px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-primary)', marginBottom: '12px' }}>
              {activeTab === 'how-to-request'
                ? 'Specialist Agent Registration & Review Process'
                : activeTab === 'tools-connectors'
                ? 'Supported Connectors & Tool Brokers'
                : 'Model Context Protocol (MCP) Standards'}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
              {activeTab === 'how-to-request'
                ? 'Custom agent definitions are submitted via `/api/v1/agent-configurations`, validated against the data-only definition model, and stored by content hash in the blob store. Only a same-scope administrator other than the author can approve it. The orchestrator sees approved definitions only.'
                : activeTab === 'tools-connectors'
                ? 'All connector operations are strictly read-only Jira Cloud REST v3 (with cursor pagination, budgeted ADF traversal, and project-scoped JQL) and Splunk Enterprise search. Database querying, write mutations, remote file fetches, and code execution are unsupported.'
                : 'MCP integration allows registering external tool providers adhering to JSON-RPC 2.0. Tools must declare explicit read-only semantics, bounded query timeouts, and schema constraints to be bound into Google ADK execution workflows.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
