import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertCircle, Paperclip, FileText } from 'lucide-react';
import { triggerRun, fetchCapabilities, fetchConfig, uploadInvestigationFiles } from '../services/api';
import { Run } from '../types/api';

interface NewInvestigationModalProps {
  isOpen: boolean;
  initialCapability?: string;
  onClose: () => void;
  onRunCreated: (run: Run) => void;
}

export const NewInvestigationModal: React.FC<NewInvestigationModalProps> = ({
  isOpen,
  initialCapability,
  onClose,
  onRunCreated,
}) => {
  const [capability, setCapability] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Array<{ id: string; name?: string; description?: string }>>([]);
  const [fileLimit, setFileLimit] = useState(10);
  const [configLoading, setConfigLoading] = useState(false);
  const [configurationAttempt, setConfigurationAttempt] = useState(0);
  const [maxFileBytes, setMaxFileBytes] = useState<number | null>(null);
  const [maxBatchBytes, setMaxBatchBytes] = useState<number | null>(null);
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);
  const [mode, setMode] = useState<string>('');
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setConfigLoading(true); setCapability(''); setCapabilities([]);
    setError(null); setIncidentId(''); setPrompt(''); setFiles([]);
    Promise.all([fetchCapabilities(), fetchConfig()]).then(([items, config]) => {
      if (!active) return;
      const next = items as unknown as Array<{ id: string; name?: string; description?: string }>;
      setCapabilities(next); setCapability(next.find(item => item.id === initialCapability)?.id || next[0]?.id || '');
      setFileLimit(config?.file_limits?.max_files || 10);
      setMaxFileBytes(config.file_limits.max_file_bytes);
      setMaxBatchBytes(config.execution.max_upload_batch_bytes);
      setAllowedExtensions(config.file_limits.allowed_extensions);
      setMode(config.mode);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load investigation configuration'); })
      .finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [isOpen, configurationAttempt, initialCapability]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      setFiles(selected);
      setError(selected.length > fileLimit ? `Select no more than ${fileLimit} files.` : null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || configLoading) return;
    setLoading(true);
    setError(null);
    try {
      if (!prompt.trim()) throw new Error('Describe the investigation symptoms.');
      if (files.some(file => !allowedExtensions.some(extension => file.name.toLowerCase().endsWith(extension.toLowerCase())))) throw new Error(`Supported file types: ${allowedExtensions.join(', ')}`);
      if (!capability) throw new Error('No enabled capability is available for this project');
      if (files.length > fileLimit) throw new Error(`Select no more than ${fileLimit} files.`);
      if (maxFileBytes && files.some(file => file.size > maxFileBytes)) throw new Error('A selected file exceeds the configured per-file size limit.');
      if (maxBatchBytes && files.reduce((total, file) => total + file.size, 0) > maxBatchBytes) throw new Error('The selected files exceed the configured upload batch size.');
      let attachmentIds: string[] = []; let chatId: string | undefined;
      if (files.length) {
        const uploaded = await uploadInvestigationFiles(files);
        attachmentIds = uploaded.attachments.map(item => item.attachment_id); chatId = uploaded.chat_id;
      }
      const run = await triggerRun(capability, prompt.trim(), incidentId.trim() || undefined, attachmentIds, chatId);
      onRunCreated(run);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!loading) onClose(); }}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="new-investigation-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: '2px' }}>New Run Trigger</div>
            <h2 id="new-investigation-title" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-.02em' }}>Launch RCA Investigation</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close investigation form" onClick={onClose} disabled={loading}>
            <X size={16} />
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.12)', color: 'var(--acc-rose)', border: '1px solid rgba(244, 63, 94, 0.3)', fontSize: '12px', display: 'flex', gap: '8px' }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        {error && !capability && <button type="button" className="btn btn-secondary" onClick={() => setConfigurationAttempt(value => value + 1)}>Retry configuration</button>}
        {mode === 'demo' && <p className="badge badge-pending">Demo mode · this run will be simulated</p>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Workflow Capability
            </label>
            <select
              aria-label="Workflow capability"
              disabled={loading || configLoading}
              value={capability}
              onChange={e => setCapability(e.target.value)}
              style={{ width: '100%', padding: '10px 12px' }}
            >
              {capabilities.length === 0 && <option value="">No capabilities available</option>}
              {capabilities.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 650, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
              Incident Reference Key
            </label>
            <input
              aria-label="Incident reference key"
              maxLength={64}
              disabled={loading}
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
              aria-label="Investigation directive and symptoms"
              maxLength={16000}
              disabled={loading}
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
                aria-label="Incident attachments"
                accept={allowedExtensions.join(',')}
                disabled={loading || configLoading}
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
              <div style={{ fontSize: '11px', color: 'var(--dim)', marginTop: '2px' }}>Local bounded parsing · max {fileLimit} files{maxFileBytes ? ` · ${(maxFileBytes / 1048576).toFixed(0)} MB per file` : ''}</div>
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.map((f, index) => (
                  <div key={`${f.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--tx)', fontFamily: 'var(--font-mono)' }}>
                    <FileText size={12} color="var(--acc3)" />
                    <span>{f.name}</span>
                    <span style={{ color: 'var(--dim)' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                    <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} disabled={loading} onClick={() => { setFiles(current => current.filter((_, itemIndex) => itemIndex !== index)); setError(null); }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || configLoading || !capability || !prompt.trim() || files.length > fileLimit}>
              <Sparkles size={14} />
              {loading ? 'Dispatching...' : 'Dispatch Investigation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
