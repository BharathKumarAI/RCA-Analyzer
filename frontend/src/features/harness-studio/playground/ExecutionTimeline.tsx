import React from 'react';
import { Clock, CheckCircle2, AlertCircle, ShieldAlert, Cpu, Terminal } from 'lucide-react';
import { ExecutionSpan, ExecutionTrace } from '../types/harness';

interface ExecutionTimelineProps {
  trace: ExecutionTrace | null;
  selectedSpanId: string | null;
  onSelectSpan: (span: ExecutionSpan) => void;
}

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  trace,
  selectedSpanId,
  onSelectSpan,
}) => {
  if (!trace || trace.spans.length === 0) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '11px' }}>
        <Clock size={24} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
        Send a message or test event to record an execution DAG trace.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: '11px', fontWeight: 600 }}>
        <span>DAG Execution Timeline</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
          {trace.totalDurationMs} ms total
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {trace.spans.map(span => {
          const isSelected = span.id === selectedSpanId;
          const isError = span.status === 'failed' || span.status === 'blocked';

          return (
            <div
              key={span.id}
              onClick={() => onSelectSpan(span)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: isSelected ? 'rgba(255, 148, 110, 0.12)' : 'var(--surface-secondary)',
                border: `1px solid ${isSelected ? 'var(--acc)' : 'var(--border)'}`,
                borderRadius: 7,
                cursor: 'pointer',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {span.status === 'completed' && <CheckCircle2 size={13} style={{ color: '#10b981' }} />}
                {isError && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{span.name}</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--muted)' }}>
                    {span.type} {span.model ? `· ${span.model}` : ''}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                <div style={{ color: 'var(--text)' }}>{span.durationMs} ms</div>
                {span.tokens && (
                  <div style={{ color: 'var(--muted)', fontSize: '9px' }}>{span.tokens.total} tok</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
