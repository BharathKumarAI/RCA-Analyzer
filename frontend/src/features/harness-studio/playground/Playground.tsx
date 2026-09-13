import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { fetchStudioTrace, streamStudioRun, StudioTrace, StudioTraceEvent } from '../harnessApi';
import type { HarnessDefinition } from '../types/harness';

interface PlaygroundProps { harness: HarnessDefinition; capability: string; onTrace?: (trace: StudioTrace | null) => void; }
interface ChatMessage { id: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp: string; }

function display(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export const Playground: React.FC<PlaygroundProps> = ({ harness, capability, onTrace }) => {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<StudioTraceEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showTrace, setShowTrace] = useState(true);
  const traceRef = useRef<StudioTrace | null>(null);
  const traceFetchRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (value?: string) => {
    const prompt = (value ?? input).trim();
    if (!prompt || running) return;
    setInput(''); setError(null); setRunning(true); setEvents([]); setRunId(null); traceRef.current = null; traceFetchRef.current = null; onTrace?.(null);
    setMessages(current => [...current, { id: `user-${Date.now()}`, role: 'user', content: prompt, timestamp: new Date().toLocaleTimeString() }]);
    const controller = new AbortController(); abortRef.current = controller;
    let receivedRunId: string | null = null;
    try {
      await streamStudioRun(capability, prompt, event => {
        const data = event.data;
        const candidateRunId = String(data.run_id || data.id || '');
        if (candidateRunId) { receivedRunId = candidateRunId; setRunId(candidateRunId); }
        const eventRecord = data.event && typeof data.event === 'object' ? data.event as StudioTraceEvent : data as StudioTraceEvent;
        if (event.type === 'trace' || eventRecord.node_id || eventRecord.sequence !== undefined) {
          setEvents(current => [...current, { ...eventRecord, sequence: Number(eventRecord.sequence ?? current.length + 1) }]);
          if (candidateRunId && traceFetchRef.current !== candidateRunId) {
            traceFetchRef.current = candidateRunId;
            void fetchStudioTrace(candidateRunId).then(trace => { traceRef.current = trace; setEvents(trace.events || []); onTrace?.(trace); }).catch(cause => setError(cause instanceof Error ? `Trace unavailable: ${cause.message}` : 'Trace unavailable'));
          }
        }
        if (event.type === 'complete') {
          const summary = data.summary || data.result || data.reason || data.message || (data.status ? `Run ${String(data.status).toLowerCase()}.` : 'Run complete.');
          if (summary) setMessages(current => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', content: display(summary), timestamp: new Date().toLocaleTimeString() }]);
        }
        if (event.type === 'error') setError(String(data.message || data.detail || 'Run failed'));
      }, controller.signal);
      if (receivedRunId) {
        try { const trace = await fetchStudioTrace(receivedRunId); traceRef.current = trace; setEvents(trace.events || []); onTrace?.(trace); } catch (cause) { setError(cause instanceof Error ? `Trace unavailable: ${cause.message}` : 'Trace unavailable'); }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Run failed');
    } finally { setRunning(false); abortRef.current = null; }
  };

  const stop = () => abortRef.current?.abort();
  const clear = () => { setMessages([]); setEvents([]); setRunId(null); setError(null); onTrace?.(null); };

  return (
    <div className="hs-playground">
      <div className="hs-playground-head"><div><strong>{harness.metadata.name}</strong><span className="hs-playground-capability">{capability} · server run</span></div><div className="hs-playground-actions"><button type="button" className="icon-btn" title="Clear run history" onClick={clear}><Trash2 size={13} /></button><button type="button" className="hs-trace-toggle" onClick={() => setShowTrace(value => !value)}><Activity size={13} /> {showTrace ? 'Hide trace' : 'Show trace'}</button></div></div>
      {error && <div className="hs-run-error"><AlertCircle size={14} /> {error}</div>}
      <div className="hs-playground-body">
        {messages.length === 0 && !running && <div className="hs-playground-empty">Run the active approved harness against a real incident prompt. Results and trace events come from the backend.</div>}
        {messages.map(message => <div key={message.id} className={`hs-chat-message ${message.role}`}><div className="hs-chat-meta">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Harness' : 'System'} · {message.timestamp}</div><div>{message.content}</div></div>)}
        {running && <div className="hs-chat-message system"><div className="hs-chat-meta"><RefreshCw size={11} className="hs-spin" /> Running · {runId || 'waiting for run id'}</div><div>Waiting for persisted progress events…</div></div>}
        {showTrace && runId && events.length === 0 && !running && <div className="hs-playground-empty">Trace unavailable for this historical run.</div>}
        {showTrace && events.length > 0 && <div className="hs-trace-list"><div className="hs-trace-title">Execution trace <span>{events.length} events{runId ? ` · ${runId}` : ''}</span></div>{events.map((event, index) => <div className="hs-trace-event" key={`${event.sequence}-${index}`}><span className="hs-trace-sequence">{event.sequence}</span><span className="hs-trace-kind">{event.kind}</span><span className="hs-trace-node">{event.node_id || 'runtime'}</span>{event.timestamp && <time>{String(event.timestamp)}</time>}<details><summary>details</summary><pre>{display(event.details || event)}</pre></details></div>)}</div>}
      </div>
      <div className="hs-playground-chips"><button type="button" onClick={() => void run('Summarize the latest incident evidence and identify unresolved questions.')}>Summarize evidence</button><button type="button" onClick={() => void run('Build an evidence-backed incident timeline.')}>Build timeline</button></div>
      <form className="hs-playground-form" onSubmit={event => { event.preventDefault(); if (!running) void run(); }}><textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Ask the active harness…" rows={2} disabled={running} />{running ? <button type="button" className="btn btn-primary" onClick={stop}><Square size={14} /><span>Stop</span></button> : <button type="submit" className="btn btn-primary" disabled={!input.trim()}><Play size={14} /><span>Run</span></button>}</form>
    </div>
  );
};
