import React, { useState } from 'react';
import {
  Sliders,
  Cpu,
  Zap,
  Save,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  HelpCircle,
  FileCode,
  CheckCircle2,
  Info,
  DollarSign
} from 'lucide-react';

interface StageConfig {
  model: string;
  thinking_level: 'minimal' | 'low' | 'medium' | 'high';
  temperature: number;
  max_output_tokens: number;
  description: string;
  prompt_preview: string;
}

interface ProfileConfig {
  name: string;
  id: string;
  description: string;
  tool_call_limit: number;
  stages: {
    extraction: string;
    triage: string;
    logs: string;
    synthesis: string;
  };
}

const DEFAULT_STAGES: Record<string, StageConfig> = {
  extraction: {
    model: 'gemini-3.5-flash-lite',
    thinking_level: 'minimal',
    temperature: 1.0,
    max_output_tokens: 2048,
    description: 'Summarizes bounded uploaded incident attachments, logs, and OCR text.',
    prompt_preview: 'Summarize attachment text strictly without extrapolating beyond provided evidence tokens.'
  },
  triage: {
    model: 'gemini-3.5-flash-lite',
    thinking_level: 'low',
    temperature: 1.0,
    max_output_tokens: 2048,
    description: 'Extracts temporal anchors, affected scopes, and initial incident hypotheses from Jira ticket.',
    prompt_preview: 'Extract exact anchor timestamps, impacted services, and error symptoms from incident ticket.'
  },
  logs: {
    model: 'gemini-3.8-flash',
    thinking_level: 'low',
    temperature: 1.0,
    max_output_tokens: 4096,
    description: 'Queries Splunk within bounded windows, correlates stack traces and detects 5xx spikes.',
    prompt_preview: 'Formulate bounded index search, group 5xx anomalies, and cite exact evidence IDs.'
  },
  synthesis: {
    model: 'gemini-3.8-flash',
    thinking_level: 'high',
    temperature: 1.0,
    max_output_tokens: 8192,
    description: 'Synthesizes log findings, ticket details, and attachment evidence with mandatory citation validation.',
    prompt_preview: 'Synthesize verified root cause findings, validate citations, and declare SUCCEEDED or PARTIAL.'
  },
  fast_synthesis: {
    model: 'gemini-3.5-flash-lite',
    thinking_level: 'medium',
    temperature: 1.0,
    max_output_tokens: 4096,
    description: 'Accelerated synthesis stage for lower latency and reduced token consumption in development.',
    prompt_preview: 'Produce fast structured RCA summary with prioritized evidence citations.'
  }
};

const DEFAULT_PROFILES: ProfileConfig[] = [
  {
    id: 'balanced-investigation',
    name: 'Balanced Investigation (Production Default)',
    description: 'Optimal trade-off between reasoning depth and execution speed. Uses Flash-Lite for intake and Flash with High Thinking for synthesis.',
    tool_call_limit: 12,
    stages: {
      extraction: 'extraction',
      triage: 'triage',
      logs: 'logs',
      synthesis: 'synthesis'
    }
  },
  {
    id: 'fast-investigation',
    name: 'Fast Investigation (Incident Rush)',
    description: 'Accelerated pipeline capping tool calls to 8 and leveraging fast synthesis for rapid MTTR reduction.',
    tool_call_limit: 8,
    stages: {
      extraction: 'extraction',
      triage: 'triage',
      logs: 'logs',
      synthesis: 'fast_synthesis'
    }
  },
  {
    id: 'high-reasoning-synthesis',
    name: 'High-Reasoning Forensic Synthesis',
    description: 'Deep investigative profile dedicating maximum thinking budgets and reasoning steps to complex cascading failures.',
    tool_call_limit: 16,
    stages: {
      extraction: 'extraction',
      triage: 'triage',
      logs: 'logs',
      synthesis: 'synthesis'
    }
  }
];

