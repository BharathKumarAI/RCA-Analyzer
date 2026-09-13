import React from 'react';
import { X, ShieldCheck, AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import type { StudioDiagnostic } from '../harnessApi';

interface ValidationPanelProps {
  diagnostics: StudioDiagnostic[];
  onClose: () => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  diagnostics,
  onClose,
}) => {
  return (
    <div className="hs-validation-drawer">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--acc)' }} />
          <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Backend validation</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Findings List */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
          Server diagnostics ({diagnostics.length})
        </div>

        {diagnostics.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#10b981', fontSize: 12 }}>
            <CheckCircle2 size={32} style={{ margin: '0 auto 8px', display: 'block' }} />
            The server validated this workspace without diagnostics.
          </div>
        ) : (
          diagnostics.map((diagnostic, idx) => (
            <div key={`${diagnostic.path || 'workspace'}:${idx}`} className={`hs-finding-item ${diagnostic.severity}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                  {diagnostic.severity === 'error' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
                  {diagnostic.severity === 'warning' && <AlertTriangle size={13} style={{ color: '#f59e0b' }} />}
                  {diagnostic.severity === 'info' && <Info size={13} style={{ color: '#38bdf8' }} />}
                  <span>{diagnostic.path || 'Workspace'}</span>
                </span>
              </div>
              <div>{diagnostic.message}</div>
              {(diagnostic.line || diagnostic.column) && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>Location: {diagnostic.line || '?'}:{diagnostic.column || '?'}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
