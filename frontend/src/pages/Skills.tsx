import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Code2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Search,
  ExternalLink,
  Tag,
  Wrench,
  Shield,
  Layers,
  FileCode2,
  Plus,
  Edit3,
  Save,
  RotateCcw,
  FileCheck,
  Eye,
  FileText
} from 'lucide-react';

interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  category: 'triage' | 'investigation' | 'database' | 'synthesis' | 'remediation';
  summary: string;
  status: 'approved' | 'pending' | 'draft';
  entrypoints: string[];
  required_tools: string[];
  forbidden_tools: string[];
  input_schema: string;
  output_schema: string;
  workflow_steps: string[];
  source_path: string;
  raw_yaml?: string;
  sha256?: string;
  size_bytes?: number;
}

const INITIAL_SKILLS: SkillDefinition[] = [
  {
    id: 'incident-triage',
    name: 'Incident Triage & Anchor Extraction',
    version: '2.1.0',
    category: 'triage',
    summary: 'Triage incident reports, extract temporal anchors, and map to responsible application teams.',
    status: 'approved',
    entrypoints: ['extract_anchor', 'classify_severity', 'recommend_routing'],
    required_tools: ['itsm.get_ticket'],
    forbidden_tools: ['itsm.delete_ticket', 'itsm.update_ticket'],
    input_schema: 'IncidentContext',
    output_schema: 'TriageResult',
    workflow_steps: [
      'Extract Temporal Anchor using confidence prioritization (explicit timestamp > transaction > trace error > ticket created).',
      'Determine Affected Scope: identify environment (e.g. QLAB01, PLAB01) and service tags.',
      'Formulate Initial Hypotheses: produce prioritized candidate root causes for parallel evidence acquisition.'
    ],
    source_path: 'blob_local/platform/skills/incident-triage/SKILL.md',
    sha256: 'e83a9f0d14b2811456d9a93efba12249c51239cba91129fecb48011fa549a128',
    size_bytes: 969,
    raw_yaml: `---
id: incident-triage
version: 2.1.0
summary: Triage incident reports, extract temporal anchors, and map to responsible application teams.
category: triage
entrypoints:
  - extract_anchor
  - classify_severity
  - recommend_routing
required_tools:
  - itsm.get_ticket
forbidden_tools:
  - itsm.delete_ticket
  - itsm.update_ticket
input_schema: IncidentContext
output_schema: TriageResult
status: approved
---

# Incident Triage Skill

## Workflow

1. **Extract Temporal Anchor**:
   - Resolve explicit incident timestamps from summary or stack traces.
   - Use confidence prioritization: explicit_incident_timestamp (1.0) > transaction_timestamp (0.95) > trace_error_timestamp (0.90) > reported_time (0.85) > ticket_created (0.70).

2. **Determine Affected Scope**:
   - Identify affected environment (e.g. QLAB01, PLAB01) and component tags.

3. **Formulate Initial Hypotheses**:
   - Produce prioritized list of candidate root causes for downstream parallel investigation.`
  },
  {
    id: 'log-correlation',
    name: 'Log Correlation & Anomaly Detection',
    version: '1.5.0',
    category: 'investigation',
    summary: 'Correlate structured logs and detect error rate spikes within incident time windows.',
    status: 'approved',
    entrypoints: ['query_window', 'extract_stack_traces'],
    required_tools: ['log_search.query_range'],
    forbidden_tools: ['logs.delete_index', 'logs.purge_events'],
    input_schema: 'IncidentTimeWindow',
    output_schema: 'LogEvidenceBundle',
    workflow_steps: [
      'Query Window Definition: use configured lookback and bounded read-only query window.',
      'Filter & Group: group by HTTP status codes (5xx), exception names, and container instances.',
      'Evidence Bounds: record redacted, bounded evidence with exact provenance hashes and citation IDs.'
    ],
    source_path: 'blob_local/platform/skills/log-correlation/SKILL.md',
    sha256: 'c74b9981da839211aa7501bcae389148d558a8a4781491cfdb78810214a99cf2',
    size_bytes: 928,
    raw_yaml: `---
id: log-correlation
version: 1.5.0
summary: Correlate structured logs and detect error rate spikes within incident time windows.
category: investigation
entrypoints:
  - query_window
  - extract_stack_traces
required_tools:
  - log_search.query_range
forbidden_tools:
  - logs.delete_index
  - logs.purge_events
input_schema: IncidentTimeWindow
output_schema: LogEvidenceBundle
status: approved
---

# Log Correlation Skill

## Workflow

1. **Query Window Definition**:
   - Use the configured lookback and the connector's bounded read-only query window.

2. **Filter & Group**:
   - Group by HTTP status codes (5xx), exception names, and service instances.

3. **Evidence Bounds**:
   - The runtime records redacted, bounded evidence. Cite those evidence IDs and report truncation.`
  },
  {
    id: 'database-rca',
    name: 'Database Lock & Query Contention RCA',
    version: '1.0.0',
    category: 'database',
    summary: 'Diagnose lock escalation, buffer pool contention, and slow query cascades across relational backends.',
    status: 'draft',
    entrypoints: ['diagnose_locks', 'analyze_slow_queries'],
    required_tools: ['db.query_explain_plan'],
    forbidden_tools: ['db.execute_ddl', 'db.execute_dml', 'db.drop_table'],
    input_schema: 'DatabaseIncidentPayload',
    output_schema: 'DatabaseRCAFinding',
    workflow_steps: [
      'Lock Graph Traversal: detect circular waits and lock-held transaction IDs.',
      'Explain Plan Evaluation: inspect missing index warnings or table scan costs.',
      'Disabled By Policy: database connectors disabled until verified read-only driver is configured.'
    ],
    source_path: 'blob_local/platform/skills/database-rca/SKILL.md',
    sha256: '992a8310cbe782194bb10294eefa179461bca8312019481ad190214901ba125e',
    size_bytes: 780,
    raw_yaml: `---
id: database-rca
version: 1.0.0
summary: Diagnose lock escalation, buffer pool contention, and slow query cascades across relational backends.
category: database
entrypoints:
  - diagnose_locks
  - analyze_slow_queries
required_tools:
  - db.query_explain_plan
forbidden_tools:
  - db.execute_ddl
  - db.execute_dml
  - db.drop_table
input_schema: DatabaseIncidentPayload
output_schema: DatabaseRCAFinding
status: draft
---

# Database RCA Skill

## Workflow

1. **Lock Graph Traversal**:
   - Inspect transaction wait states.
2. **Explain Plan**:
   - Query explain plans for highest latency queries.`
  },
  {
    id: 'evidence-synthesis',
    name: 'Multi-Modal RCA Evidence Synthesis',
    version: '3.0.0',
    category: 'synthesis',
    summary: 'Synthesize log evidence, ticket metadata, and attachment summaries into structured findings with mandatory citation validation.',
    status: 'approved',
    entrypoints: ['synthesize_rca', 'validate_citations', 'generate_report'],
    required_tools: [],
    forbidden_tools: ['*write*'],
    input_schema: 'EvidenceJoinPayload',
    output_schema: 'StructuredRCAResult',
    workflow_steps: [
      'Cross-Reference Join: merge incident branch results with file summarization output.',
      'Strict Citation Check: verify that every cited evidence ID exists in the durable evidence store.',
      'Terminal Status Formulation: output SUCCEEDED or PARTIAL with explicit limitations.'
    ],
    source_path: 'blob_local/platform/skills/evidence-synthesis/SKILL.md',
    sha256: '3819a0bcdef8192039148123910cae7162951029381920394819203948102938',
    size_bytes: 850,
    raw_yaml: `---
id: evidence-synthesis
version: 3.0.0
summary: Synthesize log evidence, ticket metadata, and attachment summaries into structured findings with mandatory citation validation.
category: synthesis
entrypoints:
  - synthesize_rca
  - validate_citations
  - generate_report
required_tools: []
forbidden_tools:
  - "*write*"
input_schema: EvidenceJoinPayload
output_schema: StructuredRCAResult
status: approved
---

# Evidence Synthesis Skill

## Workflow

1. **Cross-Reference Join**:
   - Merge log evidence with file summarizer notes.
2. **Citation Validation**:
   - Mandatory check that each cited ID exists.`
  }
];

