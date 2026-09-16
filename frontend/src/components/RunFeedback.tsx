import { useEffect, useId, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { ApiError, getSessionGeneration } from '../services/api';
import { fetchRunFeedback, saveRunFeedback } from '../services/feedback';
import type { FeedbackRating, RunFeedbackRecord } from '../services/feedback';
import './RunFeedback.css';

export function RunFeedback({ runId }: { runId: string }) {
  const [saved, setSaved] = useState<RunFeedbackRecord | null>(null);
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false);
  const footer = useRef<HTMLElement>(null);
  const requests = useRef<AbortController | null>(null);
  const noteId = useId();
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    requests.current = controller;
    const generation = getSessionGeneration();
    alive.current = true;
    const current = () => !cancelled && generation === getSessionGeneration();
    const load = () => {
      if (!current()) return;
      setLoading(true); setReady(false); setError(null);
      fetchRunFeedback(runId, controller.signal).then(value => {
        if (!current()) return;
        setSaved(value); setRating(value?.rating ?? null); setNote(value?.note ?? ''); setReady(true);
      }).catch(error => { if (current()) setError(error instanceof Error ? error.message : 'Your feedback could not be loaded.'); }).finally(() => { if (current()) setLoading(false); });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: '100px' });
    if (observer && footer.current) observer.observe(footer.current); else load();
    return () => { cancelled = true; alive.current = false; observer?.disconnect(); controller.abort(); };
  }, [runId, attempt]);

  const save = async (nextRating: FeedbackRating) => {
    if (!ready || saving) return;
    const generation = getSessionGeneration();
    const current = () => alive.current && generation === getSessionGeneration();
    setRating(nextRating); setSaving(true); setError(null); setNotice('');
    try {
      const value = await saveRunFeedback(runId, { rating: nextRating, note, expected_revision: saved?.revision ?? 0 }, requests.current?.signal);
      if (!current()) return;
      setSaved(value); setNote(value.note); setNotice('Feedback saved.');
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 409) {
        setReady(false);
        try {
          const latest = await fetchRunFeedback(runId, requests.current?.signal);
          if (!current()) return;
          setSaved(latest); setReady(true);
          setError('Your feedback changed in another session. Your note is still here. Review it and save again to replace the saved feedback.');
        } catch {
          if (current()) setError('The latest feedback could not be loaded. Your note is still here. Reload it before saving again.');
        }
      } else setError(error instanceof Error ? error.message : 'Your feedback could not be saved.');
    } finally { if (current()) setSaving(false); }
  };

  const retry = async () => {
    if (!rating) { setAttempt(value => value + 1); return; }
    const generation = getSessionGeneration();
    const current = () => alive.current && generation === getSessionGeneration();
    setLoading(true); setError(null);
    try {
      const value = await fetchRunFeedback(runId, requests.current?.signal);
      if (current()) { setSaved(value); setReady(true); setNotice('Latest feedback loaded. Your note is unchanged; save when ready.'); }
    } catch (error) { if (current()) setError(error instanceof Error ? error.message : 'Feedback could not be loaded.'); }
    finally { if (current()) setLoading(false); }
  };
  return <section ref={footer} className="run-feedback" aria-label="Your feedback on this answer" aria-busy={loading || saving}>
    <div className="run-feedback-rating"><span>Was this helpful?</span><button type="button" aria-pressed={rating === 'helpful'} disabled={!ready || loading || saving} onClick={() => void save('helpful')}><ThumbsUp size={14} /> Useful</button><button type="button" aria-pressed={rating === 'needs_work'} disabled={!ready || loading || saving} onClick={() => void save('needs_work')}><ThumbsDown size={14} /> Needs work</button></div>
    {loading && <p role="status">Loading your feedback…</p>}
    <details className="run-feedback-note"><summary>Add or edit a note</summary><form onSubmit={event => { event.preventDefault(); if (rating) void save(rating); }}><label htmlFor={noteId}>What would make this answer more useful? <span>(optional)</span></label><textarea id={noteId} maxLength={2000} rows={4} value={note} disabled={loading || saving || (!ready && !rating)} onChange={event => { setNote(event.target.value); setNotice(''); }} /><div><span>{note.length.toLocaleString()} / 2,000</span><button type="submit" className="btn btn-secondary" disabled={!ready || loading || saving || !rating}>{saving ? 'Saving…' : 'Save feedback'}</button></div>{!rating && <p>Choose Useful or Needs work to save your feedback.</p>}</form></details>
    {error && <p role="alert" className="run-feedback-error">{error}{!ready && !loading && <button type="button" onClick={() => void retry()}>Reload feedback</button>}</p>}
    <span role="status" className="run-feedback-status">{saving ? 'Saving feedback…' : notice}</span>
  </section>;
}
