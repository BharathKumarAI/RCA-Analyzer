import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Send,
  RotateCw,
  Check,
  Tag,
  MessageSquare,
  AlertTriangle,
  User,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchCalibrationFeedback,
  submitCalibrationFeedback,
  fetchLiveBoard,
} from '../services/triage';
import type { CalibrationFeedback } from '../types/triage';

const AVAILABLE_TAGS = [
  'Query Precision',
  'Root Cause Depth',
  'Hypotheses Accuracy',
  'SLA Adherence',
  'Failure Boundary',
  'Tool Selection',
  'Execution Latency',
];

export const ProjectFeedback: React.FC = () => {
  const [feedbacks, setFeedbacks] = useState<CalibrationFeedback[]>([]);
  const [ticketsList, setTicketsList] = useState<string[]>([]);
  const [selectedTicket, setSelectedTicket] = useState('RS-177053');
  const [rating, setRating] = useState<'UP' | 'DOWN'>('UP');
  const [selectedTags, setSelectedTags] = useState<string[]>(['Query Precision', 'Root Cause Depth']);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadFeedbacks = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await fetchCalibrationFeedback();
      setFeedbacks(list);
    } catch (e) {
      console.error('Failed to load feedback', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeedbacks();
    fetchLiveBoard()
      .then((res) => {
        const keys = res.focus_queue.map((item) => item.ticket.ticket_id);
        setTicketsList(keys);
        if (keys.length > 0) setSelectedTicket(keys[0]);
      })
      .catch((e) => console.error('Failed to load tickets list', e));
  }, [loadFeedbacks]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    try {
      setIsSubmitting(true);
      await submitCalibrationFeedback(selectedTicket, rating, selectedTags, commentText.trim());
      setSubmittedSuccess(true);
      setCommentText('');
      await loadFeedbacks();
      setTimeout(() => setSubmittedSuccess(false), 3500);
    } catch (e: any) {
      alert(e?.message || 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        overflowY: 'auto',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header Banner */}
      <div
        className="platform-card"
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--accent-rose), var(--accent-teal))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(244, 63, 94, 0.25)',
            }}
          >
            <Sparkles size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--ink-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                }}
              >
                EVALUATION & PROMPT CALIBRATION
              </span>
              <span className="badge badge-magenta">SRE Closed-Loop</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              SRE Calibration Feedback Loop
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Human analyst evaluation stream that captures corrections, query refinements, and ground truth for model tuning.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-teal">{feedbacks.length} Evaluations Recorded</span>
        </div>
      </div>

      {/* Main Grid: Form Left, Feed Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '20px' }}>
        {/* Left: Feedback Form */}
        <div
          className="platform-card"
          style={{
            padding: '22px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={16} color="var(--accent-rose)" />
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
              Submit Calibration Feedback
            </h2>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Ticket Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                Target Incident Ticket:
              </label>
              <select
                value={selectedTicket}
                onChange={(e) => setSelectedTicket(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--ink-primary)',
                  fontSize: '12.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  outline: 'none',
                }}
              >
                {ticketsList.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            {/* Rating Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                AI Investigation Quality:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setRating('UP')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: rating === 'UP' ? '1px solid var(--accent-teal)' : '1px solid var(--border-subtle)',
                    background: rating === 'UP' ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-elevated)',
                    color: rating === 'UP' ? 'var(--accent-teal)' : 'var(--ink-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  <ThumbsUp size={14} />
                  <span>Accurate</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRating('DOWN')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: rating === 'DOWN' ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                    background: rating === 'DOWN' ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-elevated)',
                    color: rating === 'DOWN' ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  <ThumbsDown size={14} />
                  <span>Refinement Needed</span>
                </button>
              </div>
            </div>

            {/* Tags Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                Evaluation Aspects:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {AVAILABLE_TAGS.map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: isSelected ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-elevated)',
                        color: isSelected ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Comment Textarea */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                Calibration Notes & Findings:
              </label>
              <textarea
                rows={4}
                placeholder="Explain what the AI agent did well or what prompt instructions should be refined..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--ink-primary)',
                  fontSize: '12px',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !commentText.trim()}
              className="btn btn-primary"
              style={{ padding: '8px', gap: '6px', justifyContent: 'center' }}
            >
              {isSubmitting ? <RotateCw className="spin" size={13} /> : <Send size={13} />}
              <span>{isSubmitting ? 'Recording Feedback...' : 'Record SRE Feedback'}</span>
            </button>

            {submittedSuccess && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: 'var(--accent-teal)',
                  fontSize: '11.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Check size={14} />
                <span>Feedback recorded and incorporated into calibration queue.</span>
              </div>
            )}
          </form>
        </div>

        {/* Right: Feedback Stream */}
        <div
          className="platform-card"
          style={{
            padding: '22px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
              Recent SRE Calibration Feedbacks
            </h2>
            <button
              onClick={loadFeedbacks}
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px', gap: '4px' }}
            >
              <RotateCw size={11} className={isLoading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
                <RotateCw className="spin" size={20} style={{ margin: '0 auto 8px auto', display: 'block' }} />
                <span>Loading feedback stream...</span>
              </div>
            ) : feedbacks.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-secondary)', fontSize: '12.5px' }}>
                No calibration feedback recorded yet. Submit the first evaluation to calibrate model prompts.
              </div>
            ) : (
              feedbacks.map((fb) => (
                <div
                  key={fb.id}
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: fb.rating === 'UP' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                          color: fb.rating === 'UP' ? 'var(--accent-teal)' : 'var(--accent-rose)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        {fb.rating === 'UP' ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}
                        {fb.rating === 'UP' ? 'Accurate' : 'Refinement'}
                      </span>
                      <strong style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-rose)', fontSize: '12.5px' }}>
                        {fb.ticketKey}
                      </strong>
                    </div>

                    <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>{fb.time}</span>
                  </div>

                  <p style={{ fontSize: '12.5px', color: 'var(--ink-primary)', lineHeight: 1.5, margin: 0 }}>
                    "{fb.comment}"
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', fontSize: '11px' }}>
                    <span style={{ color: 'var(--ink-secondary)' }}>
                      By: <strong style={{ color: 'var(--ink-primary)' }}>{fb.author}</strong>
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {fb.tags.map((t, idx) => (
                        <span key={idx} className="badge badge-neutral" style={{ fontSize: '10px' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
