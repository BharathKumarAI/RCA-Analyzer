import React from 'react';
import { Check, X, ArrowRight, FileCode } from 'lucide-react';

interface YamlDiffProps {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const YamlDiff: React.FC<YamlDiffProps> = ({
  filePath,
  originalContent,
  modifiedContent,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 780 }} onClick={e => e.stopPropagation()}>
        <div className="modal-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileCode size={20} style={{ color: 'var(--acc)' }} />
            <div>
              <h2 style={{ fontSize: 16 }}>Review YAML Changes</h2>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {filePath}
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '18px 0' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
              Current Buffer
            </div>
            <pre
              style={{
                background: 'var(--surface-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                fontSize: 10.5,
                fontFamily: 'var(--font-mono)',
                maxHeight: 360,
                overflow: 'auto',
                color: 'var(--text)',
                margin: 0,
              }}
            >
              {originalContent}
            </pre>
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#10b981', marginBottom: 6 }}>
              Modified Changes
            </div>
            <pre
              style={{
                background: 'rgba(16, 185, 129, 0.05)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 8,
                padding: 12,
                fontSize: 10.5,
                fontFamily: 'var(--font-mono)',
                maxHeight: 360,
                overflow: 'auto',
                color: 'var(--text)',
                margin: 0,
              }}
            >
              {modifiedContent}
            </pre>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            <Check size={13} />
            Apply Changes to Canvas
          </button>
        </div>
      </div>
    </div>
  );
};
