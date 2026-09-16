import { useEffect, useRef, useState } from 'react';
import { changeProjectLifecycle, fetchManagedProjects, type ManagedProject, type ProjectLifecycleAction } from '../services/projects';
import './project-workspace.css';

const labels: Record<ProjectLifecycleAction, string> = { deactivate: 'Deactivate', activate: 'Activate', archive: 'Archive', restore: 'Restore' };
const consequences: Record<ProjectLifecycleAction, string> = {
  deactivate: 'New investigations and project requests will be blocked. Investigations already running may finish using their saved configuration. Records remain retained.',
  activate: 'Members with active access can open the project and start investigations again. Saved settings and source authorization still apply.',
  archive: 'The inactive project stays out of the project switcher. Its records and settings remain retained under the normal retention policy.',
  restore: 'Restore this project to inactive status. Review its saved settings and activate it separately before investigations resume.',
};

export function ProjectLifecycle({ standalone = false, onClose, onChanged, onOpenProject }: {
  standalone?: boolean; onClose: () => void; onChanged: (project: ManagedProject) => Promise<void>; onOpenProject: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<ManagedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<{ project: ManagedProject; action: ProjectLifecycleAction } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { const element = dialog.current; if (!standalone) element?.showModal(); return () => element?.close(); }, [standalone]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void fetchManagedProjects(controller.signal).then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Projects could not load.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const close = () => { if (!busy && (!reason || window.confirm('Discard your unsaved lifecycle change?'))) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !choice || !reason.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await changeProjectLifecycle(choice.project, choice.action, reason.trim());
      setItems(previous => previous.map(item => item.project_id === updated.project_id ? updated : item));
      setChoice(null); setReason(''); setNotice(`${updated.name} is now ${updated.status}.`);
      await onChanged(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The change could not be saved. Your reason is preserved.'); }
    finally { setBusy(false); }
  };
  const content = <>
    <header><div><h2 id="project-lifecycle-title">Manage projects</h2><p>Only projects where you have an active owner or administrator membership appear here.</p></div>{!standalone && <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>Close</button>}</header>
    {standalone && <p>No active workspace is selected. Activate a retained project to resume investigations.</p>}
    {error && <p className="project-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={() => { setChoice(null); setReason(''); setAttempt(value => value + 1); }}>Refresh projects</button>
    {loading ? <p role="status">Loading project states…</p> : items.length ? <div style={{ overflowX: 'auto' }}><table><caption>Saved project lifecycle</caption><thead><tr><th scope="col">Project</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead><tbody>{items.map(project => <tr key={project.project_id}><th scope="row">{project.name}<small style={{ display: 'block' }}>{project.project_id}</small></th><td>{project.status}</td><td>{project.status === 'active' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onOpenProject(project.project_id)}>Open</button>}{project.actions.map(action => <button key={action} type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setChoice({ project, action }); setReason(''); setNotice(null); }}>{labels[action]}</button>)}</td></tr>)}</tbody></table></div> : <p>You do not currently manage any projects.</p>}
    {choice && <form onSubmit={submit}><fieldset disabled={busy}><legend>{labels[choice.action]} {choice.project.name}</legend><p>{consequences[choice.action]}</p><label>Reason<textarea required maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label><footer><button type="button" className="btn btn-secondary" onClick={() => { setChoice(null); setReason(''); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!reason.trim()}>{busy ? 'Saving…' : `${labels[choice.action]} project`}</button></footer></fieldset></form>}
  </>;
  return standalone ? <section className="project-lifecycle" aria-labelledby="project-lifecycle-title">{content}</section> : <dialog ref={dialog} className="new-project-dialog project-lifecycle" aria-labelledby="project-lifecycle-title" onCancel={event => { event.preventDefault(); close(); }}>{content}</dialog>;
}
