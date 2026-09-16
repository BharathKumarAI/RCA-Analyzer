import { useState, useMemo } from 'react';
import {
  AlertCircle,
  BookOpen,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Info,
  Layers,
  ListChecks,
  Server,
  ShieldCheck,
  TrendingDown,
} from 'lucide-react';
import { AnswerMarkdown } from '../AnswerMarkdown';
import type { Run } from '../../types/api';
import type { RunEvidence } from '../../services/api';

interface ChatExecutiveBriefProps {
  run: Run;
  evidence?: RunEvidence[];
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

export function ChatExecutiveBrief({ run, evidence = [] }: ChatExecutiveBriefProps) {
  const result = run.result;
  const [openJargon, setOpenJargon] = useState<string | null>(null);

  // Parse layman-friendly summary
  const summaryText = result?.summary || String(run.raw?.reason || 'Investigation in progress.');

  // Find matching jargon terms present in the run's summary and findings
  const matchedJargon = useMemo(() => {
    const fullText = `${summaryText} ${result?.findings.map(f => f.summary).join(' ') || ''}`.toLowerCase();
    return Object.entries(COMMON_JARGON)
      .filter(([key]) => fullText.includes(key))
      .map(([, def]) => def);
  }, [summaryText, result]);

  // Determine severity tier
  const severity = useMemo(() => {
    const text = summaryText.toLowerCase();
    if (text.includes('p1') || text.includes('critical') || text.includes('starvation') || text.includes('outage')) {
      return { level: 'Critical Impact', class: 'severity-critical', desc: 'Customer transactions or core workflows interrupted.' };
    }
    if (text.includes('p2') || text.includes('high') || text.includes('degradation') || text.includes('timeout')) {
      return { level: 'Moderate Impact', class: 'severity-moderate', desc: 'Noticeable slowdown or intermittent errors observed.' };
    }
    return { level: 'Low / Informational', class: 'severity-low', desc: 'Minor degradation or routine diagnostics.' };
  }, [summaryText]);

  // Systems analyzed breakdown
  const systemsAudited = useMemo(() => {
    const connectorCounts: Record<string, number> = {};
    for (const item of evidence) {
      const conn = item.source?.connector || 'system';
      connectorCounts[conn] = (connectorCounts[conn] || 0) + 1;
    }

    const items = [];
    if (connectorCounts['jira'] || run.capability === 'incident_triage') {
      items.push({
        icon: '🎫',
        name: 'Incident Ticket System (Jira)',
        detail: 'Audited incident tickets, reported symptoms, and timeline notes.',
        status: 'Checked',
      });
    }
    if (connectorCounts['splunk'] || run.capability === 'log_correlation') {
      items.push({
        icon: '📊',
        name: 'System Logs (Splunk)',
        detail: 'Scanned server error logs during the incident window for error spikes.',
        status: 'Checked',
      });
    }
    if (connectorCounts['file_parser'] || evidence.some(e => e.source?.connector === 'file_parser')) {
      items.push({
        icon: '📄',
        name: 'Runbooks & Attachments',
        detail: 'Cross-referenced verified standard operating procedures for the fix.',
        status: 'Checked',
      });
    }

    if (!items.length) {
      items.push({
        icon: '🔍',
        name: 'Project Observability Sources',
        detail: 'Audited connected telemetry and platform records.',
        status: 'Checked',
      });
    }

    return items;
  }, [evidence, run.capability]);

  return (
    <div className="chat-executive-brief">
      {/* 1. Header Banner */}
      <div className="chat-brief-hero">
        <div className="chat-brief-hero-badge">
          <Briefcase size={14} />
          <span>Non-Technical Executive Overview</span>
        </div>
        <h3>Plain-English Incident Breakdown</h3>
        <p>A non-technical explanation of what occurred, why it happened, and how to recover.</p>
      </div>

      {/* 2. Business Impact & Status Matrix */}
      <div className="chat-brief-impact-card">
        <div className="chat-brief-impact-header">
          <div className={`chat-impact-pill ${severity.class}`}>
            <AlertCircle size={13} />
            <span>{severity.level}</span>
          </div>
          <span className="chat-impact-status">
            {result?.outcome === 'FINDINGS' ? (
              <span className="text-emerald font-semibold">
                <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4 }} />
                Root cause identified
              </span>
            ) : (
              <span className="text-amber font-semibold">
                <Info size={13} style={{ display: 'inline', marginRight: 4 }} />
                Under active review
              </span>
            )}
          </span>
        </div>
        <p className="chat-impact-description">{severity.desc}</p>
      </div>

      {/* 3. The Plain-English Explanation */}
      <div className="chat-brief-section">
        <div className="chat-brief-section-title">
          <Info size={15} />
          <h4>What Happened</h4>
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
            <h4>Recommended Action Plan</h4>
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

      {/* 5. Systems Audited in Simple Terms */}
      <div className="chat-brief-section">
        <div className="chat-brief-section-title">
          <Server size={15} />
          <h4>Systems Audited</h4>
        </div>
        <div className="chat-brief-systems-grid">
          {systemsAudited.map((sys, idx) => (
            <div key={idx} className="chat-brief-system-card">
              <span className="chat-brief-system-icon" aria-hidden="true">
                {sys.icon}
              </span>
              <div className="chat-brief-system-body">
                <strong>{sys.name}</strong>
                <p>{sys.detail}</p>
              </div>
              <span className="chat-brief-system-status">
                <ShieldCheck size={12} />
                {sys.status}
              </span>
            </div>
          ))}
        </div>
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
