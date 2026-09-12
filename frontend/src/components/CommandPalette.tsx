import React, { useState, useEffect } from 'react';
import {
  Search,
  X,
  Bot,
  Wrench,
  ShieldCheck,
  PlayCircle,
  BookOpen,
  Layers,
  Sparkles,
  Sliders,
  FlaskConical,
  HardDrive,
  ShieldAlert,
  KeyRound,
  Zap,
  BellRing,
  HeartPulse,
  FileCog,
  Settings
} from 'lucide-react';
import { ActivePage } from './Sidebar';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: ActivePage) => void;
}

interface CommandItem {
  id: string;
  title: string;
  category: string;
  page: ActivePage;
  icon: React.ReactNode;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => { if (!isOpen) setQuery(''); }, [isOpen]);

  if (!isOpen) return null;

  const items: CommandItem[] = [
    { id: '1', title: 'Agent Fleet & Custom Specialists', category: 'Agents', page: 'agents', icon: <Bot size={15} /> },
    { id: '2', title: 'Jira & Splunk Connectors Health', category: 'Tools', page: 'tools', icon: <Wrench size={15} /> },
    { id: '3', title: 'Skills Catalog & YAML Frontmatter Specs', category: 'Skills', page: 'skills', icon: <Sparkles size={15} /> },
    { id: '4', title: 'Parameter Studio & Gemini Thinking Budgets', category: 'Studio', page: 'parameters', icon: <Sliders size={15} /> },
    { id: '5', title: 'Optimization & MLflow Offline Evaluation Contracts', category: 'Optimization', page: 'optimization', icon: <FlaskConical size={15} /> },
    { id: '6', title: 'Persistence, CAS Upload Storage & Artifacts', category: 'Storage', page: 'persistence', icon: <HardDrive size={15} /> },
    { id: '7', title: 'Policy, Guardrails & Deterministic PII Redaction', category: 'Security', page: 'policy', icon: <ShieldAlert size={15} /> },
    { id: '8', title: 'Roles, RBAC Hierarchy & Dual-Custody Approval', category: 'Access', page: 'roles', icon: <KeyRound size={15} /> },
    { id: '9', title: 'Runtime Engine, Google ADK Graph & Semaphores', category: 'Runtime', page: 'runtime', icon: <Zap size={15} /> },
    { id: '10', title: 'Dual-Custody Approvals & Audit Trail', category: 'Governance', page: 'governance', icon: <ShieldCheck size={15} /> },
    { id: '11', title: 'Run Active Incident RCA Investigation', category: 'Runs', page: 'runs', icon: <PlayCircle size={15} /> },
    { id: '12', title: 'System Settings, Diagnostics & Connection Tests', category: 'Settings', page: 'settings', icon: <Settings size={15} /> },
    { id: '13', title: 'Runbook & Postmortem Knowledge Stores', category: 'Knowledge', page: 'knowledge', icon: <BookOpen size={15} /> },
    { id: '14', title: 'Platform Health Overview & MTTR KPIs', category: 'Overview', page: 'overview', icon: <Layers size={15} /> },
    { id: '15', title: 'Project Setup Snapshot', category: 'Configuration', page: 'project-setup', icon: <FileCog size={15} /> },
    { id: '16', title: 'Connector Health Checks', category: 'Operations', page: 'health-checks', icon: <HeartPulse size={15} /> },
    { id: '18', title: 'Harness Library & Project Selection', category: 'Configuration', page: 'harness-library', icon: <Layers size={15} /> },
    { id: '19', title: 'Users & Access', category: 'Access', page: 'users', icon: <KeyRound size={15} /> },
    { id: '20', title: 'Token Usage & Cost', category: 'Usage', page: 'billing', icon: <Sliders size={15} /> },
    { id: '17', title: 'Operational Alerts & Notices', category: 'Operations', page: 'alerts', icon: <BellRing size={15} /> },
  ];

  const filtered = items.filter(i =>
    i.title.toLowerCase().includes(query.toLowerCase()) ||
    i.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search workspace" className="modal-dialog" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
          <Search size={18} style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            aria-label="Search pages"
            placeholder="Type a command or jump to page..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '14px', color: 'var(--text)', outline: 'none' }}
          />
          <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '380px', overflowY: 'auto', marginTop: '12px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
              No navigation commands found for "{query}"
            </div>
          ) : (
            filtered.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onNavigate(item.page);
                  onClose();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background .15s ease'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--acc-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ color: 'var(--acc)' }}>{item.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{item.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{item.category}</div>
                </div>
                <span style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--bg)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                  Jump
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