export const ParameterStudio: React.FC = () => {
  const [profiles] = useState<ProfileConfig[]>(DEFAULT_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('balanced-investigation');
  const [stages, setStages] = useState<Record<string, StageConfig>>(DEFAULT_STAGES);
  const [selectedStageKey, setSelectedStageKey] = useState<string>('synthesis');
  const [saved, setSaved] = useState(false);

  const activeProfile = profiles.find(p => p.id === selectedProfileId) || profiles[0];
  const activeStage = stages[selectedStageKey] || stages['synthesis'];

  const handleStageChange = <K extends keyof StageConfig>(key: K, value: StageConfig[K]) => {
    setStages(prev => ({
      ...prev,
      [selectedStageKey]: {
        ...prev[selectedStageKey],
        [key]: value
      }
    }));
  };

  const handleResetStage = () => {
    setStages(prev => ({
      ...prev,
      [selectedStageKey]: { ...DEFAULT_STAGES[selectedStageKey] }
    }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  // Estimated tokens per run
  const estimatedInputTokens = 12000;
  const estimatedOutputTokens = Object.values(stages).reduce((acc, s) => acc + (s.max_output_tokens / 2), 0);
  const estimatedCostPerRun = ((estimatedInputTokens / 1_000_000) * 0.15 + (estimatedOutputTokens / 1_000_000) * 0.60).toFixed(4);

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Parameter <span>Studio</span> & Model Profiles
          </h1>
          <p className="hero-lede">
            Fine-tune stage models, Gemini thinking budgets, temperature distributions, token boundaries, and prompt overlays across the investigation pipeline.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Active Profile:</b> {activeProfile.name.split(' (')[0]}
            </span>
            <span className="hero-stat-chip">
              <b>Tool Call Limit:</b> {activeProfile.tool_call_limit} calls
            </span>
            <span className="hero-stat-chip">
              <b>Max Parallel Models:</b> 4 (Semaphore bounded)
            </span>
            <span className="hero-stat-chip">
              <b>Configuration File:</b> blob_local/platform/config/model_profiles.yaml
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? 'Parameters Saved' : 'Save Stage Profiles'}
          </button>
        </div>
      </section>

      {/* Profiles Selection Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
        {profiles.map(p => {
          const isSelected = p.id === selectedProfileId;
          return (
            <div
              key={p.id}
              onClick={() => setSelectedProfileId(p.id)}
              style={{
                padding: '16px',
                borderRadius: '8px',
                cursor: 'pointer',
                border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                background: isSelected ? 'var(--acc-subtle)' : 'var(--card)',
                transition: 'all .15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>{p.name.split(' (')[0]}</span>
                {isSelected && <span style={{ fontSize: '10px', background: 'var(--acc)', color: '#fff', padding: '2px 6px', borderRadius: '10px', fontWeight: 700 }}>ACTIVE</span>}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                {p.description}
              </p>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--muted)' }}>
                <span>Limit: <b>{p.tool_call_limit} tools</b></span>
                <span>•</span>
                <span>Triage: <b>Flash-Lite</b></span>
                <span>•</span>
                <span>Synth: <b>{p.stages.synthesis === 'fast_synthesis' ? 'Flash-Lite' : 'Flash'}</b></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Studio Body: Stages Sidebar + Stage Detail Editor */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left: Stage Navigation */}
        <div className="card" style={{ padding: '16px', height: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <Layers size={14} style={{ color: 'var(--acc)' }} />
            <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, textTransform: 'uppercase', color: 'var(--muted)' }}>
              Investigation Stages
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.keys(stages).map(key => {
              const stage = stages[key];
              const isSelected = selectedStageKey === key;
              return (
                <div
                  key={key}
                  onClick={() => setSelectedStageKey(key)}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--acc-subtle)' : 'var(--bg)',
                    transition: 'all .15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'capitalize' }}>
                      {key.replace('_', ' ')} Stage
                    </span>
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: stage.thinking_level === 'high' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)',
                      color: stage.thinking_level === 'high' ? '#8b5cf6' : '#3b82f6',
                      fontWeight: 700
                    }}>
                      {stage.thinking_level.toUpperCase()} THINKING
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '8px' }}>
                    <span>{stage.model}</span>
                    <span>•</span>
                    <span>Max {stage.max_output_tokens} tok</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Real-Time Cost & Resource Estimator */}
          <div style={{ marginTop: '20px', padding: '12px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <DollarSign size={14} style={{ color: '#10b981' }} />
              <span style={{ fontSize: '12px', fontWeight: 700 }}>Run Economics</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--muted)' }}>Est. Total Tokens:</span>
              <span style={{ fontWeight: 600 }}>~{(estimatedInputTokens + estimatedOutputTokens).toLocaleString()} tokens</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--muted)' }}>Est. Model Cost:</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>${estimatedCostPerRun} / run</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '6px' }}>
              Calculated using standard Gemini API pricing with active model distribution.
            </div>
          </div>
        </div>

        {/* Right: Active Stage Hyperparameter Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Cpu size={18} style={{ color: 'var(--acc)' }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, textTransform: 'capitalize' }}>
                    {selectedStageKey.replace('_', ' ')} Stage Parameters
                  </h2>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                  {activeStage.description}
                </p>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetStage}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                <RotateCcw size={12} /> Reset to Defaults
              </button>
            </div>

            {/* Model & Thinking Level Controls */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Gemini Foundation Model
                </label>
                <select
                  value={activeStage.model}
                  onChange={e => handleStageChange('model', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '13px'
                  }}
                >
                  <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Fastest, High Throughput)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Balanced SRE Reasoning)</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                  Verified Google Gemini API model catalog.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Thinking Level (Gemini Reasoning Budget)
                </label>
                <select
                  value={activeStage.thinking_level}
                  onChange={e => handleStageChange('thinking_level', e.target.value as StageConfig['thinking_level'])}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '13px'
                  }}
                >
                  <option value="minimal">minimal (Direct response, lowest latency)</option>
                  <option value="low">low (Fast sanity verification)</option>
                  <option value="medium">medium (Standard structured reasoning)</option>
                  <option value="high">high (Exhaustive cross-evidence deduction)</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                  Controls depth of thinking tokens generated prior to final output.
                </span>
              </div>
            </div>

            {/* Sliders: Temperature & Output Tokens */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div style={{ background: 'var(--bg)', padding: '14px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>Sampling Temperature</label>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--acc)' }}>{activeStage.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.0"
                  step="0.1"
                  value={activeStage.temperature}
                  onChange={e => handleStageChange('temperature', parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted)', marginTop: '4px' }}>
                  <span>0.0 (Deterministic)</span>
                  <span>1.0 (Standard)</span>
                  <span>2.0 (Creative)</span>
                </div>
              </div>

              <div style={{ background: 'var(--bg)', padding: '14px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>Max Output Tokens</label>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--acc)' }}>{activeStage.max_output_tokens} tokens</span>
                </div>
                <input
                  type="range"
                  min="1024"
                  max="16384"
                  step="1024"
                  value={activeStage.max_output_tokens}
                  onChange={e => handleStageChange('max_output_tokens', parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted)', marginTop: '4px' }}>
                  <span>1,024 (Brief)</span>
                  <span>8,192 (Default Synth)</span>
                  <span>16,384 (Full Dossier)</span>
                </div>
              </div>
            </div>

            {/* Prompt Overlay Inspector */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileCode size={14} /> Stage Prompt Instruction Template
                </label>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Defined in prompts.yaml</span>
              </div>
              <textarea
                value={activeStage.prompt_preview}
                onChange={e => handleStageChange('prompt_preview', e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
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
          </div>
        </div>
      </div>
    </div>
  );
};
