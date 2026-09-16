import React, { useState, useEffect, useCallback } from 'react';
import {
  Ticket,
  Search,
  Clock,
  Zap,
  ArrowUpRight,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import { fetchLiveBoard } from '../services/triage';
import type { FocusQueueItem, LiveBoardResponse } from '../types/triage';
import { TicketDetailPanel } from '../components/TicketDetailPanel';

interface ProjectTicketsProps {
  canEdit?: boolean;
  projectKey?: string;
}

export const ProjectTickets: React.FC<ProjectTicketsProps> = ({ canEdit = false, projectKey = 'DEFAULT' }) => {
  const [boardData, setBoardData] = useState<LiveBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'P1' | 'P2' | 'P3'>('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLiveBoard();
      setBoardData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allItems: FocusQueueItem[] = boardData?.focus_queue || [];

  const filteredItems = allItems.filter((item) => {
    const t = item.ticket;
    if (severityFilter !== 'ALL' && t.priority !== severityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchKey = t.ticket_id.toLowerCase().includes(q);
      const matchSummary = t.summary.toLowerCase().includes(q);
      const matchService = (t.service || '').toLowerCase().includes(q);
      const matchTeam = t.current_team.toLowerCase().includes(q);
      if (!matchKey && !matchSummary && !matchService && !matchTeam) return false;
    }
    return true;
  });

  const p1Count = allItems.filter(
    (item) => item.ticket.priority === 'P1' && item.ticket.work_state !== 'RESOLVED'
  ).length;

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
      {/* Hero Header */}
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
              background: 'linear-gradient(135deg, var(--accent-rose), var(--accent-indigo))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(244, 63, 94, 0.25)',
            }}
          >
            <Ticket size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--ink-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                }}
              >
                {projectKey} • OPERATIONS
              </span>
              <span className="badge badge-teal">Saved project tickets</span>
              <span className="badge badge-magenta">SLA Governed</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              Incidents & Jira Ticket Desk
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Enterprise tracking for production outages, telemetry anomalies, auto-triaged root causes, and resolution SLAs.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {p1Count > 0 ? (
            <span className="badge badge-rose" style={{ padding: '6px 12px', fontSize: '12px' }}>
              {p1Count} Critical P1 Unresolved
            </span>
          ) : (
            <span className="badge badge-teal" style={{ padding: '6px 12px', fontSize: '12px' }}>
              All P1s Mitigated
            </span>
          )}

          <button
            onClick={loadData}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
            title="Refresh tickets"
          >
            <RotateCw size={13} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '6px 12px',
            width: '340px',
          }}
        >
          <Search size={14} color="var(--ink-tertiary)" />
          <input
            type="text"
            placeholder="Search ticket ID, summary, or service..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ink-primary)',
              fontSize: '12px',
              width: '100%',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {(['ALL', 'P1', 'P2', 'P3'] as const).map((sev) => {
            const isSelected = severityFilter === sev;
            return (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                style={{
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: isSelected ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                  background: isSelected ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-card)',
                  color: isSelected ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tickets Table */}
      <div
        className="platform-card"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          overflowX: 'auto',
        }}
      >
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
            <RotateCw className="spin" size={24} style={{ margin: '0 auto 12px auto', display: 'block' }} />
            <p>Loading incidents and tickets desk...</p>
          </div>
        ) : error ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--accent-rose)' }}>
            <AlertTriangle size={24} style={{ margin: '0 auto 8px auto', display: 'block' }} />
            <p>{error}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
            No tickets match your search or filter criteria.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr
                style={{
                  background: 'var(--bg-elevated)',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--ink-secondary)',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Ticket ID</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Summary & Service</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Severity</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Work State</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>SLA Timer</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Assigned Team</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Auto-Triage</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const t = item.ticket;
                const sla = item.sla;
                const pColor = t.priority === 'P1' ? 'badge-rose' : t.priority === 'P2' ? 'badge-amber' : 'badge-teal';
                const isBreached = sla.risk_state === 'BREACHED';

                return (
                  <tr
                    key={t.ticket_id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      transition: 'background 0.15s ease',
                    }}
                    className="table-row-hover"
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 800,
                        color: 'var(--accent-rose)',
                      }}
                    >
                      {t.ticket_id}
                    </td>

                    <td style={{ padding: '12px 16px', maxWidth: '340px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>{t.summary}</div>
                      <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: '2px' }}>
                        {t.service || 'general-service'} • {t.environment || 'PROD'}
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span className={`badge ${pColor}`}>{t.priority}</span>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>
                        {t.work_state.toLowerCase().replace('_', ' ')}
                      </span>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: sla.risk_state === 'UNKNOWN' ? 'var(--ink-secondary)' : isBreached ? 'var(--accent-rose)' : 'var(--accent-teal)',
                          fontWeight: 700,
                        }}
                      >
                        <Clock size={12} />
                        <span>{sla.sla_remaining_formatted}</span>
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px', color: 'var(--ink-secondary)' }}>
                      {t.current_team}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span className="badge badge-magenta" style={{ gap: '4px' }}>
                        <Zap size={10} /> Review findings
                      </span>
                    </td>

                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedTicketId(t.ticket_id)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '11.5px', gap: '4px' }}
                      >
                        Inspect <ArrowUpRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-out Ticket Detail Drawer */}
      {selectedTicketId && (
        <TicketDetailPanel
          canEdit={canEdit}
          ticketId={selectedTicketId}
          onClose={() => setSelectedTicketId(null)}
          onTicketUpdated={loadData}
        />
      )}
    </div>
  );
};
