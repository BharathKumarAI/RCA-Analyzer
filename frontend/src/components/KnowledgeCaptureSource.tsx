import type { KnowledgeItem } from '../types/api';

export function KnowledgeCaptureSource({ item }: { item: KnowledgeItem }) {
  if (!item.capture) return null;
  const labels = { document: 'Project document', jira_ticket: 'Jira ticket', confluence: 'Confluence page', feedback: 'Verified feedback' };
  return <section className="knowledge-source">
    <h3>Captured from {labels[item.capture.source.kind]}</h3>
    <p>{item.capture.source.id} · {new Date(item.capture.captured_at * 1000).toLocaleString()}</p>
    {item.capture_eligibility?.eligible === false && <div className="knowledge-message is-error" role="note"><div><strong>Not available to new investigations</strong><ul>{item.capture_eligibility.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div></div>}
    <details><summary>Source version</summary><p className="knowledge-fingerprint">{item.capture.source.content_hash}</p></details>
  </section>;
}
