import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  RotateCw,
  Share2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Cpu,
  Database,
  ArrowRight,
  GitBranch,
  ShieldCheck,
  Zap,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { fetchLiveBoard, fetchTicketRca } from '../services/triage';
import type { RcaMethodologyData, LiveBoardResponse } from '../types/triage';

export const RCAWorkbench: React.FC = () => {
  const [ticketsList, setTicketsList] = useState<{ id: string; summary: string }[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [activeMethod, setActiveMethod] = useState<'five_whys' | 'fishbone' | 'kepner_tregoe' | 'fmea' | 'fault_tree' | 'auto_ensemble'>('five_whys');
  const [rcaData, setRcaData] = useState<RcaMethodologyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available tickets for dropdown
  useEffect(() => {
    fetchLiveBoard()
      .then((res) => {
        const items = res.focus_queue.map((item) => ({
          id: item.ticket.ticket_id,
          summary: item.ticket.summary,
        }));
        setTicketsList(items);
        if (items.length > 0) {
          setSelectedTicketId((prev) => (prev && items.some((i) => i.id === prev) ? prev : items[0].id));
        } else {
          setSelectedTicketId('');
          setRcaData(null);
        }
      })
      .catch((err) => {
        console.error('Failed to load tickets list', err);
        setError(err instanceof Error ? err.message : 'Failed to load tickets list');
      });
  }, []);

  const loadRca = useCallback(async (ticketId: string) => {
    if (!ticketId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTicketRca(ticketId);
      setRcaData(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load RCA investigation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTicketId) {
      loadRca(selectedTicketId);
    }
  }, [selectedTicketId, loadRca]);

  const handleExportReport = () => {
    if (!rcaData) return;
    const jsonStr = JSON.stringify(rcaData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rca_report_${selectedTicketId}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
              background: 'linear-gradient(135deg, var(--accent-indigo), var(--accent-rose))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(99, 102, 241, 0.25)',
            }}
          >
            <Sparkles size={24} />
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
                SRE INVESTIGATION ENGINE
              </span>
              <span className="badge badge-magenta">Multi-Methodology</span>
              <span className="badge badge-teal">Google ADK Grounded</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              Root Cause Analysis Workbench
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Deductive reasoning and multi-methodology causal isolation powered by ADK root workflow and live telemetry.
            </p>
          </div>
        </div>

        {/* Ticket Selector & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
              Incident:
            </label>
            <select
              value={selectedTicketId}
              onChange={(e) => setSelectedTicketId(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--ink-primary)',
                fontSize: '12.5px',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                outline: 'none',
              }}
            >
              {ticketsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} — {t.summary.slice(0, 36)}...
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadRca(selectedTicketId)}
            disabled={loading}
            className="btn btn-primary"
            style={{ padding: '6px 14px', fontSize: '12px', gap: '6px' }}
          >
            <RotateCw size={13} className={loading ? 'spin' : ''} />
            <span>Re-analyze</span>
          </button>

          <button
            onClick={handleExportReport}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
          >
            <Download size={13} />
            <span>Export Report</span>
          </button>
        </div>
      </div>

      {/* Methodology Switcher Tabs */}
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
          { id: 'five_whys', label: '5 Whys Causal Chain' },
          { id: 'fishbone', label: 'Ishikawa / Fishbone Diagram' },
          { id: 'kepner_tregoe', label: 'Kepner-Tregoe IS / IS-NOT' },
          { id: 'fmea', label: 'FMEA Risk Modes' },
          { id: 'fault_tree', label: 'Boolean Fault Tree (FTA)' },
          { id: 'auto_ensemble', label: 'Auto-Ensemble Synthesis' },
        ].map((m) => {
          const isSelected = activeMethod === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setActiveMethod(m.id as any)}
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
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Main Analysis View */}
      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
          <RotateCw className="spin" size={24} style={{ margin: '0 auto 12px auto', display: 'block' }} />
          <p>Running multi-methodology RCA causal deduction...</p>
        </div>
      ) : error ? (
        <div className="notice-banner" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : !selectedTicketId ? (
        <div
          className="platform-card"
          style={{
            padding: '60px 24px',
            textAlign: 'center',
            color: 'var(--ink-secondary)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
          }}
        >
          <Sparkles size={32} style={{ margin: '0 auto 12px auto', opacity: 0.6, color: 'var(--ink-tertiary)' }} />
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink-primary)', margin: '0 0 6px 0' }}>
            No Incident Tickets Available
          </h2>
          <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto', lineHeight: 1.5 }}>
            No incident tickets were found in this project's triage queue. Pick or create an incident to run multi-methodology causal deduction.
          </p>
        </div>
      ) : !rcaData ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
          No RCA data available for this incident.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Methodology Visualizer */}
          {activeMethod === 'five_whys' && rcaData.five_whys && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                className="platform-card"
                style={{
                  padding: '16px 20px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>
                  ISOLATED ROOT CAUSE (LEVEL 5)
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-rose)', marginTop: '4px' }}>
                  {rcaData.five_whys.root_cause_summary}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {rcaData.five_whys.steps.map((step) => (
                  <div
                    key={step.level}
                    className="platform-card"
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      borderLeft: step.level === 5 ? '4px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                      display: 'flex',
                      gap: '14px',
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: step.level === 5 ? 'var(--accent-rose)' : 'var(--bg-elevated)',
                        color: step.level === 5 ? '#fff' : 'var(--ink-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '12px',
                        flexShrink: 0,
                      }}
                    >
                      {step.level}
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-tertiary)' }}>
                        {step.question}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                        {step.answer}
                      </div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--accent-teal)',
                          background: 'rgba(16, 185, 129, 0.08)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          marginTop: '4px',
                          display: 'inline-block',
                          alignSelf: 'flex-start',
                        }}
                      >
                        Evidence: {step.evidence}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeMethod === 'fishbone' && rcaData.fishbone && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {rcaData.fishbone.categories.map((cat, idx) => (
                <div
                  key={idx}
                  className="platform-card"
                  style={{
                    padding: '18px',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                      {cat.name}
                    </span>
                    <span className="badge badge-teal">
                      {Math.round(cat.confidence * 100)}% Confidence
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {cat.factors.map((factor, fIdx) => (
                      <div
                        key={fIdx}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          background: 'var(--bg-elevated)',
                          fontSize: '12px',
                          color: 'var(--ink-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {factor}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeMethod === 'kepner_tregoe' && rcaData.kepner_tregoe && (
            <div className="platform-card" style={{ padding: '0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', width: '90px' }}>Dimension</th>
                    <th style={{ padding: '12px 16px' }}>IS (Observed Fact)</th>
                    <th style={{ padding: '12px 16px' }}>IS NOT (Not Observed)</th>
                    <th style={{ padding: '12px 16px' }}>Distinction</th>
                    <th style={{ padding: '12px 16px' }}>Probable Cause</th>
                  </tr>
                </thead>
                <tbody>
                  {rcaData.kepner_tregoe.dimensions.map((dim, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--accent-rose)' }}>{dim.dimension}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-primary)' }}>{dim.is_fact}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-tertiary)' }}>{dim.is_not_fact}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-secondary)' }}>{dim.distinction}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--accent-teal)' }}>{dim.probable_cause}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeMethod === 'fmea' && rcaData.fmea && (
            <div className="platform-card" style={{ padding: '0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px' }}>Failure Mode</th>
                    <th style={{ padding: '12px 16px' }}>Effect</th>
                    <th style={{ padding: '12px 16px', width: '50px' }}>S</th>
                    <th style={{ padding: '12px 16px', width: '50px' }}>O</th>
                    <th style={{ padding: '12px 16px', width: '50px' }}>D</th>
                    <th style={{ padding: '12px 16px', width: '70px' }}>RPN</th>
                    <th style={{ padding: '12px 16px' }}>Recommended Mitigation</th>
                  </tr>
                </thead>
                <tbody>
                  {rcaData.fmea.modes.map((mode, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--ink-primary)' }}>{mode.failure_mode}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-secondary)' }}>{mode.effect}</td>
                      <td style={{ padding: '12px 16px' }}>{mode.severity}</td>
                      <td style={{ padding: '12px 16px' }}>{mode.occurrence}</td>
                      <td style={{ padding: '12px 16px' }}>{mode.detection}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: mode.rpn >= 200 ? 'var(--accent-rose)' : 'var(--accent-amber)' }}>
                        {mode.rpn}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--accent-teal)' }}>{mode.recommended_mitigation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeMethod === 'fault_tree' && rcaData.fault_tree && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                className="platform-card"
                style={{
                  padding: '16px 20px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent-teal)' }}>
                  BOOLEAN FAULT TREE DEDUCTION
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink-primary)', marginTop: '4px' }}>
                  {rcaData.fault_tree.conclusion}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-secondary)' }}>Active Cut Set:</span>
                  {rcaData.fault_tree.active_cut_set.map((cut, cIdx) => (
                    <span key={cIdx} className="badge badge-rose" style={{ fontSize: '10.5px' }}>
                      {cut}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                {rcaData.fault_tree.root_gate.children?.map((branch, bIdx) => (
                  <div
                    key={bIdx}
                    className="platform-card"
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: branch.status === 'VERIFIED_TRUE' ? '2px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                        {branch.event}
                      </span>
                      <span className={`badge ${branch.status === 'VERIFIED_TRUE' ? 'badge-rose' : 'badge-neutral'}`}>
                        {branch.operator} GATE • {branch.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {branch.children?.map((leaf, lIdx) => (
                        <div
                          key={lIdx}
                          style={{
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: leaf.status === 'VERIFIED_TRUE' ? 'rgba(244, 63, 94, 0.08)' : 'var(--bg-elevated)',
                            fontSize: '12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>{leaf.event}</div>
                            <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: '2px' }}>
                              Evidence: {leaf.evidence}
                            </div>
                          </div>
                          <span className="badge badge-teal" style={{ fontSize: '10px' }}>
                            P = {leaf.probability}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeMethod === 'auto_ensemble' && rcaData.auto_ensemble && (
            <div
              className="platform-card"
              style={{
                padding: '24px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(244, 63, 94, 0.1))',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <span className="badge badge-teal" style={{ alignSelf: 'flex-start' }}>
                COMPOSITE SRE SYNTHESIS REPORT
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--ink-primary)', margin: 0 }}>
                {rcaData.auto_ensemble.incident_title}
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="platform-card" style={{ padding: '16px', background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)' }}>
                    ISOLATED ROOT CAUSE (5 WHYS)
                  </div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink-primary)', marginTop: '6px' }}>
                    {rcaData.auto_ensemble.executive_summary.isolated_root_cause}
                  </div>
                </div>

                <div className="platform-card" style={{ padding: '16px', background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)' }}>
                    ENVIRONMENTAL DELTA (KEPNER-TREGOE)
                  </div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink-primary)', marginTop: '6px' }}>
                    {rcaData.auto_ensemble.executive_summary.environmental_delta}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                  <strong>Highest Risk Mitigation:</strong> {rcaData.auto_ensemble.executive_summary.critical_mitigation}
                </div>
                <span className="badge badge-rose" style={{ fontSize: '12px', fontWeight: 800 }}>
                  Max RPN: {rcaData.auto_ensemble.executive_summary.max_rpn}
                </span>
              </div>
            </div>
          )}

          {/* Context Budget Guardrail Simulator Card */}
          {rcaData.context_budget && (
            <div
              className="platform-card"
              style={{
                padding: '16px 20px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                  ADK Context Budget Guardrail (128k Token Window)
                </span>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--accent-teal)' }}>
                  {rcaData.context_budget.current_prompt_tokens.toLocaleString()} / {rcaData.context_budget.max_budget_tokens.toLocaleString()} Tokens ({rcaData.context_budget.budget_utilization_pct}%)
                </span>
              </div>

              <div style={{ width: '100%', height: '6px', background: 'var(--bg-input)', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${rcaData.context_budget.budget_utilization_pct}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--accent-teal), var(--accent-indigo))',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