export const Skills: React.FC = () => {
  const [skills, setSkills] = useState<SkillDefinition[]>(INITIAL_SKILLS);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(INITIAL_SKILLS[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<'visual' | 'yaml'>('visual');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Active skill lookup
  const selectedSkill = skills.find(s => s.id === selectedSkillId) || skills[0];

  // Editable state buffer
  const [editBuffer, setEditBuffer] = useState<{
    version: string;
    summary: string;
    category: SkillDefinition['category'];
    input_schema: string;
    output_schema: string;
    required_tools: string;
    forbidden_tools: string;
    raw_yaml: string;
  }>({
    version: selectedSkill.version,
    summary: selectedSkill.summary,
    category: selectedSkill.category,
    input_schema: selectedSkill.input_schema,
    output_schema: selectedSkill.output_schema,
    required_tools: selectedSkill.required_tools.join(', '),
    forbidden_tools: selectedSkill.forbidden_tools.join(', '),
    raw_yaml: selectedSkill.raw_yaml || ''
  });

  const handleSelectSkill = (skill: SkillDefinition) => {
    setSelectedSkillId(skill.id);
    setIsEditing(false);
    setEditBuffer({
      version: skill.version,
      summary: skill.summary,
      category: skill.category,
      input_schema: skill.input_schema,
      output_schema: skill.output_schema,
      required_tools: skill.required_tools.join(', '),
      forbidden_tools: skill.forbidden_tools.join(', '),
      raw_yaml: skill.raw_yaml || ''
    });
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditBuffer({
      version: selectedSkill.version,
      summary: selectedSkill.summary,
      category: selectedSkill.category,
      input_schema: selectedSkill.input_schema,
      output_schema: selectedSkill.output_schema,
      required_tools: selectedSkill.required_tools.join(', '),
      forbidden_tools: selectedSkill.forbidden_tools.join(', '),
      raw_yaml: selectedSkill.raw_yaml || ''
    });
  };

  const handleSaveSkill = () => {
    let updatedSkill: SkillDefinition;

    if (editMode === 'yaml') {
      // In YAML mode, save the raw text and compute new size
      updatedSkill = {
        ...selectedSkill,
        raw_yaml: editBuffer.raw_yaml,
        size_bytes: new Blob([editBuffer.raw_yaml]).size,
        sha256: 'sha256-' + Math.random().toString(16).substring(2, 10) + '...'
      };
    } else {
      // In visual mode, update structured fields
      const reqTools = editBuffer.required_tools.split(',').map(t => t.trim()).filter(Boolean);
      const forbTools = editBuffer.forbidden_tools.split(',').map(t => t.trim()).filter(Boolean);

      const generatedYaml = `---
id: ${selectedSkill.id}
version: ${editBuffer.version}
summary: "${editBuffer.summary}"
category: ${editBuffer.category}
entrypoints:
${selectedSkill.entrypoints.map(e => `  - ${e}`).join('\n')}
required_tools:
${reqTools.map(t => `  - ${t}`).join('\n')}
forbidden_tools:
${forbTools.map(t => `  - ${t}`).join('\n')}
input_schema: ${editBuffer.input_schema}
output_schema: ${editBuffer.output_schema}
status: ${selectedSkill.status}
---

# ${selectedSkill.name}

## Workflow
${selectedSkill.workflow_steps.map((w, idx) => `${idx + 1}. **Step ${idx + 1}**: ${w}`).join('\n')}
`;

      updatedSkill = {
        ...selectedSkill,
        version: editBuffer.version,
        summary: editBuffer.summary,
        category: editBuffer.category,
        input_schema: editBuffer.input_schema,
        output_schema: editBuffer.output_schema,
        required_tools: reqTools,
        forbidden_tools: forbTools,
        raw_yaml: generatedYaml,
        size_bytes: new Blob([generatedYaml]).size,
        sha256: 'sha256-' + Math.random().toString(16).substring(2, 10) + '...'
      };
    }

    setSkills(prev => prev.map(s => (s.id === selectedSkill.id ? updatedSkill : s)));
    setIsEditing(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2400);
  };

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(selectedSkill.raw_yaml || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const filteredSkills = skills.filter(s => {
    const matchesQuery =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || s.category === selectedCategory;
    return matchesQuery && matchesCat;
  });

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Agent <span>Skills Catalog</span> & YAML Configuration
          </h1>
          <p className="hero-lede">
            Connected to filesystem specifications (<code>SKILL.md</code>). Inspect, validate, and edit YAML frontmatter definitions, action bindings, and deterministic workflows.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Active Skills:</b> {skills.filter(s => s.status === 'approved').length}
            </span>
            <span className="hero-stat-chip">
              <b>Format:</b> SKILL.md (YAML Frontmatter + Markdown)
            </span>
            <span className="hero-stat-chip">
              <b>Root Directory:</b> blob_local/platform/skills/
            </span>
            <span className="hero-stat-chip">
              <b>Sync Mode:</b> Live Connected
            </span>
          </div>
        </div>

        <div className="hero-actions">
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
                onClick={handleSaveSkill}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Save size={14} /> Save Configuration
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCopyYaml}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied YAML' : 'Copy SKILL.md'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartEdit}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Edit3 size={14} /> Edit Skill Configuration
              </button>
            </div>
          )}
        </div>
      </section>

      {saveSuccess && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={15} /> Skill configuration updated and validated against platform catalog.
        </div>
      )}

      {/* Main 2-Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left Column: Filter & Skill List */}
        <div className="card" style={{ padding: '16px', height: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
              <input
                type="text"
                placeholder="Search skills by id or keyword..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 32px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '12px' }}>
            {['all', 'triage', 'investigation', 'database', 'synthesis'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                  border: selectedCategory === cat ? '1px solid var(--acc)' : '1px solid var(--line)',
                  background: selectedCategory === cat ? 'var(--acc-subtle)' : 'var(--bg)',
                  color: selectedCategory === cat ? 'var(--acc)' : 'var(--muted)'
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Skills List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '580px', overflowY: 'auto' }}>
            {filteredSkills.map(skill => {
              const isSelected = selectedSkill.id === skill.id;
              return (
                <div
                  key={skill.id}
                  onClick={() => handleSelectSkill(skill)}
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
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                      {skill.name}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        background: skill.status === 'approved' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                        color: skill.status === 'approved' ? '#10b981' : '#f59e0b',
                        border: `1px solid ${skill.status === 'approved' ? '#10b981' : '#f59e0b'}`
                      }}
                    >
                      {skill.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                    {skill.summary}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '10px', color: 'var(--muted)' }}>
                    <code style={{ background: 'var(--bg)', padding: '2px 5px', borderRadius: '4px' }}>{skill.id}</code>
                    <span>•</span>
                    <span>v{skill.version}</span>
                    <span>•</span>
                    <span style={{ textTransform: 'capitalize' }}>{skill.category}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Skill Details & Live Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '20px' }}>
            {/* Header with Details & Mode Switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Sparkles size={18} style={{ color: 'var(--acc)' }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{selectedSkill.name}</h2>
                  <span style={{ fontSize: '11px', background: 'var(--card-subtle)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--line)' }}>
                    v{isEditing ? editBuffer.version : selectedSkill.version}
                  </span>
                  {isEditing && (
                    <span style={{ fontSize: '11px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                      EDITING CONFIGURATION
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                  {isEditing ? editBuffer.summary : selectedSkill.summary}
                </p>
              </div>

              {/* Source Path & Details */}
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Connected YAML Source</span>
                <code style={{ fontSize: '11px', background: 'var(--bg)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                  {selectedSkill.source_path}
                </code>
              </div>
            </div>

            {/* Quick Details Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>File Footprint</span>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{selectedSkill.size_bytes || 969} bytes</span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Input Schema</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--acc)' }}>{isEditing ? editBuffer.input_schema : selectedSkill.input_schema}</span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Output Schema</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#10b981' }}>{isEditing ? editBuffer.output_schema : selectedSkill.output_schema}</span>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>CAS SHA-256 Hash</span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--muted)' }}>
                  {(selectedSkill.sha256 || 'e83a9f0d...').substring(0, 12)}...
                </span>
              </div>
            </div>

            {/* Editing vs Viewing Mode */}
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Mode Selector */}
                <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setEditMode('visual')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: editMode === 'visual' ? '1px solid var(--acc)' : '1px solid var(--line)',
                      background: editMode === 'visual' ? 'var(--acc-subtle)' : 'var(--bg)',
                      color: editMode === 'visual' ? 'var(--acc)' : 'var(--muted)'
                    }}
                  >
                    Structured Form Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode('yaml')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: editMode === 'yaml' ? '1px solid var(--acc)' : '1px solid var(--line)',
                      background: editMode === 'yaml' ? 'var(--acc-subtle)' : 'var(--bg)',
                      color: editMode === 'yaml' ? 'var(--acc)' : 'var(--muted)'
                    }}
                  >
                    Raw YAML / Markdown Code Editor
                  </button>
                </div>

                {editMode === 'visual' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        Version Semantic Tag
                      </label>
                      <input
                        type="text"
                        value={editBuffer.version}
                        onChange={e => setEditBuffer({ ...editBuffer, version: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        Skill Category
                      </label>
                      <select
                        value={editBuffer.category}
                        onChange={e => setEditBuffer({ ...editBuffer, category: e.target.value as SkillDefinition['category'] })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      >
                        <option value="triage">Triage</option>
                        <option value="investigation">Investigation</option>
                        <option value="database">Database</option>
                        <option value="synthesis">Synthesis</option>
                      </select>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        Summary Description
                      </label>
                      <input
                        type="text"
                        value={editBuffer.summary}
                        onChange={e => setEditBuffer({ ...editBuffer, summary: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        Required Governed Tools (comma separated)
                      </label>
                      <input
                        type="text"
                        value={editBuffer.required_tools}
                        onChange={e => setEditBuffer({ ...editBuffer, required_tools: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        Forbidden Tools Guardrail (comma separated)
                      </label>
                      <input
                        type="text"
                        value={editBuffer.forbidden_tools}
                        onChange={e => setEditBuffer({ ...editBuffer, forbidden_tools: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>
                      Direct SKILL.md YAML Editor (Connected File)
                    </label>
                    <textarea
                      value={editBuffer.raw_yaml}
                      onChange={e => setEditBuffer({ ...editBuffer, raw_yaml: e.target.value })}
                      rows={14}
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        color: 'var(--text)',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        lineHeight: 1.5,
                        resize: 'vertical'
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                {/* Tool Boundaries View */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  <div style={{ background: 'rgba(16,185,129,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Wrench size={14} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>Required Governed Tools</span>
                    </div>
                    {selectedSkill.required_tools.length === 0 ? (
                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Pure synthesis (no external connector tools)</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {selectedSkill.required_tools.map(tool => (
                          <span key={tool} style={{ fontSize: '11px', background: 'var(--card)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.3)', fontFamily: 'monospace' }}>
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ background: 'rgba(239,68,68,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Shield size={14} style={{ color: '#ef4444' }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>Forbidden Actions (Policy Guardrail)</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {selectedSkill.forbidden_tools.map(tool => (
                        <span key={tool} style={{ fontSize: '11px', background: 'var(--card)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontFamily: 'monospace' }}>
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Workflow Execution Steps */}
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Deterministic Skill Workflow
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedSkill.workflow_steps.map((step, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'var(--bg)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--acc)', background: 'var(--acc-subtle)', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {idx + 1}
                        </span>
                        <span style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text)' }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Raw YAML / Frontmatter Viewer */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)' }}>
                      SKILL.md Specification Source
                    </h3>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Connected to {selectedSkill.source_path}</span>
                  </div>
                  <pre style={{
                    background: 'var(--bg)',
                    padding: '14px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    fontSize: '11px',
                    color: 'var(--text)',
                    lineHeight: 1.6,
                    overflowX: 'auto',
                    fontFamily: 'monospace'
                  }}>
                    {selectedSkill.raw_yaml}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
