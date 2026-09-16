import { useState, useMemo } from 'react';
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Info,
  ListChecks,
  Server,
} from 'lucide-react';
import { AnswerMarkdown } from '../AnswerMarkdown';
import type { Run } from '../../types/api';
import type { RunEvidence } from '../../services/api';

interface ChatExecutiveBriefProps {
  run: Run;
  evidence?: RunEvidence[];
  onInspectSources?: () => void;
}

interface JargonDefinition {
  term: string;
  simpleMeaning: string;
  whyItMatters: string;
}

const COMMON_JARGON: Record<string, JargonDefinition> = {
  '504 gateway timeout': {
    term: '504 Gateway Timeout',
    simpleMeaning: 'A server waited too long for another system to respond, so the request gave up.',
    whyItMatters: 'Users see a loading spinner that turns into an error screen.',
  },
  '500 internal server error': {
    term: '500 Server Error',
    simpleMeaning: 'An unexpected crash occurred inside the application server.',
    whyItMatters: 'Transactions cannot complete until the crash is mitigated.',
  },
  'connection pool': {
    term: 'Database Connection Pool',
    simpleMeaning: 'A pre-allocated pool of phone lines between the web app and the database.',
    whyItMatters: 'When all lines are busy, new customer requests have to wait in line or fail.',
  },
  hikaricp: {
    term: 'HikariCP',
    simpleMeaning: 'A popular high-performance tool that manages database connections in Java applications.',
    whyItMatters: 'If misconfigured, it can exhaust available database connections during traffic surges.',
  },
  'blast radius': {
    term: 'Blast Radius',
    simpleMeaning: 'The total scope and number of users, systems, or transactions affected by a breakdown.',
    whyItMatters: 'Helps leaders understand the business severity and customer impact.',
  },
  mtta: {
    term: 'MTTA (Mean Time to Acknowledge)',
    simpleMeaning: 'How quickly the engineering team was alerted and began looking into the issue.',
    whyItMatters: 'A low MTTA indicates rapid operational responsiveness.',
  },
  mttr: {
    term: 'MTTR (Mean Time to Resolution)',
    simpleMeaning: 'The total time elapsed from when an incident started until service was restored.',
    whyItMatters: 'The key reliability metric for customer availability and SLAs.',
  },
  'kafka lag': {
    term: 'Kafka Message Queue Lag',
    simpleMeaning: 'A backlog of messages waiting to be processed by background workers.',
    whyItMatters: 'Causes delays in customer emails, invoice receipts, and asynchronous processing.',
  },
  adf: {
    term: 'ADF (Atlassian Document Format)',
    simpleMeaning: 'The rich text document format used internally by Jira tickets.',
    whyItMatters: 'Used to format tickets and incident logs.',
  },
  latency: {
    term: 'Latency',
    simpleMeaning: 'The delay between when a user clicks a button and when the server responds.',
    whyItMatters: 'High latency makes the application feel sluggish or frozen.',
  },
  ingress: {
    term: 'Ingress Controller',
    simpleMeaning: 'The digital front door that routes web traffic from the internet to internal servers.',
    whyItMatters: 'If the front door is blocked, no customer can reach any internal service.',
  },
};

