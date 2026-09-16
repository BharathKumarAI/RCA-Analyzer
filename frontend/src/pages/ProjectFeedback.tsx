import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { fetchCalibrationFeedback, submitCalibrationFeedback, fetchLiveBoard } from '../services/triage';
import { getSessionGeneration } from '../services/api';
import type { CalibrationFeedback } from '../types/triage';
import '../styles/knowledge.css';

const AVAILABLE_TAGS = ['Query precision', 'Root cause depth', 'Hypothesis accuracy', 'Failure boundary', 'Tool selection', 'Execution latency'];

export const ProjectFeedback: React.FC<{ canEdit?: boolean }> = ({ canEdit = false }) => {
  const [feedbacks, setFeedbacks] = useState<CalibrationFeedback[]>([]);
  const [tickets, setTickets] = useState<string[]>([]);
  const [ticket, setTicket] = useState('');
  const [rating, setRating] = useState<'UP' | 'DOWN' | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const version = useRef(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const request = ++version.current;
    const generation = getSessionGeneration();
    setLoading(true); setError('');
    try {
      const [list, board] = await Promise.all([fetchCalibrationFeedback(), fetchLiveBoard()]);
      if (request !== version.current || generation !== getSessionGeneration()) return;
      const keys = board.focus_queue.map(item => item.ticket.ticket_id);
      setFeedbacks(list); setTickets(keys);
      setTicket(current => keys.includes(current) ? current : '');
    } catch (cause) {
      if (request === version.current && generation === getSessionGeneration()) setError(cause instanceof Error ? cause.message : 'Feedback could not load. Refresh to try again.');
    } finally {
      if (request === version.current && generation === getSessionGeneration()) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useEffect(() => {
    if (!comment && !busy) return;
    const guard = (event: Event) => { event.preventDefault(); setError(busy ? 'Wait for feedback to finish saving.' : 'Save or clear your feedback before leaving.'); };
    const close = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('rca:before-navigation', guard);
    window.addEventListener('beforeunload', close);
    return () => { window.removeEventListener('rca:before-navigation', guard); window.removeEventListener('beforeunload', close); };
  }, [comment, busy]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit || submitting.current || !tickets.includes(ticket) || !rating || !comment.trim()) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    const generation = getSessionGeneration();
    const request = version.current;
    try {
      const saved = await submitCalibrationFeedback(ticket, rating, tags, comment.trim());
      if (generation !== getSessionGeneration() || request !== version.current) return;
      setFeedbacks(previous => [saved, ...previous].slice(0, 50));
      setComment(''); setRating(''); setTags([]);
      setNotice('Feedback saved. An owner can review it for an evaluation dataset before testing a prompt or skill change.');
    } catch (cause) {
      if (generation === getSessionGeneration() && request === version.current) setError(cause instanceof Error ? cause.message : 'Feedback could not be saved. Your text is preserved. Refresh the history before retrying if the response was interrupted.');
    } finally {
      submitting.current = false;
      if (generation === getSessionGeneration() && request === version.current) setBusy(false);
    }
  };

  return <div className="view-container knowledge-page">
    <header className="knowledge-header"><div><h1>Investigation feedback</h1><p>Record what helped and what needs correcting. Feedback is a review signal; it does not approve a prompt or establish ground truth.</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16} aria-hidden="true" />{loading ? 'Loading…' : 'Refresh'}</button></header>
    {error && <p className="knowledge-message is-error" role="alert">{error}</p>}
    {notice && <p className="knowledge-message is-success" role="status">{notice}</p>}
    <div className="feedback-workspace">
      <form className="knowledge-editor" onSubmit={submit}>
        <h2>Review an investigation</h2>
        {!canEdit && <p>A project analyst, owner or administrator can submit feedback. You can read the project history below.</p>}
        {!loading && !tickets.length && <p>No investigations are available yet. Import a completed ticket investigation from Runs to start reviewing it.</p>}
        <fieldset disabled={!canEdit || busy || loading || !tickets.length}>
          <label>Ticket<select required value={ticket} onChange={event => { setTicket(event.target.value); setRating(''); setTags([]); setNotice(''); }}><option value="">Select a recorded ticket</option>{tickets.map(key => <option key={key}>{key}</option>)}</select></label>
          <fieldset><legend>Was this investigation helpful?</legend><div className="knowledge-actions">
            <button type="button" className="btn btn-secondary" aria-pressed={rating === 'UP'} onClick={() => setRating('UP')}><ThumbsUp size={16} aria-hidden="true" />Helpful</button>
            <button type="button" className="btn btn-secondary" aria-pressed={rating === 'DOWN'} onClick={() => setRating('DOWN')}><ThumbsDown size={16} aria-hidden="true" />Needs work</button>
          </div></fieldset>
          <fieldset><legend>Areas to review (optional)</legend><div className="knowledge-actions">{AVAILABLE_TAGS.map(tag => <button key={tag} type="button" className="btn btn-secondary" aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])}>{tag}</button>)}</div></fieldset>
          <label>Your observations<textarea required maxLength={4000} rows={6} value={comment} onChange={event => setComment(event.target.value)} placeholder="Describe what the evidence supports, the correction needed, and how to verify it." /></label>
          <div className="knowledge-actions"><button type="submit" className="btn btn-primary" disabled={!ticket || !rating || !comment.trim()}>{busy ? 'Saving…' : 'Save feedback'}</button><button type="button" className="btn btn-secondary" onClick={() => { setComment(''); setRating(''); setTags([]); }}>Clear form</button></div>
        </fieldset>
      </form>
      <section className="feedback-history" aria-label="Recent project feedback"><h2>Recent feedback</h2>
        {loading && !feedbacks.length ? <p role="status">Loading feedback…</p> : !feedbacks.length ? <p>No feedback has been recorded for this project.</p> : <><p>Showing the latest {feedbacks.length} saved reviews.</p><ol>{feedbacks.map(item => <li key={item.id}>
          <header><strong>{item.ticketKey}</strong><span>{item.rating === 'UP' ? 'Helpful' : 'Needs work'}</span></header>
          <p className="feedback-comment">{item.comment}</p>
          {item.tags.length > 0 && <p>Areas: {item.tags.join(', ')}</p>}
          <p>{item.author} · <time dateTime={new Date(item.timestamp * 1000).toISOString()}>{new Date(item.timestamp * 1000).toLocaleString()}</time></p>
        </li>)}</ol></>}
      </section>
    </div>
  </div>;
};
