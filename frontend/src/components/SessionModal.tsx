import React, { useState } from 'react';
import { KeyRound, ShieldAlert, X, Check } from 'lucide-react';
import { Principal } from '../types/api';
import { getSessionToken, setSessionToken } from '../services/api';

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  principal: Principal;
  onUpdatePrincipal?: (p: Principal) => void;
  onSessionChanged?: () => void;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  onClose,
  principal,
  onUpdatePrincipal: _onUpdatePrincipal,
  onSessionChanged,
}) => {
  const [tokenInput, setTokenInput] = useState(getSessionToken() || '');
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    setSessionToken(tokenInput);
    onSessionChanged?.();
    setSaved(true);
    setSaved(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Active Authentication Session</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Subject</span>
              <span style={{ fontWeight: 600 }}>{principal.subject}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tenant / Project Scope</span>
              <span style={{ fontWeight: 600 }}>{principal.tenant_id} / {principal.project_id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Assigned Roles</span>
              <span className="badge badge-active">{principal.roles.join(', ')}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              In-Memory Bearer Token (RS256 JWT)
            </label>
            <textarea
              rows={4}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Paste Bearer JWT token (held strictly in-memory, never written to disk or storage)..."
              style={{ width: '100%', padding: '10px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldAlert size={12} />
              Zero client persistence: Token resets on page refresh. Sent via Authorization: Bearer header.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            {saved ? <><Check size={14} /> Saved</> : 'Update Session Token'}
          </button>
        </div>
      </div>
    </div>
  );
};