export function ChatExecutiveBrief({ run, evidence = [], onInspectSources }: ChatExecutiveBriefProps) {
  const result = run.result;
  const [openJargon, setOpenJargon] = useState<string | null>(null);

  // Parse layman-friendly summary
  const summaryText = result?.summary || String(run.raw?.reason || (['RUNNING', 'QUEUED'].includes(run.status) ? 'Investigation in progress.' : 'No answer was saved for this investigation.'));

  // Find matching jargon terms present in the run's summary and findings
  const matchedJargon = useMemo(() => {
    const fullText = `${summaryText} ${result?.findings.map(f => f.summary).join(' ') || ''}`.toLowerCase();
    return Object.entries(COMMON_JARGON)
      .filter(([key]) => fullText.includes(key))
      .map(([, def]) => def);
  }, [summaryText, result]);

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of evidence) {
      const source = item.source.connector || item.source.system || 'Unspecified source';
      counts.set(source, (counts.get(source) || 0) + 1);
    }
    return Array.from(counts);
  }, [evidence]);

  return (
    <div className="chat-executive-brief">
      {/* 1. Header Banner */}
      <div className="chat-brief-hero">
        <div className="chat-brief-hero-badge">
          <Briefcase size={14} />
          <span>Investigation overview</span>
        </div>
        <h3>Investigation brief</h3>
        <p>Saved findings, suggested next steps, and collected sources.</p>
      </div>

      {/* 2. Business Impact & Status Matrix */}
      <div className="chat-brief-impact-card">
        <div className="chat-brief-impact-header">
          <span className="chat-impact-pill">{run.status.replaceAll('_', ' ').toLowerCase()}</span>
          <span className="chat-impact-status">
            {result?.outcome === 'FINDINGS' ? (
              <span className="text-emerald font-semibold">
                <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4 }} />
                Findings available
              </span>
            ) : (
              <span className="text-amber font-semibold">
                <Info size={13} style={{ display: 'inline', marginRight: 4 }} />
                {result ? result.outcome.replaceAll('_', ' ').toLowerCase() : 'No saved findings'}
              </span>
            )}
          </span>
        </div>
        <p className="chat-impact-description">Findings are investigation outputs. Review their sources and uncertainties before acting.</p>
      </div>

      {/* 3. The Plain-English Explanation */}
      <div className="chat-brief-section">
        <div className="chat-brief-section-title">
          <Info size={15} />
          <h4>Summary</h4>
        </div>
        <div className="chat-brief-narrative">
          <AnswerMarkdown text={summaryText} />
        </div>
      </div>

      {/* 4. Action Plan for Leaders */}
      {result?.recommended_actions && result.recommended_actions.length > 0 && (
        <div className="chat-brief-section">
          <div className="chat-brief-section-title">
            <ListChecks size={15} />
            <h4>Suggested next steps</h4>
          </div>
          <div className="chat-brief-actions-list">
            {result.recommended_actions.map((action, index) => (
              <div key={index} className="chat-brief-action-item">
                <span className="chat-brief-action-num">{index + 1}</span>
                <div className="chat-brief-action-content">
                  <AnswerMarkdown text={action} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!result?.uncertainties.length && (
        <div className="chat-brief-section">
          <h4>Still uncertain</h4>
          {result.uncertainties.map((uncertainty, index) => <AnswerMarkdown key={index} text={uncertainty} />)}
        </div>
      )}
      <div className="chat-brief-section">
        <div className="chat-brief-section-title">
          <Server size={15} />
          <h4>Collected sources</h4>
        </div>
        {sourceCounts.length ? (
          <>
            <ul>{sourceCounts.map(([source, count]) => <li key={source}>{source}: {count} saved evidence {count === 1 ? 'item' : 'items'}</li>)}</ul>
            {onInspectSources && <button type="button" className="chat-text-button" onClick={onInspectSources}>Review sources</button>}
          </>
        ) : <p>No collected sources are available.</p>}
      </div>

      {/* 6. Interactive Jargon Buster */}
      {matchedJargon.length > 0 && (
        <div className="chat-brief-section chat-brief-jargon">
          <div className="chat-brief-section-title">
            <HelpCircle size={15} />
            <h4>Jargon Buster (Key Terms Explained)</h4>
          </div>
          <p className="chat-brief-jargon-help">
            Non-technical definitions for technical concepts mentioned in this diagnosis:
          </p>
          <div className="chat-jargon-list">
            {matchedJargon.map(item => {
              const isOpen = openJargon === item.term;
              return (
                <div key={item.term} className={`chat-jargon-item ${isOpen ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="chat-jargon-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpenJargon(isOpen ? null : item.term)}
                  >
                    <strong>{item.term}</strong>
                    <ChevronDown size={14} className={`chat-jargon-chevron ${isOpen ? 'is-flipped' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="chat-jargon-content">
                      <p>
                        <strong>What it means:</strong> {item.simpleMeaning}
                      </p>
                      <p>
                        <strong>Why it matters:</strong> {item.whyItMatters}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
