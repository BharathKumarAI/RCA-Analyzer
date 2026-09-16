import { useState } from 'react';
import { Activity, ChevronDown, Check, Clock3,  ArrowRight } from 'lucide-react';
import type { Run, RunStage } from '../../types/api';
import type { RunTraceEvent } from '../../services/api';

interface ChatThinkingAccordionProps {
  run?: Run | null;
  events?: RunTraceEvent[];
  activePhase?: string;
  isStreaming?: boolean;
  onOpenActivityTab?: () => void;
}

export function ChatThinkingAccordion({
  run,
  events = [],
  activePhase,
  isStreaming = false,
  onOpenActivityTab,
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

  const stageCount = rawStages.length || eventNodes.length;

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
            <Activity size={14} />
          </span>
          <span className="chat-thinking-label">
            {isStreaming ? (
              <span className="chat-thinking-live">
                <span className="chat-thinking-pulse-dot" />
                Investigation in progress: {activePhase || 'Waiting for saved activity…'}
              </span>
            ) : (
              <span>
                Activity{' '}
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
                  {typeof stage.duration_ms === 'number' && stage.duration_ms > 0 && (
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
                <div key={idx} className="chat-thinking-step">
                  <span className="chat-thinking-step-icon">
                    <Clock3 size={11} />
                  </span>
                  <span className="chat-thinking-step-name">
                    {String(event.node_id || 'Investigation').replace(/^(tool|agent):/, '')}: {String(event.kind || 'update').replaceAll('_', ' ')}
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
              {isStreaming ? 'Waiting for recorded investigation steps…' : 'No recorded steps are available.'}
            </p>
          )}

          {onOpenActivityTab && (
            <button
              type="button"
              className="chat-thinking-drawer-link"
              onClick={e => {
                e.stopPropagation();
                onOpenActivityTab();
              }}
            >
              <span>Inspect saved activity</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
