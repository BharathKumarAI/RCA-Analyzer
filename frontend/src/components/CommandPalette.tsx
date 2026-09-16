import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { ActivePage, PAGE_ICONS, isActivePage } from './Sidebar';
import type { UiSettingsConfig } from '../types/api';

interface CommandPaletteProps {
  settings: UiSettingsConfig;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: ActivePage) => void;
}

interface CommandItem {
  id: string;
  title: string;
  category: string;
  description: string;
  page: ActivePage;
  icon: React.ReactNode;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  settings,
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

  const items: CommandItem[] = settings.navigation.flatMap(item => {
    if (!item.visible || !isActivePage(item.page)) return [];
    const Icon = PAGE_ICONS[item.page];
    return [{ id: item.page, title: item.label, category: item.group, description: item.description, page: item.page, icon: <Icon size={15} /> }];
  });

  const filtered = items.filter(i =>
    i.title.toLowerCase().includes(query.toLowerCase()) ||
    i.category.toLowerCase().includes(query.toLowerCase()) ||
    i.description.toLowerCase().includes(query.toLowerCase()) ||
    i.page.includes(query.toLowerCase())
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
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{item.description || item.category}</div>
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
