import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { createProjectAccessRequest, fetchProjectAccessRequests, reviewProjectAccessRequest } from '../services/projectAccess';
import type { ProjectAccessRequest, RequestedProjectRole } from '../services/projectAccess';
import type { Principal } from '../types/api';
import './ProjectAccessDialog.css';

const roles: Record<RequestedProjectRole, string> = { PROJECT_VIEWER: 'Viewer', PROJECT_ANALYST: 'Analyst', PROJECT_MANAGER: 'Manager', PROJECT_OWNER: 'Owner' };
const statusLabel = (status: ProjectAccessRequest['status']) => ({ PENDING: 'Awaiting review', APPROVED: 'Approved', REJECTED: 'Rejected' })[status] || status;
type AccessView = 'request' | 'mine' | 'review';

export function ProjectAccessDialog({ principal, onClose, onAccessChanged }: {
  principal: Principal;
  onClose: () => void;
  onAccessChanged?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const [items, setItems] = useState<ProjectAccessRequest[]>([]);
  const [view, setView] = useState<AccessView>('request');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<RequestedProjectRole>('PROJECT_ANALYST');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<{ item: ProjectAccessRequest; action: 'approve' | 'reject' } | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mine = items.filter(item => item.requester_subject === principal.subject);
  const reviewable = items.filter(item => item.status === 'PENDING' && item.can_review && item.requester_subject !== principal.subject);
  const dirty = Boolean(projectId || reason || reviewReason || role !== 'PROJECT_ANALYST');

  useEffect(() => {
    const element = dialog.current;
    mounted.current = true; element?.showModal();
    return () => { mounted.current = false; element?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void fetchProjectAccessRequests(controller.signal)
      .then(values => { if (!controller.signal.aborted) setItems(values); })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Access requests could not load. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, principal.subject]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);
  const discard = () => { setProjectId(''); setRole('PROJECT_ANALYST'); setReason(''); setReview(null); setReviewReason(''); setError(null); };
  const leave = () => !busy && (!dirty || window.confirm('Discard your unsaved access request or review?'));
  const close = () => { if (leave()) onClose(); };
  const chooseView = (next: AccessView) => { if (view !== next && leave()) { discard(); setNotice(null); setView(next); } };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !projectId.trim() || !reason.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const item = await createProjectAccessRequest(projectId.trim(), role, reason.trim());
      if (!mounted.current) return;
      setItems(previous => [item, ...previous.filter(value => value.id !== item.id)]);
      discard(); setView('mine'); setNotice('Request sent for review. You can use the project after your access is approved.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Your request could not be sent. Your entries are still here.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const decide = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !review || !reviewReason.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const item = await reviewProjectAccessRequest(review.item.id, review.action, review.item.content_hash, reviewReason.trim());
      if (!mounted.current) return;
      setItems(previous => previous.map(value => value.id === item.id ? item : value));
      setReview(null); setReviewReason('');
      setNotice(item.status === 'APPROVED' ? 'Project access approved. The person can now select this project.' : 'Access request rejected. The decision and reason are recorded.');
      if (item.status === 'APPROVED') onAccessChanged?.();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The decision could not be saved. Try again.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const list = view === 'mine' ? mine : reviewable;

  return <dialog ref={dialog} className="project-access-dialog" aria-labelledby="project-access-title" aria-describedby="project-access-description" onCancel={event => { event.preventDefault(); close(); }}>
    <header><div><h2 id="project-access-title">Project access</h2><p id="project-access-description">Ask to join a project and keep track of the decision.</p></div><button type="button" className="project-access-icon" aria-label="Close project access" disabled={busy} onClick={close}><X size={20} aria-hidden="true" /></button></header>
    <nav aria-label="Project access views"><button type="button" aria-pressed={view === 'request'} disabled={busy} onClick={() => chooseView('request')}>Request access</button><button type="button" aria-pressed={view === 'mine'} disabled={busy} onClick={() => chooseView('mine')}>My requests{mine.length ? ` (${mine.length})` : ''}</button><button type="button" aria-pressed={view === 'review'} disabled={busy} onClick={() => chooseView('review')}>Needs my review{reviewable.length ? ` (${reviewable.length})` : ''}</button></nav>
    {error && <p className="project-access-error" role="alert">{error}</p>}
    {notice && <p className="project-access-notice" role="status">{notice}</p>}
    {view === 'request' ? <form onSubmit={submit}><fieldset disabled={busy}><label>Project key<input autoFocus required minLength={1} maxLength={256} value={projectId} onChange={event => setProjectId(event.target.value)} placeholder="customer-experience" aria-describedby="access-project-help" /></label><p id="access-project-help">Ask the project owner for the key shown in the project’s workspace address.</p><label>Access needed<select value={role} onChange={event => setRole(event.target.value as RequestedProjectRole)}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>Choose the access needed for your work. A reviewer will check this request before access is granted.</p><label>Why do you need access?<textarea required rows={4} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain which team you support and what you need to investigate." /></label><footer><button type="button" className="btn btn-secondary" onClick={() => { if (leave()) discard(); }}>Clear form</button><button type="submit" className="btn btn-primary" disabled={!projectId.trim() || !reason.trim()}>{busy ? 'Sending request…' : 'Send access request'}</button></footer></fieldset></form> : <section className="project-access-history" aria-labelledby="project-access-list-title"><header><h3 id="project-access-list-title">{view === 'mine' ? 'Your access requests' : 'Requests you can review'}</h3><button type="button" className="project-access-icon" aria-label="Refresh access requests" disabled={loading || busy} onClick={() => { if (leave()) { discard(); setAttempt(value => value + 1); onAccessChanged?.(); } }}><RefreshCw size={16} aria-hidden="true" /></button></header>
      {loadError ? <div className="project-access-error" role="alert"><p>{loadError}</p><button type="button" className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>Retry requests</button></div> : loading ? <p role="status">Loading access requests…</p> : !list.length ? <p className="project-access-empty">{view === 'mine' ? 'You have not requested project access yet. Use Request access to get started.' : 'No requests in the loaded history need your review.'}</p> : <><p>{items.length >= 200 ? "Showing the most recent 200 requests available to your account." : ""}</p><ul>{list.map(item => <li key={item.id}><div className="project-access-request-heading"><strong>{item.project_id}</strong><span>{statusLabel(item.status)}</span></div><p>{roles[item.requested_role]} access · {new Date(item.created_at * 1000).toLocaleDateString()}</p>{view === 'review' && <p>Requested by <strong>{item.requester_subject}</strong></p>}<p className="project-access-reason">{item.reason}</p>{item.reviewer_subject && <p>Reviewed by {item.reviewer_subject}{item.review_reason ? `: ${item.review_reason}` : ''}</p>}{view === 'review' && !review && <div className="project-access-review-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setReview({ item, action: 'approve' }); setError(null); setNotice(null); }}>Approve access</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setReview({ item, action: 'reject' }); setError(null); setNotice(null); }}>Reject request</button></div>}
        {review?.item.id === item.id && <form onSubmit={decide}><label>Reason for your decision<textarea autoFocus required rows={3} maxLength={2000} value={reviewReason} disabled={busy} onChange={event => setReviewReason(event.target.value)} /></label><footer><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setReview(null); setReviewReason(''); setError(null); }}>Cancel review</button><button type="submit" className="btn btn-primary" disabled={busy || !reviewReason.trim()}>{busy ? 'Saving decision…' : review.action === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</button></footer></form>}
      </li>)}</ul></>}
    </section>}
  </dialog>;
}
