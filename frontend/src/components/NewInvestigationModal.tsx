import React, { useState } from 'react';
import { PlayCircle, X, Sparkles, AlertCircle, Paperclip, FileText } from 'lucide-react';
import { triggerRun } from '../services/api';
import { Run } from '../types/api';

interface NewInvestigationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunCreated: (run: Run) => void;
}

export const NewInvestigationModal: React.FC<NewInvestigationModalProps> = ({
  isOpen,
  onClose,
  onRunCreated,
}) => {
  const [capability, setCapability] = useState('full_incident_rca');
  const [incidentId, setIncidentId] = useState('INC-9045');
  const [prompt, setPrompt] = useState('Analyze anomalous spike in 504 Gateway Timeouts in payment-gateway');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const run = await triggerRun(capability, prompt, incidentId);
      onRunCreated(run);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: '2px' }}>New Run Trigger</div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-.02em' }}>Launch RCA Investigation</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.12)', color: 'var(--acc-rose)', border: '1px solid rgba(244, 63, 94, 0.3)', fontSize: '12px', display: 'flex', gap: '8px' }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Workflow Capability
            </label>
            <select
              value={capability}
              onChange={e => setCapability(e.target.value)}
              style={{ width: '100%', padding: '10px 12px' }}
            >
              <option value="full_incident_rca">full_incident_rca (Jira + Splunk + OCR Summarizer + RCA Join)</option>
              <option value="splunk_telemetry_triage">splunk_telemetry_triage (Log mining & spike correlator)</option>
              <option value="jira_incident_triage">jira_incident_triage (Priority & lineage analysis)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Incident Reference Key
            </label>
            <input
              type="text"
              value={incidentId}
              onChange={e => setIncidentId(e.target.value)}
              placeholder="e.g. INC-9042 or JIRA-1284"
              style={{ width: '100%', padding: '10px 12px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Investigation Directive & Symptoms
            </label>
            <textarea
              rows={4}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe symptoms, affected services, error codes, and timeframe..."
              style={{ width: '100%', padding: '12px', lineHeight: 1.5 }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Incident Attachments (Local Logs / Postmortem PDFs)
            </label>
            <div
              style={{
                border: '1px dashed var(--line-strong)',
                borderRadius: '10px',
                padding: '16px',
                textAlign: 'center',
                background: 'var(--card-subtle)',
                position: 'relative',
              }}
            >
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer',
                }}
              />
              <Paperclip size={18} color="var(--acc)" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '12.5px', fontWeight: 600 }}>Click or drop incident logs / PDFs here</div>
              <div style={{ fontSize: '11px', color: 'var(--dim)', marginTop: '2px' }}>Bounded multi-threaded local OCR extraction (max 50MB)</div>
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.map(f => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--tx)', fontFamily: 'var(--font-mono)' }}>
                    <FileText size={12} color="var(--acc3)" />
                    <span>{f.name}</span>
                    <span style={{ color: 'var(--dim)' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <Sparkles size={14} />
              {loading ? 'Dispatching...' : 'Dispatch Investigation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
