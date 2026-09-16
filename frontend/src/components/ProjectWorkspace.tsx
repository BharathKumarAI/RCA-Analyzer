import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Search, Users, X, Shield } from 'lucide-react';
import { fetchConfig } from '../services/api';
import type { RuntimeConfig } from '../types/api';
import type { CreateProjectInput, ProjectDirectory } from '../services/projects';
import './project-workspace.css';

export function ProjectSwitcher({
  directory,
  currentProject,
  loading,
  onSelect,
  onCreate,
  onAccess,
  onOpenWorkspace,
  canAdmin,
  onOpenAdmin,
  isAdminConsole,
}: {
  directory: ProjectDirectory | null;
  currentProject: string;
  loading: boolean;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onAccess: () => void;
  onOpenWorkspace?: () => void;
  canAdmin?: boolean;
  onOpenAdmin?: () => void;
  isAdminConsole?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const projects = directory?.items || [];
  const activeProject = projects.find(item => item.project_id === currentProject);
  const projectKey = activeProject?.project_id || currentProject || 'PRJ';
  const projectName = activeProject?.name || currentProject || 'Project';
  const projectInitials = projectKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'PR';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredProjects = projects.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.project_id.toLowerCase().includes(q);
  });

  return (
    <div className="project-switcher-container" ref={containerRef}>
      {/* Project Scope Trigger Pill (Filter 1) */}
      <button
        ref={triggerRef}
        type="button"
        className={`project-segmented-pill project-scope-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(open => !open)}
        disabled={loading || !directory}
        title={`Active project: ${projectName} (${projectKey}). Click to switch project or scope.`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <div className="project-tag-segment">
          <div className="project-avatar-box">
            {projectInitials}
          </div>
          <span className="project-key-text">{projectKey}</span>
          <ChevronDown size={11} className={`project-chevron ${isOpen ? 'rotated' : ''}`} aria-hidden="true" />
        </div>
      </button>

      {/* Expanded Project Details & Switcher Popover (RCA Assist Reference) */}
      {isOpen && (
        <div className="project-details-popover" role="dialog" aria-label="Project Details & Switcher">
          {/* Header */}
          <div className="project-popover-header">
            <div className="project-popover-brand">
              <div className="project-avatar-box large">
                {projectInitials}
              </div>
              <div className="project-popover-meta">
                <div className="project-popover-title">{projectName}</div>
                <div className="project-popover-desc">
                  {activeProject?.description || 'Monitored project workspace and investigation telemetry'}
                </div>
              </div>
            </div>
            <span className="badge badge-teal">{activeProject?.status ? `${activeProject.status} Scope` : 'Active'}</span>
          </div>

          {/* Scope Metadata Specs (2x2 Grid) */}
          <div className="project-meta-grid">
            <div className="project-meta-item">
              <span className="project-meta-label">Active Scope:</span>
              <div className="project-meta-val mono">{projectKey}</div>
            </div>
            <div className="project-meta-item">
              <span className="project-meta-label">Workspace Status:</span>
              <div className="project-meta-val status-active">
                {activeProject?.status || 'Active Workspace'}
              </div>
            </div>
            <div className="project-meta-item">
              <span className="project-meta-label">Assigned Role:</span>
              <div className="project-meta-val">
                {activeProject?.roles?.length ? activeProject.roles.join(', ') : 'Member'}
              </div>
            </div>
            <div className="project-meta-item">
              <span className="project-meta-label">Last Activity:</span>
              <div className="project-meta-val">
                {activeProject?.last_accessed_at ? new Date(activeProject.last_accessed_at).toLocaleDateString() : 'Current Session'}
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="project-actions-row">
            {canAdmin && onOpenAdmin && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAdmin();
                }}
                className="btn btn-secondary project-action-btn project-admin-btn"
                title="Switch to Platform Administration Console (All Projects)"
              >
                <Shield size={13} aria-hidden="true" />
                <span>Admin Console</span>
              </button>
            )}
            {onOpenWorkspace && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenWorkspace();
                }}
                className="btn btn-secondary project-action-btn"
                title="Jump to project chat workspace"
              >
                <span>Workspace Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onAccess();
              }}
              className="btn btn-secondary project-action-btn"
              title="Manage project members and access requests"
            >
              <Users size={13} aria-hidden="true" />
              <span>Access & Roles</span>
            </button>
            {directory?.can_create && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onCreate();
                }}
                className="btn btn-primary project-action-btn"
                title="Create a new project workspace"
              >
                <Plus size={13} aria-hidden="true" />
                <span>New Project</span>
              </button>
            )}
          </div>

          {/* Searchable Project Switcher List */}
          <div className="project-roster-section">
            {canAdmin && onOpenAdmin && (
              <div className="project-admin-shortcut-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenAdmin();
                  }}
                  className="project-admin-shortcut-btn"
                  title="Switch to Platform Admin Console (Collated fleet management)"
                >
                  <div className="project-item-left">
                    <Shield size={14} className="project-admin-shortcut-icon" aria-hidden="true" />
                    <span className="project-item-name">Admin Console</span>
                  </div>
                  <span className="badge badge-purple">All Projects Fleet</span>
                </button>
              </div>
            )}
            <div className="project-roster-header">
              <span className="project-roster-title">
                Switch Project Roster ({projects.length})
              </span>
            </div>

            <div className="project-roster-search">
              <Search size={12} className="roster-search-icon" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search projects by key or name..."
                className="roster-search-input"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="roster-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <div className="project-roster-list">
              {filteredProjects.map(p => {
                const isCurrent = p.project_id === currentProject;
                return (
                  <button
                    key={p.project_id}
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      setSearchQuery('');
                      if (isAdminConsole || p.project_id !== currentProject) {
                        onSelect(p.project_id);
                      }
                    }}
                    className={`project-roster-item ${isCurrent ? 'active' : ''}`}
                  >
                    <div className="project-item-left">
                      <span className="project-item-name">{p.name}</span>
                      {p.status && p.status.toLowerCase() !== 'active' && (
                        <span className="badge badge-rose">{p.status}</span>
                      )}
                    </div>
                    <span className="project-item-key mono">{p.project_id}</span>
                  </button>
                );
              })}
              {filteredProjects.length === 0 && (
                <div className="project-roster-empty">No projects match "{searchQuery}"</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NewProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: CreateProjectInput, files: File[]) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [files, setFiles] = useState<File[]>([]);
  const [limits, setLimits] = useState<RuntimeConfig['file_limits'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { let disposed = false; fetchConfig().then(config => { if (!disposed) setLimits(config.file_limits); }).catch(() => { /* Project creation remains available without optional uploads. */ }); return () => { disposed = true; }; }, []);
  const close = () => { if (!busy && (!(name || key || description || files.length) || window.confirm('Discard this new project form?'))) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (files.length && (!limits || files.length > limits.max_files || files.some(file => file.size > limits.max_file_bytes || !limits.allowed_extensions.includes('.' + file.name.split('.').pop()?.toLowerCase())))) { setError('Some files exceed the enabled file types, size, or count limit. Remove them before creating the project.'); return; }
    setBusy(true); setError(null);
    try { await onCreate({ project_id: key.trim(), name: name.trim(), description: description.trim(), timezone }, files); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The project could not be created. Your entries are still here.'); setBusy(false); }
  };
  return <dialog ref={dialog} className="new-project-dialog" onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="new-project-title">
    <header><div><h2 id="new-project-title">A workspace for your team</h2><p>Keep this project’s conversations, knowledge, and connected sources together.</p></div><button type="button" onClick={close} disabled={busy} aria-label="Close new project"><X size={20} /></button></header>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Project name<input autoFocus required maxLength={120} value={name} onChange={event => { setName(event.target.value); if (!keyEdited) setKey(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63)); }} placeholder="Customer experience" /></label>
      <label>Project key<input required minLength={2} maxLength={63} pattern="[a-z][a-z0-9_-]+" value={key} onChange={event => { setKeyEdited(true); setKey(event.target.value.toLowerCase()); }} aria-describedby="project-key-help" placeholder="customer-experience" /></label><p id="project-key-help">Used in your workspace address. Start with a letter. Use lowercase letters, numbers, hyphens, and underscores.</p>
      <label>What does this team look after?<textarea maxLength={2000} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Services, responsibilities, and the incidents this team investigates." /></label>
      <label>Team time zone<input required maxLength={64} value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
      <section className="project-initial-knowledge"><h3>Add your team’s references <span>Optional</span></h3><p>Bring runbooks, spreadsheets, documents, or images. Extracted text is saved as project knowledge drafts for independent review.</p><label>Choose project documents<input type="file" multiple disabled={!limits} accept={limits?.allowed_extensions.join(',')} onChange={event => setFiles(Array.from(event.target.files || []))} /></label>{limits ? <p>Up to {limits.max_files} files, {(limits.max_file_bytes / 1024 / 1024).toLocaleString()} MB each. Images contribute text through OCR.</p> : <p>Upload settings are unavailable. You can add documents from Knowledge after creating the project.</p>}{files.length > 0 && <ul>{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" onClick={() => setFiles(items => items.filter((_, i) => index !== i))} aria-label={`Remove ${file.name}`}><X size={14} /></button></li>)}</ul>}</section>
      {error && <p role="alert" className="project-error">{error}</p>}
      <footer><button className="btn btn-secondary" type="button" onClick={close}>Cancel</button><button className="btn btn-primary" type="submit">{busy ? 'Creating workspace and saving references…' : 'Create project'}</button></footer>
    </fieldset></form>
  </dialog>;
}
