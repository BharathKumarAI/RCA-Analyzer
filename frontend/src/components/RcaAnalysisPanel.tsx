import { useEffect, useRef, useState } from 'react';
import { AnswerMarkdown } from './AnswerMarkdown';
import { fetchRunEvidence, type RunEvidence } from '../services/api';
import type { RcaAnalysis } from '../types/triage';

export function RcaAnalysisPanel({ analysis, onOpenRun }: {
  analysis: RcaAnalysis;
  onOpenRun?: (runId: string) => void | Promise<void>;
}) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<RunEvidence[] | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current++; }, []);
  const inspectEvidence = async (evidenceId: string) => {
    setSelectedEvidenceId(evidenceId);
    if (evidence) return;
    const version = ++requestVersion.current;
    setLoadingEvidence(true);
    setError(null);
    try {
      const items = await fetchRunEvidence(analysis.run_id);
      if (version === requestVersion.current) setEvidence(items);
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : 'Unable to load saved evidence.');
    } finally {
      if (version === requestVersion.current) setLoadingEvidence(false);
    }
  };
  const selectedEvidence = evidence?.find(item => item.evidence_id === selectedEvidenceId);
  const result = analysis.result;
  return <section className="platform-card" style={{ padding: 20, overflowWrap: 'anywhere' }} aria-label="Saved method analysis">
    <p>{analysis.status.toLowerCase().replaceAll('_', ' ')} · {new Date(analysis.created_at * 1000).toLocaleString()}</p>
    {onOpenRun && <button type="button" className="btn btn-secondary" onClick={async () => {
      try { await onOpenRun(analysis.run_id); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open the saved run.'); }
    }}>Open investigation {analysis.run_id}</button>}
    <h2>Saved analysis</h2>
    <p>Outcome: {result.outcome.toLowerCase().replaceAll('_', ' ')}</p>
    <AnswerMarkdown text={result.summary} />
    <h3>Findings in saved order</h3>
    {result.findings.length ? <ol>{result.findings.map((finding, index) => <li key={index}>
      <AnswerMarkdown text={finding.summary} />
      {finding.evidence_ids.length ? <div aria-label={`Sources for finding ${index + 1}`}>
        {finding.evidence_ids.map(id => <button key={id} type="button" className="btn btn-secondary" onClick={() => void inspectEvidence(id)}>View source {id}</button>)}
      </div> : <p>No source citation was saved for this finding.</p>}
    </li>)}</ol> : <p>No findings were saved for this analysis.</p>}
    {result.uncertainties.length > 0 && <section><h3>Uncertainties</h3><ul>{result.uncertainties.map((text, index) => <li key={index}><AnswerMarkdown text={text} /></li>)}</ul></section>}
    {result.recommended_actions.length > 0 && <section><h3>Suggested next actions</h3><p>Review these recommendations before acting.</p><ul>{result.recommended_actions.map((text, index) => <li key={index}><AnswerMarkdown text={text} /></li>)}</ul></section>}
    {error && <p role="alert">{error}</p>}
    {selectedEvidenceId && <section aria-label="Selected source">
      <h3>Source {selectedEvidenceId}</h3>
      {loadingEvidence ? <p role="status">Loading recorded source…</p> : selectedEvidence ? <>
        <p>{selectedEvidence.source.connector} · {selectedEvidence.source.system} · {selectedEvidence.observed_at}</p>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{selectedEvidence.content_json}</pre>
      </> : evidence ? <p>This citation does not match a recorded source for this run.</p> : <button type="button" className="btn btn-secondary" onClick={() => void inspectEvidence(selectedEvidenceId)}>Retry source</button>}
    </section>}
  </section>;
}
