import { useState } from 'react';
import { Brain, ChevronDown, Check, Clock3, Sparkles, ArrowRight } from 'lucide-react';
import type { Run, RunStage } from '../../types/api';
import type { RunTraceEvent } from '../../services/api';

interface ChatThinkingAccordionProps {
  run?: Run | null;
  events?: RunTraceEvent[];
  activePhase?: string;
  isStreaming?: boolean;
  onOpenReasoningTab?: () => void;
}

export function ChatThinkingAccordion({
  run,
  events = [],
  activePhase,
  isStreaming = false,
  onOpenReasoningTab,
}: ChatThinkingAccordionProps) {
  const [expanded, setExpanded] = useState(isStreaming);

  // Compute duration from run or trace events
  const durationSeconds =
    run?.duration_seconds ??
    (run?.completed_at && run?.created_at
      ? (new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) / 1000
      : null);

  // Extract stage progression
  const rawStages: RunStage[] = run?.stages || [];
  const eventNodes = events
    .filter(e => e.kind && !['agent_event', 'state_delta'].includes(String(e.kind)))
    .slice(-8);

  const stageCount = rawStages.length || eventNodes.length || (isStreaming ? 1 : 0);

  if (!isStreaming && !run?.result && !rawStages.length && !events.length) {
    return null;
  }

  return (
    <div className={`chat-thinking-accordion ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="chat-thinking-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="chat-thinking-title">
          <span className="chat-thinking-brain-icon">
            <Brain size={14} />
          </span>
          <span className="chat-thinking-label">
            {isStreaming ? (
              <span className="chat-thinking-live">
                <span className="chat-thinking-pulse-dot" />
                Reasoning in progress: {activePhase || 'Analyzing incident context…'}
              </span>
            ) : (
              <span>
                Thought process{' '}
                {stageCount > 0 && <span className="chat-thinking-count">({stageCount} steps)</span>}
              </span>
            )}
          </span>
        </div>

        <div className="chat-thinking-meta">
          {durationSeconds !== null && durationSeconds > 0 && (
            <span className="chat-thinking-duration">
              <Clock3 size={12} />
              {durationSeconds.toFixed(1)}s
            </span>
          )}
          <ChevronDown
            size={14}
            className={`chat-thinking-chevron ${expanded ? 'is-flipped' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="chat-thinking-body">
          {rawStages.length > 0 ? (
            <div className="chat-thinking-steps">
              {rawStages.map((stage, idx) => (
                <div key={idx} className={`chat-thinking-step step-${stage.status}`}>
                  <span className="chat-thinking-step-icon">
                    {stage.status === 'completed' ? (
                      <Check size={12} />
                    ) : stage.status === 'running' ? (
                      <span className="chat-thinking-step-spinner" />
                    ) : (
                      <Clock3 size={12} />
                    )}
                  </span>
                  <span className="chat-thinking-step-name">{stage.name}</span>
                  {stage.duration_ms > 0 && (
                    <span className="chat-thinking-step-time">
                      {(stage.duration_ms / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : eventNodes.length > 0 ? (
            <div className="chat-thinking-steps">
              {eventNodes.map((event, idx) => (
                <div key={idx} className="chat-thinking-step step-completed">
                  <span className="chat-thinking-step-icon">
                    <Sparkles size={11} />
                  </span>
                  <span className="chat-thinking-step-name">
                    {String(event.node_id || event.kind || 'Step').replace(/^(tool|agent):/, '')}
                  </span>
                  {typeof event.details?.duration_ms === 'number' && (
                    <span className="chat-thinking-step-time">
                      {(Number(event.details.duration_ms) / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="chat-thinking-empty">
              {isStreaming ? 'Synthesizing evidence and cross-referencing telemetry…' : 'Initial reasoning completed.'}
            </p>
          )}

          {onOpenReasoningTab && (
            <button
              type="button"
              className="chat-thinking-drawer-link"
              onClick={e => {
                e.stopPropagation();
                onOpenReasoningTab();
              }}
            >
              <span>Inspect full reasoning trace in sidebar</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
