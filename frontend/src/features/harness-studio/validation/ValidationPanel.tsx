import React from 'react';
import { X, ShieldCheck, AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { HarnessHealthScore } from '../types/harness';
import { ValidationFinding } from './validationEngine';

interface ValidationPanelProps {
  healthScore: HarnessHealthScore;
  findings: ValidationFinding[];
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  healthScore,
  findings,
  onSelectNode,
  onClose,
}) => {
  const getScoreColor = (score: number) => {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="hs-validation-drawer">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--acc)' }} />
          <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>4-Tier Harness Health & Validation</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Overall Health Score Card */}
      <div className="hs-health-bar">
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Harness Health Score
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            4-Tier Enterprise Topology Verification
          </div>
        </div>
        <div className="hs-health-score" style={{ color: getScoreColor(healthScore.overall) }}>
          {healthScore.overall} <span style={{ fontSize: 14, color: 'var(--muted)' }}>/ 100</span>
        </div>
      </div>

      {/* Category Pillars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 16 }}>
        <div style={{ padding: '8px', background: 'var(--surface-secondary)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Architecture</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{healthScore.architecture}</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface-secondary)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Governance</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{healthScore.governance}</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface-secondary)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Reliability</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{healthScore.reliability}</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface-secondary)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Evaluation</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{healthScore.evaluation}</div>
        </div>
      </div>

      {/* Findings List */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
          Validation Findings ({findings.length})
        </div>

        {findings.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#10b981', fontSize: 12 }}>
            <CheckCircle2 size={32} style={{ margin: '0 auto 8px', display: 'block' }} />
            All 4 tiers passed cleanly with zero structural or governance issues!
          </div>
        ) : (
          findings.map((f, idx) => (
            <div key={idx} className={`hs-finding-item ${f.severity}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                  {f.severity === 'error' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
                  {f.severity === 'warning' && <AlertTriangle size={13} style={{ color: '#f59e0b' }} />}
                  {f.severity === 'info' && <Info size={13} style={{ color: '#38bdf8' }} />}
                  <span>{f.tierName} Tier</span>
                </span>
                {f.nodeId && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 9, padding: '1px 5px' }}
                    onClick={() => onSelectNode(f.nodeId!)}
                  >
                    View Node
                  </button>
                )}
              </div>
              <div>{f.message}</div>
              {f.remediation && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
                  Remediation: {f.remediation}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
