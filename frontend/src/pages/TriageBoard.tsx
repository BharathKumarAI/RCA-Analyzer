import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileSearch,
  FileText,
  Filter,
  Flame,
  HelpCircle,
  History,
  Layers,
  ListOrdered,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingDown,
  TrendingUp,
  User,
  UserCheck,
  Users,
  Wrench,
  X,
  XCircle,
  Zap,
  Kanban,
  MessageSquare,
  Copy,
  ArrowUpRight,
} from 'lucide-react';
import type {
  LiveBoardResponse,
  TicketWorkspaceResponse,
  FocusQueueItem,
  ToolProposal,
  InvestigationEvidence,
  InvestigationFinding,
  GovernedAction,
  InvestigationEvent,
} from '../types/triage';
import {
  fetchLiveBoard,
  fetchTicketWorkspace,
  acknowledgeTicket,
  updateProposalRevision,
  executeToolProposal,
  promoteProposalEvidence,
  updateEvidenceStatus,
  updateFindingStatus,
  approveGovernedAction,
  escalateTicket,
  returnTicket,
  updateTicketStage,
  fetchTeamActivity,
} from '../services/triage';
import { TicketDetailPanel } from '../components/TicketDetailPanel';
import '../styles/triage-board.css';

type WorkspaceTab =
  | 'overview'
  | 'autotriage'
  | 'toolpane'
  | 'evidence'
  | 'related'
  | 'activity'
  | 'actions';

export const TriageBoard: React.FC = () => {
  // State
  const [liveBoard, setLiveBoard] = useState<LiveBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBucket, setActiveBucket] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Operational View Modes & Filters (Prism Aligned)
  const [viewMode, setViewMode] = useState<'kanban' | 'teamwise' | 'comments_evidence' | 'focus_queue'>('kanban');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | 'P1' | 'P2' | 'P3'>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [drawerTicketId, setDrawerTicketId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copiedEvidenceId, setCopiedEvidenceId] = useState<string | null>(null);

  // Selected Ticket Workspace State
  const [workspace, setWorkspace] = useState<TicketWorkspaceResponse | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');

  // Tool Pane State
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [editedQuery, setEditedQuery] = useState('');
  const [executingTool, setExecutingTool] = useState(false);
  const [promotingEvidence, setPromotingEvidence] = useState(false);
  const [evidenceSummary, setEvidenceSummary] = useState('');

  // Escalate / Return Modal State
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [targetTeam, setTargetTeam] = useState('Billing Platform Team');
  const [escalateReason, setEscalateReason] = useState('');

  // Governed Action Approval State
  const [approvingActionId, setApprovingActionId] = useState<string | null>(null);

  // Load Board
  const loadBoard = useCallback(async (bucket = activeBucket, search = searchQuery) => {
    try {
      setError(null);
      const data = await fetchLiveBoard({
        work_state: bucket,
        search: search.trim() || undefined,
      });
      setLiveBoard(data);
      // Auto-select first ticket if none selected
      if (!selectedTicketId && data.focus_queue.length > 0) {
        setSelectedTicketId(data.focus_queue[0].ticket.ticket_id);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load live triage board');
    } finally {
      setLoading(false);
    }
  }, [activeBucket, searchQuery, selectedTicketId]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Auto-refresh interval (12s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadBoard();
    }, 12000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadBoard]);

  // Quick Stage Advance
  const handleQuickAdvance = async (
    e: React.MouseEvent,
    ticketId: string,
    targetState: string,
    targetTeam?: string
  ) => {
    e.stopPropagation();
    try {
      await updateTicketStage(ticketId, targetState, targetTeam);
      await loadBoard();
    } catch (err: any) {
      alert(err?.message || 'Failed to advance ticket stage');
    }
  };

  // Load Ticket Workspace
  const loadWorkspace = useCallback(async (ticketId: string) => {
    try {
      setWorkspaceLoading(true);
      const data = await fetchTicketWorkspace(ticketId);
      setWorkspace(data);
      if (data.tool_proposals.length > 0) {
        setSelectedProposalId(data.tool_proposals[0].proposal_id);
        setEditedQuery(data.tool_proposals[0].current_query);
      }
    } catch (err: any) {
      console.error('Failed to load ticket workspace', err);
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTicketId) {
      loadWorkspace(selectedTicketId);
    }
  }, [selectedTicketId, loadWorkspace]);

  // Handlers
  const handleSelectTicket = (ticketId: string) => {
    setSelectedTicketId(ticketId);
  };

  const handleAcknowledge = async (ticketId: string) => {
    try {
      await acknowledgeTicket(ticketId);
      await loadBoard();
      await loadWorkspace(ticketId);
    } catch (err: any) {
      alert(err?.message || 'Failed to acknowledge ticket');
    }
  };

  const handleToolTabSelect = (prop: ToolProposal) => {
    setSelectedProposalId(prop.proposal_id);
    setEditedQuery(prop.current_query);
  };

  const handleSaveQuery = async () => {
    if (!selectedProposalId) return;
    try {
      const updated = await updateProposalRevision(selectedProposalId, editedQuery);
      if (workspace) {
        setWorkspace({
          ...workspace,
          tool_proposals: workspace.tool_proposals.map(p =>
            p.proposal_id === updated.proposal_id ? updated : p
          ),
        });
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to save query revision');
    }
  };

  const handleExecuteQuery = async () => {
    if (!selectedProposalId) return;
    try {
      setExecutingTool(true);
      const res = await executeToolProposal(selectedProposalId);
      if (workspace) {
        setWorkspace({
          ...workspace,
          tool_proposals: workspace.tool_proposals.map(p =>
            p.proposal_id === selectedProposalId
              ? { ...p, status: 'EXECUTED', latest_result: res.result, execution_count: res.execution_count }
              : p
          ),
        });
      }
    } catch (err: any) {
      alert(err?.message || 'Tool execution failed');
    } finally {
      setExecutingTool(false);
    }
  };

  const handlePromoteEvidence = async () => {
    if (!selectedProposalId || !evidenceSummary.trim()) return;
    try {
      setPromotingEvidence(true);
      const newEv = await promoteProposalEvidence(selectedProposalId, evidenceSummary.trim());
      if (workspace) {
        setWorkspace({
          ...workspace,
          evidence: [newEv, ...workspace.evidence],
        });
      }
      setEvidenceSummary('');
      setActiveTab('evidence');
    } catch (err: any) {
      alert(err?.message || 'Failed to promote evidence');
    } finally {
      setPromotingEvidence(false);
    }
  };

  const handleToggleEvidence = async (evidenceId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACCEPTED' ? 'REJECTED' : 'ACCEPTED';
    try {
      await updateEvidenceStatus(evidenceId, newStatus);
      if (workspace) {
        setWorkspace({
          ...workspace,
          evidence: workspace.evidence.map(e =>
            e.evidence_id === evidenceId ? { ...e, status: newStatus } : e
          ),
        });
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to update evidence status');
    }
  };

  const handleToggleFinding = async (findingId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'CONFIRMED' ? 'REJECTED' : 'CONFIRMED';
    try {
      await updateFindingStatus(findingId, newStatus);
      if (workspace) {
        setWorkspace({
          ...workspace,
          findings: workspace.findings.map(f =>
            f.finding_id === findingId ? { ...f, status: newStatus } : f
          ),
        });
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to update finding status');
    }
  };

  const handleApproveAction = async (actionId: string) => {
    try {
      setApprovingActionId(actionId);
      await approveGovernedAction(actionId);
      if (workspace) {
        setWorkspace({
          ...workspace,
          governed_actions: workspace.governed_actions.map(a =>
            a.action_id === actionId
              ? { ...a, status: 'EXECUTED', approved_by: 'You', executed_at: Date.now() / 1000 }
              : a
          ),
        });
      }
      await loadBoard();
    } catch (err: any) {
      alert(err?.message || 'Failed to approve action');
    } finally {
      setApprovingActionId(null);
    }
  };

  const handleEscalateSubmit = async () => {
    if (!selectedTicketId || !targetTeam) return;
    try {
      await escalateTicket(selectedTicketId, targetTeam, escalateReason);
      setShowEscalateModal(false);
      setEscalateReason('');
      await loadBoard();
      await loadWorkspace(selectedTicketId);
    } catch (err: any) {
      alert(err?.message || 'Failed to escalate ticket');
    }
  };

  const handleReturnToTriage = async () => {
    if (!selectedTicketId || !workspace) return;
    try {
      await returnTicket(selectedTicketId, workspace.ticket.current_team, 'Returned from resolver team for additional telemetry');
      await loadBoard();
      await loadWorkspace(selectedTicketId);
    } catch (err: any) {
      alert(err?.message || 'Failed to return ticket');
    }
  };

  const currentProposal = workspace?.tool_proposals.find(p => p.proposal_id === selectedProposalId);

  return (
    <div className="triage-board-page">
      {/* Top Header */}
      <header className="triage-header">
        <div className="triage-title-group">
          <div className="triage-brand-mark">
            <Activity size={18} strokeWidth={2.5} />
          </div>
          <div className="triage-title-text">
            <h1>
              Live Triage Board
              <span className="triage-live-dot">
                <span className="pulse-dot" /> Live
              </span>
            </h1>
            <p>SLA-driven queue management, autonomous triage, and analyst tool workbench</p>
          </div>
        </div>

        <div className="triage-header-actions">
          <div className="triage-search-box">
            <Search size={14} color="var(--muted)" />
            <input
              type="text"
              placeholder="Search tickets, services, keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadBoard(activeBucket, searchQuery)}
            />
          </div>

          <button
            type="button"
            className="btn-triage-refresh"
            onClick={() => loadBoard(activeBucket, searchQuery)}
            title="Refresh Live Board"
          >
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Urgency Strip (4 Operational Cards) */}
      <section className="urgency-strip" aria-label="SLA Urgency Summary">
        <div
          className="urgency-card card-breached"
          onClick={() => setActiveBucket('ALL')}
          title="Filter Breached SLA"
        >
          <div className="urgency-icon-box">
            <AlertOctagon size={18} />
          </div>
          <div className="urgency-meta">
            <span className="urgency-count">{liveBoard?.urgency_strip.breached ?? 0}</span>
            <span className="urgency-label">Breached SLA</span>
          </div>
        </div>

        <div
          className="urgency-card card-at-risk"
          onClick={() => setActiveBucket('ALL')}
          title="Filter At-Risk SLA"
        >
          <div className="urgency-icon-box">
            <Clock size={18} />
          </div>
          <div className="urgency-meta">
            <span className="urgency-count">{liveBoard?.urgency_strip.at_risk ?? 0}</span>
            <span className="urgency-label">SLA Risk</span>
          </div>
        </div>

        <div
          className="urgency-card card-action-req"
          onClick={() => setActiveBucket('NEW')}
          title="Filter Action Required"
        >
          <div className="urgency-icon-box">
            <UserCheck size={18} />
          </div>
          <div className="urgency-meta">
            <span className="urgency-count">{liveBoard?.urgency_strip.action_required ?? 0}</span>
            <span className="urgency-label">Action Required</span>
          </div>
        </div>

        <div
          className="urgency-card card-healthy"
          onClick={() => setActiveBucket('ALL')}
          title="Filter Healthy SLA"
        >
          <div className="urgency-icon-box">
            <ShieldCheck size={18} />
          </div>
          <div className="urgency-meta">
            <span className="urgency-count">{liveBoard?.urgency_strip.healthy ?? 0}</span>
            <span className="urgency-label">Healthy SLA</span>
          </div>
        </div>
      </section>

      {/* View Mode Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          margin: '4px 0 14px 0',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-elevated)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          {[
            { id: 'kanban', label: 'Kanban Board (5 Stages)', icon: Kanban },
            { id: 'teamwise', label: 'Team Workload & Capacity', icon: Users },
            { id: 'comments_evidence', label: 'Comments & Evidence Stream', icon: MessageSquare },
            { id: 'focus_queue', label: 'Deep Focus Queue Desk', icon: ListOrdered },
          ].map((mode) => {
            const Icon = mode.icon;
            const isSelected = viewMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id as any)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isSelected ? 'var(--accent-rose)' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--ink-secondary)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={13} />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {(['ALL', 'P1', 'P2', 'P3'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriorityFilter(p)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '5px',
                  border: priorityFilter === p ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                  background: priorityFilter === p ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-card)',
                  color: priorityFilter === p ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: 'var(--ink-secondary)', cursor: 'pointer', marginLeft: '6px' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh (12s)</span>
          </label>
        </div>
      </div>

      {/* KANBAN BOARD VIEW (5 Stages) */}
      {viewMode === 'kanban' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(260px, 1fr))',
            gap: '14px',
            overflowX: 'auto',
            paddingBottom: '16px',
            flex: 1,
          }}
        >
          {[
            {
              id: 'incoming',
              title: 'Triage Queue',
              badgeText: 'Yet to Pick',
              badgeClass: 'badge-rose',
              nextStage: 'IN_TRIAGE',
              nextLabel: 'Start Triage',
              matcher: (t: any) => t.work_state === 'NEW' || t.work_state === 'RETURNED',
            },
            {
              id: 'auto',
              title: 'In Auto-Triage',
              badgeText: 'AI Active',
              badgeClass: 'badge-amber',
              nextStage: 'IN_TRIAGE',
              nextLabel: 'Claim Triage',
              matcher: (t: any) => t.work_state === 'IN_TRIAGE' && !t.assignee,
            },
            {
              id: 'pending',
              title: 'Pending Review',
              badgeText: 'RCA Ready',
              badgeClass: 'badge-teal',
              nextStage: 'APP_TEAM',
              nextLabel: 'Dispatch to Team',
              matcher: (t: any) => t.work_state === 'IN_TRIAGE' && Boolean(t.assignee),
            },
            {
              id: 'handoff',
              title: 'With Application Team',
              badgeText: 'In Progress',
              badgeClass: 'badge-neutral',
              nextStage: 'RESOLVED',
              nextLabel: 'Verify & Resolve',
              matcher: (t: any) => t.work_state === 'APP_TEAM' || t.work_state === 'FOLLOW_UP',
            },
            {
              id: 'resolved',
              title: 'Resolved & Verified',
              badgeText: 'Verified',
              badgeClass: 'badge-teal',
              nextStage: null,
              nextLabel: null,
              matcher: (t: any) => t.work_state === 'RESOLVED' || t.work_state === 'WAITING',
            },
          ].map((col) => {
            const colTickets = (liveBoard?.focus_queue || []).filter((item) => {
              const t = item.ticket;
              if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
              if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchKey = t.ticket_id.toLowerCase().includes(q);
                const matchSummary = t.summary.toLowerCase().includes(q);
                const matchService = (t.service || '').toLowerCase().includes(q);
                if (!matchKey && !matchSummary && !matchService) return false;
              }
              return col.matcher(t);
            });

            return (
              <div
                key={col.id}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  minHeight: '480px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                      {col.title}
                    </div>
                    <span className={`badge ${col.badgeClass}`} style={{ fontSize: '10px', marginTop: '2px' }}>
                      {col.badgeText}
                    </span>
                  </div>
                  <span className="badge badge-neutral" style={{ fontSize: '11px', fontWeight: 800 }}>
                    {colTickets.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
                  {colTickets.map((item) => {
                    const t = item.ticket;
                    const sla = item.sla;
                    const isBreached = sla.risk_state === 'BREACHED';

                    return (
                      <div
                        key={t.ticket_id}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '8px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span
                            onClick={() => setDrawerTicketId(t.ticket_id)}
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '12.5px',
                              fontWeight: 800,
                              color: 'var(--accent-rose)',
                              cursor: 'pointer',
                            }}
                          >
                            {t.ticket_id}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className={`badge ${t.priority === 'P1' ? 'badge-rose' : 'badge-amber'}`}>
                              {t.priority}
                            </span>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                fontSize: '11px',
                                color: isBreached ? 'var(--accent-rose)' : 'var(--accent-amber)',
                                fontWeight: 700,
                              }}
                            >
                              <Clock size={11} />
                              <span>{sla.sla_remaining_formatted}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink-primary)', lineHeight: 1.35 }}>
                          {t.summary}
                        </div>

                        <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)' }}>
                          {t.service || 'general'} • {t.current_team}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="badge badge-magenta" style={{ fontSize: '10px' }}>
                            <Zap size={9} /> 89% RCA
                          </span>
                          {t.labels?.slice(0, 2).map((l: string, idx: number) => (
                            <span key={idx} className="badge badge-neutral" style={{ fontSize: '10px' }}>
                              {l}
                            </span>
                          ))}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', marginTop: '2px' }}>
                          <button
                            onClick={() => setDrawerTicketId(t.ticket_id)}
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: '11px', gap: '3px' }}
                          >
                            Inspect <ArrowUpRight size={11} />
                          </button>

                          {col.nextStage && (
                            <button
                              onClick={(e) => handleQuickAdvance(e, t.ticket_id, col.nextStage, t.current_team)}
                              className="btn btn-primary"
                              style={{ padding: '3px 10px', fontSize: '11px', gap: '4px' }}
                            >
                              <span>{col.nextLabel}</span>
                              <ArrowRight size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TEAMWISE WORKLOAD & CAPACITY VIEW */}
      {viewMode === 'teamwise' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', flex: 1, paddingBottom: '20px' }}>
          {[
            { name: 'Payments Core Team', lead: 'Sarah Jenkins', mttt: '1h 24m' },
            { name: 'Core NetOps', lead: 'Dave Miller', mttt: '2h 05m' },
            { name: 'Billing Platform Team', lead: 'Mike R.', mttt: '1h 45m' },
            { name: 'Data Platform Team', lead: 'Priya S.', mttt: '2h 40m' },
            { name: 'Identity & SSO Team', lead: 'Alex Chen', mttt: '1h 10m' },
            { name: 'Triage Team', lead: 'Bharath Kumar', mttt: '28m' },
          ].map((team) => {
            const teamTickets = (liveBoard?.focus_queue || []).filter((item) =>
              item.ticket.current_team.toLowerCase().includes(team.name.toLowerCase().split(' ')[0])
            );

            return (
              <div
                key={team.name}
                className="platform-card"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink-primary)' }}>
                      {team.name}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--ink-tertiary)', marginTop: '2px' }}>
                      Lead: {team.lead} • MTTT: <strong style={{ color: 'var(--accent-teal)' }}>{team.mttt}</strong>
                    </div>
                  </div>
                  <span className="badge badge-magenta" style={{ fontSize: '11px', fontWeight: 800 }}>
                    {teamTickets.length} Assigned
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  {teamTickets.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-tertiary)', fontSize: '12px' }}>
                      No active incidents currently assigned to this team.
                    </div>
                  ) : (
                    teamTickets.map((item) => {
                      const t = item.ticket;
                      return (
                        <div
                          key={t.ticket_id}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '6px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '12px', color: 'var(--accent-rose)' }}>
                                {t.ticket_id}
                              </span>
                              <span className={`badge ${t.priority === 'P1' ? 'badge-rose' : 'badge-amber'}`}>
                                {t.priority}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--ink-primary)', fontWeight: 600, marginTop: '2px' }}>
                              {t.summary.slice(0, 42)}...
                            </div>
                          </div>

                          <button
                            onClick={() => setDrawerTicketId(t.ticket_id)}
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: '11px', flexShrink: 0 }}
                          >
                            Inspect
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* COMMENTS & EVIDENCE ACTIVITY STREAM VIEW */}
      {viewMode === 'comments_evidence' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flex: 1, paddingBottom: '20px' }}>
          {/* Left Column: Comments Feed */}
          <div
            className="platform-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={16} color="var(--accent-rose)" />
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
                  Recent Cross-Ticket Analyst Notes & Comments
                </h3>
              </div>
              <span className="badge badge-teal">Live Stream</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
              {(workspace?.events.filter((e) => e.event_type === 'TICKET_COMMENT') || []).length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-secondary)', fontSize: '12.5px' }}>
                  Open any ticket in the drawer to post notes and synchronized Jira comments.
                </div>
              ) : (
                workspace?.events
                  .filter((e) => e.event_type === 'TICKET_COMMENT')
                  .map((c) => (
                    <div
                      key={c.event_id}
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <strong style={{ color: 'var(--accent-rose)', fontFamily: "'JetBrains Mono', monospace" }}>{c.ticket_id}</strong>
                        <span style={{ color: 'var(--ink-tertiary)' }}>{new Date(c.occurred_at * 1000).toLocaleTimeString()}</span>
                      </div>
                      <p style={{ fontSize: '12.5px', color: 'var(--ink-primary)', margin: 0 }}>
                        {c.payload?.comment || c.summary}
                      </p>
                      <div style={{ fontSize: '11px', color: 'var(--ink-secondary)' }}>
                        By: {c.actor_id}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          {/* Right Column: Promoted Evidence Stream */}
          <div
            className="platform-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={16} color="var(--accent-teal)" />
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
                  Traceable Telemetry Evidence
                </h3>
              </div>
              <span className="badge badge-magenta">Cryptographically Bound</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
              {(workspace?.evidence || []).map((ev) => (
                <div
                  key={ev.evidence_id}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="badge badge-magenta" style={{ textTransform: 'uppercase', fontSize: '10.5px' }}>
                      {ev.source}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--accent-teal)', fontWeight: 700 }}>
                      {Math.round(ev.confidence * 100)}% Confidence
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ink-primary)', margin: 0, lineHeight: 1.4 }}>
                    {ev.summary}
                  </p>
                  {ev.query_ref && (
                    <div style={{ fontSize: '10.5px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-tertiary)' }}>
                      Ref: {ev.query_ref}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FOCUS QUEUE DESK VIEW (Original split-view) */}
      {viewMode === 'focus_queue' && (
        <>
          {/* Work Buckets Filter Strip */}
          <nav className="work-buckets-bar" aria-label="Work Buckets">
            {[
              { id: 'ALL', label: 'All Tickets' },
              { id: 'NEW', label: 'Need Action' },
              { id: 'IN_TRIAGE', label: 'In Triage' },
              { id: 'RETURNED', label: 'Returned to Triage' },
              { id: 'FOLLOW_UP', label: 'Follow-up' },
              { id: 'APP_TEAM', label: 'With App Teams' },
              { id: 'WAITING', label: 'Waiting / External' },
              { id: 'RESOLVED', label: 'Resolved' },
            ].map((bucket) => {
              const count = liveBoard?.work_buckets[bucket.id] ?? 0;
              return (
                <button
                  key={bucket.id}
                  type="button"
                  className={`bucket-pill ${activeBucket === bucket.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveBucket(bucket.id);
                    loadBoard(bucket.id, searchQuery);
                  }}
                >
                  <span>{bucket.label}</span>
                  <span className="bucket-badge">{count}</span>
                </button>
              );
            })}
          </nav>

          {/* Main 3-Column Workbench Layout */}
          <main className="triage-workbench-grid">
        {/* Left Column: Focus Queue */}
        <section className="focus-queue-panel" aria-label="Focus Queue">
          <div className="focus-queue-header">
            <h2>
              <ListOrdered size={15} color="var(--acc)" />
              Focus Queue
            </h2>
            <span className="focus-queue-sub">
              {liveBoard?.focus_queue.length ?? 0} actionable items
            </span>
          </div>

          <div className="focus-queue-list">
            {loading && !liveBoard ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                Loading focus queue…
              </div>
            ) : liveBoard?.focus_queue.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                No tickets matching current filter.
              </div>
            ) : (
              liveBoard?.focus_queue.map((item) => {
                const { ticket, sla, primary_action } = item;
                const isSelected = selectedTicketId === ticket.ticket_id;
                const riskClass =
                  sla.risk_state === 'BREACHED'
                    ? 'card-breached'
                    : sla.risk_state === 'AT_RISK'
                    ? 'card-at-risk'
                    : '';

                return (
                  <div
                    key={ticket.ticket_id}
                    className={`focus-ticket-card ${riskClass} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectTicket(ticket.ticket_id)}
                  >
                    <div className="card-top-row">
                      <div className="card-key-row">
                        <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>
                          {ticket.priority}
                        </span>
                        <span className="ticket-key">{ticket.ticket_id}</span>
                      </div>
                      <span className={`work-state-pill state-${ticket.work_state.toLowerCase().replace('_', '-')}`}>
                        {ticket.work_state.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="card-summary">{ticket.summary}</div>

                    <div className="card-sla-strip">
                      <span className="card-stay-time">
                        Stay: {sla.current_stay_formatted}
                      </span>
                      <span
                        className={`sla-countdown-badge sla-${sla.risk_state.toLowerCase().replace('_', '-')}`}
                      >
                        SLA: {sla.sla_remaining_formatted}
                      </span>
                    </div>

                    {/* SLA Progress Bar */}
                    <div className="sla-progress-track">
                      <div
                        className={`sla-progress-fill fill-${sla.risk_state.toLowerCase().replace('_', '-')}`}
                        style={{ width: `${Math.min(100, Math.round(sla.sla_utilization * 100))}%` }}
                      />
                    </div>

                    {/* Deterministic Explanation Box */}
                    <div className="card-explanation-box">{sla.explanation}</div>

                    <div className="card-footer-row">
                      <span className="card-owner-info">
                        <User size={12} />
                        {ticket.assignee || 'Unassigned'}
                      </span>
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectTicket(ticket.ticket_id);
                          if (primary_action === 'Start Triage' || primary_action === 'Resume') {
                            handleAcknowledge(ticket.ticket_id);
                          }
                        }}
                      >
                        {primary_action}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Center Column: Ticket Investigation Workspace */}
        <section className="triage-workspace-panel" aria-label="Ticket Investigation Workspace">
          {workspaceLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              Loading investigation workspace…
            </div>
          ) : !workspace ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              Select a ticket from the Focus Queue to begin investigation.
            </div>
          ) : (
            <>
              {/* Persistent Header */}
              <div className="workspace-persistent-header">
                <div className="header-top-meta">
                  <div className="header-tag-group">
                    <span className={`priority-chip priority-${workspace.ticket.priority.toLowerCase()}`}>
                      {workspace.ticket.priority}
                    </span>
                    <h2 className="workspace-ticket-title">
                      {workspace.ticket.ticket_id} • {workspace.ticket.summary}
                    </h2>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!workspace.ticket.assignee ? (
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={() => handleAcknowledge(workspace.ticket.ticket_id)}
                      >
                        Start / Claim Triage
                      </button>
                    ) : workspace.ticket.work_state === 'APP_TEAM' ? (
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={handleReturnToTriage}
                        title="Simulate team returning ticket to triage"
                      >
                        Return to Triage
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-tool-secondary"
                        onClick={() => setShowEscalateModal(true)}
                      >
                        Escalate / Transfer
                      </button>
                    )}
                  </div>
                </div>

                <div className="workspace-meta-pills">
                  <span className="meta-pill">
                    <b>Jira:</b> {workspace.ticket.status}
                  </span>
                  <span className="meta-pill">
                    <b>PRISM:</b> {workspace.investigation.state}
                  </span>
                  <span className="meta-pill">
                    <b>Team:</b> {workspace.ticket.current_team}
                  </span>
                  <span className="meta-pill">
                    <b>Owner:</b> {workspace.ticket.assignee || 'Unassigned'}
                  </span>
                  <span className="meta-pill">
                    <b>Env:</b> {workspace.ticket.environment || 'N/A'}
                  </span>
                  <span className="meta-pill">
                    <b>Service:</b> {workspace.ticket.service || 'N/A'}
                  </span>
                  <span className={`meta-pill sla-${workspace.sla.risk_state.toLowerCase().replace('_', '-')}`}>
                    <b>SLA:</b> {workspace.sla.sla_remaining_formatted} (Consumed: {workspace.sla.sla_consumed_formatted})
                  </span>
                </div>
              </div>

              {/* Sub-navigation Tabs */}
              <nav className="workspace-nav-tabs">
                {[
                  { id: 'overview', label: 'Overview', icon: FileText, count: undefined },
                  { id: 'autotriage', label: 'Auto Triage', icon: Sparkles, count: undefined },
                  { id: 'toolpane', label: 'Tool Pane', icon: Wrench, count: workspace.tool_proposals.length },
                  { id: 'evidence', label: 'Evidence & Findings', icon: ShieldCheck, count: workspace.evidence.length + workspace.findings.length },
                  { id: 'related', label: 'Related Tickets', icon: History, count: workspace.related_tickets.length },
                  { id: 'activity', label: 'Activity & Audit', icon: Activity, count: workspace.events.length },
                  { id: 'actions', label: 'Governed Actions', icon: Zap, count: workspace.governed_actions.length },
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`workspace-tab ${activeTab === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.id as WorkspaceTab)}
                    >
                      <Icon size={13} />
                      <span>{tab.label}</span>
                      {tab.count !== undefined && <span className="tab-badge">{tab.count}</span>}
                    </button>
                  );
                })}
              </nav>

              {/* Tab Body */}
              <div className="workspace-body-container">
                {/* TAB 1: OVERVIEW */}
                {activeTab === 'overview' && (
                  <div className="overview-tab-content">
                    {/* Description */}
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <FileSearch size={14} /> Description & Issue Context
                      </div>
                      <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--tx)' }}>
                        {workspace.ticket.description}
                      </p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {workspace.ticket.labels.map((lbl) => (
                          <span key={lbl} className="meta-pill">
                            #{lbl}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Assignment Journey */}
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <Layers size={14} /> Assignment Journey (SLA Accounting)
                      </div>
                      <div className="journey-steps-list">
                        {workspace.queue_stays.map((stay, idx) => (
                          <div key={stay.stay_id} className="journey-step-item">
                            <span className="journey-step-dot" />
                            <div className="journey-step-title">
                              Stay {idx + 1}: {stay.reason}
                            </div>
                            <div className="journey-step-meta">
                              Duration: {stay.accountable_duration > 0 ? `${Math.round(stay.accountable_duration / 60)}m` : 'In Progress'}{' '}
                              • {stay.previous_team ? `From ${stay.previous_team}` : 'Initial Entry'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* What Changed Since Triage */}
                    {workspace.investigation.what_changed.length > 0 && (
                      <div className="delta-changes-card">
                        <div className="journey-header">
                          <History size={14} /> What Changed Since Prior Triage
                        </div>
                        {workspace.investigation.what_changed.map((delta, idx) => (
                          <div key={idx} className="delta-item">
                            <span className="meta-pill" style={{ textTransform: 'capitalize' }}>
                              {delta.category.replace('_', ' ')}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                                {delta.author}
                              </div>
                              <div style={{ color: 'var(--muted)', marginTop: 2 }}>{delta.text}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: AUTO TRIAGE */}
                {activeTab === 'autotriage' && (
                  <div className="overview-tab-content">
                    <div className="journey-timeline-card" style={{ borderLeft: '3px solid var(--acc)' }}>
                      <div className="journey-header" style={{ color: 'var(--acc)' }}>
                        <Sparkles size={15} /> PRISM Autonomous RCA Summary (
                        {Math.round(workspace.investigation.auto_triage_summary.confidence * 100)}% confidence)
                      </div>
                      <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--tx)', margin: '4px 0 8px' }}>
                        {workspace.investigation.auto_triage_summary.executive_rca}
                      </p>
                      <div className="meta-pill">
                        <b>Suspected Failure Boundary:</b>{' '}
                        {workspace.investigation.auto_triage_summary.failure_boundary}
                      </div>
                    </div>

                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <Shield size={14} /> Investigated Hypotheses
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {workspace.investigation.auto_triage_summary.hypotheses.map((h, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: 'var(--card)',
                              border: '1px solid var(--line)',
                              padding: 12,
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx)' }}>
                                {h.title}
                              </span>
                              <span
                                className="meta-pill"
                                style={{
                                  color: h.status === 'CONFIRMED' ? 'var(--acc3)' : 'var(--muted)',
                                  fontWeight: 700,
                                }}
                              >
                                {h.status} ({Math.round(h.confidence * 100)}%)
                              </span>
                            </div>
                            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {h.details}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <CheckCircle2 size={14} /> Actionable Next Recommendation
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--tx)' }}>
                        {workspace.investigation.auto_triage_summary.recommendation}
                      </p>
                    </div>
                  </div>
                )}

                {/* TAB 3: CONTEXTUAL TOOL PANE */}
                {activeTab === 'toolpane' && (
                  <div className="tool-pane-container">
                    {/* Tool Selector Bar */}
                    <div className="tool-selector-bar">
                      {workspace.tool_proposals.map((prop) => (
                        <button
                          key={prop.proposal_id}
                          type="button"
                          className={`tool-tab-btn ${selectedProposalId === prop.proposal_id ? 'active' : ''}`}
                          onClick={() => handleToolTabSelect(prop)}
                        >
                          {prop.capability === 'splunk' && <Terminal size={13} />}
                          {prop.capability === 'oracle' && <Database size={13} />}
                          {prop.capability === 'signalfx' && <Cpu size={13} />}
                          {prop.capability === 'jira' && <FileSearch size={13} />}
                          <span>{prop.capability.toUpperCase()}</span>
                          {prop.is_recommended && (
                            <span style={{ color: 'var(--acc)', fontSize: 10 }}>★</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {currentProposal && (
                      <div className="tool-proposal-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx)', margin: 0 }}>
                            {currentProposal.title}
                          </h3>
                          <span className="work-state-pill">
                            Status: {currentProposal.status} ({currentProposal.execution_count} runs)
                          </span>
                        </div>

                        {/* Rationale */}
                        <div className="tool-rationale-box">
                          <b>Why this query?</b> {currentProposal.rationale}
                        </div>

                        {/* Editable Query Container */}
                        <div className="tool-editor-wrapper">
                          <div className="tool-editor-header">
                            <span>Query / Code Editor ({currentProposal.capability.toUpperCase()})</span>
                            <button
                              type="button"
                              className="btn-tool-secondary"
                              style={{ padding: '2px 6px', fontSize: 10 }}
                              onClick={() => setEditedQuery(currentProposal.generated_query)}
                            >
                              Reset to Template
                            </button>
                          </div>
                          <textarea
                            className="tool-query-textarea"
                            value={editedQuery}
                            onChange={(e) => setEditedQuery(e.target.value)}
                            rows={5}
                          />
                        </div>

                        {/* Action Bar */}
                        <div className="tool-action-bar">
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="btn-tool-run"
                              onClick={handleExecuteQuery}
                              disabled={executingTool}
                            >
                              <Play size={13} />
                              {executingTool ? 'Executing…' : 'Run Query'}
                            </button>
                            <button
                              type="button"
                              className="btn-tool-secondary"
                              onClick={handleSaveQuery}
                            >
                              Save Revision
                            </button>
                          </div>

                          {currentProposal.latest_result && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input
                                type="text"
                                placeholder="Summary for evidence bundle..."
                                value={evidenceSummary}
                                onChange={(e) => setEvidenceSummary(e.target.value)}
                                style={{
                                  fontSize: 11,
                                  padding: '4px 8px',
                                  minWidth: 200,
                                }}
                              />
                              <button
                                type="button"
                                className="btn-tool-secondary"
                                onClick={handlePromoteEvidence}
                                disabled={promotingEvidence || !evidenceSummary.trim()}
                              >
                                <Check size={12} /> Promote to Evidence
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Live Results Table */}
                        {currentProposal.latest_result && (
                          <div className="tool-results-card">
                            <div className="results-table-header">
                              <span>
                                Output: {currentProposal.latest_result.count} rows (
                                {currentProposal.latest_result.execution_time_ms}ms)
                              </span>
                              <span style={{ color: 'var(--acc3)' }}>
                                {currentProposal.latest_result.interpretation}
                              </span>
                            </div>

                            {currentProposal.latest_result.items &&
                            currentProposal.latest_result.items.length > 0 ? (
                              <div style={{ overflowX: 'auto', maxHeight: 220 }}>
                                <table className="results-table">
                                  <thead>
                                    <tr>
                                      {Object.keys(currentProposal.latest_result.items[0]).map((col) => (
                                        <th key={col}>{col}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {currentProposal.latest_result.items.map((row, rIdx) => (
                                      <tr key={rIdx}>
                                        {Object.values(row).map((val: any, cIdx) => (
                                          <td key={cIdx}>{String(val)}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>
                                Raw execution returned metadata only.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: EVIDENCE & FINDINGS */}
                {activeTab === 'evidence' && (
                  <div className="overview-tab-content">
                    {/* Findings Section */}
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <ShieldCheck size={14} /> Synthesized RCA Findings
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {workspace.findings.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            No findings synthesized yet.
                          </div>
                        ) : (
                          workspace.findings.map((finding) => (
                            <div
                              key={finding.finding_id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--card)',
                                border: '1px solid var(--line)',
                                padding: 12,
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              <div style={{ flex: 1, paddingRight: 16 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx)', margin: 0 }}>
                                  {finding.statement}
                                </p>
                                <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                                  Confidence: {Math.round(finding.confidence * 100)}% • Supported by {finding.evidence_refs.length} evidence sources
                                </span>
                              </div>
                              <button
                                type="button"
                                className="btn-tool-secondary"
                                onClick={() => handleToggleFinding(finding.finding_id, finding.status)}
                                style={{
                                  color: finding.status === 'CONFIRMED' ? 'var(--acc3)' : 'var(--muted)',
                                  borderColor: finding.status === 'CONFIRMED' ? 'var(--acc3)' : 'var(--line)',
                                }}
                              >
                                {finding.status === 'CONFIRMED' ? 'Confirmed' : 'Confirm Finding'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Evidence Observations */}
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <Database size={14} /> Collected Observations & Diagnostic Output
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {workspace.evidence.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            No evidence items promoted yet. Run queries in the Tool Pane to promote outputs.
                          </div>
                        ) : (
                          workspace.evidence.map((ev) => (
                            <div
                              key={ev.evidence_id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--card)',
                                border: '1px solid var(--line)',
                                padding: 12,
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span className="priority-chip priority-p3" style={{ textTransform: 'uppercase' }}>
                                    {ev.source}
                                  </span>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx)' }}>
                                    {ev.summary}
                                  </span>
                                </div>
                                {ev.query_ref && (
                                  <code
                                    style={{
                                      display: 'block',
                                      fontSize: 11,
                                      color: 'var(--muted)',
                                      marginTop: 4,
                                      background: 'var(--card-subtle)',
                                      padding: '3px 6px',
                                      borderRadius: 3,
                                    }}
                                  >
                                    {ev.query_ref}
                                  </code>
                                )}
                              </div>
                              <button
                                type="button"
                                className="btn-tool-secondary"
                                onClick={() => handleToggleEvidence(ev.evidence_id, ev.status)}
                                style={{
                                  color: ev.status === 'ACCEPTED' ? 'var(--acc3)' : 'var(--muted)',
                                  borderColor: ev.status === 'ACCEPTED' ? 'var(--acc3)' : 'var(--line)',
                                }}
                              >
                                {ev.status === 'ACCEPTED' ? 'Accepted' : 'Accept'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 5: RELATED TICKETS */}
                {activeTab === 'related' && (
                  <div className="overview-tab-content">
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <History size={14} /> Discovered Similar Historical Incidents
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {workspace.related_tickets.map((rel) => (
                          <div
                            key={rel.ticket_id}
                            style={{
                              background: 'var(--card)',
                              border: '1px solid var(--line)',
                              padding: 14,
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', fontFamily: 'var(--font-mono)' }}>
                                {rel.ticket_id} • {rel.summary}
                              </span>
                              <span className="meta-pill" style={{ color: 'var(--acc3)', fontWeight: 700 }}>
                                {Math.round(rel.similarity * 100)}% Similarity
                              </span>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                              <p style={{ margin: '2px 0', color: 'var(--muted)' }}>
                                <b>Root Cause:</b> {rel.root_cause}
                              </p>
                              <p style={{ margin: '2px 0', color: 'var(--tx)' }}>
                                <b>Resolution:</b> {rel.resolution}
                              </p>
                              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--dim)' }}>
                                Resolved {rel.resolved_at} by {rel.resolved_by}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 6: ACTIVITY & AUDIT */}
                {activeTab === 'activity' && (
                  <div className="overview-tab-content">
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <Activity size={14} /> Chronological Audit Log
                      </div>
                      <div className="journey-steps-list">
                        {workspace.events.map((ev) => (
                          <div key={ev.event_id} className="journey-step-item">
                            <span className="journey-step-dot" />
                            <div className="journey-step-title">
                              [{ev.actor_type}] {ev.summary}
                            </div>
                            <div className="journey-step-meta">
                              Actor: {ev.actor_id} •{' '}
                              {new Date(ev.occurred_at * 1000).toLocaleTimeString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 7: GOVERNED ACTIONS */}
                {activeTab === 'actions' && (
                  <div className="overview-tab-content">
                    <div className="journey-timeline-card">
                      <div className="journey-header">
                        <Zap size={14} /> Governed Action Proposals (Explicit Human Approval Required)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {workspace.governed_actions.map((act) => (
                          <div
                            key={act.action_id}
                            style={{
                              background: 'var(--card)',
                              border: '1px solid var(--line)',
                              padding: 16,
                              borderRadius: 'var(--radius-sm)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <h4 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                                  {act.title}
                                </h4>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                  Target: <b>{act.target}</b> • Proposed by {act.requested_by}
                                </span>
                              </div>
                              <span
                                className="work-state-pill"
                                style={{
                                  color: act.status === 'EXECUTED' ? 'var(--acc3)' : 'var(--acc-amber)',
                                }}
                              >
                                {act.status}
                              </span>
                            </div>

                            {/* Payload Preview */}
                            <pre
                              style={{
                                background: 'var(--card-subtle)',
                                padding: 10,
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 11,
                                fontFamily: 'var(--font-mono)',
                                overflowX: 'auto',
                                margin: 0,
                              }}
                            >
                              {JSON.stringify(act.payload, null, 2)}
                            </pre>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              {act.status === 'PROPOSED' ? (
                                <button
                                  type="button"
                                  className="btn-tool-run"
                                  onClick={() => handleApproveAction(act.action_id)}
                                  disabled={approvingActionId === act.action_id}
                                >
                                  <ShieldCheck size={13} />
                                  {approvingActionId === act.action_id ? 'Executing…' : 'Approve & Execute'}
                                </button>
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--acc3)', fontWeight: 600 }}>
                                  ✓ Executed by {act.approved_by || 'Analyst'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Right Column: Team Capacity, Connectors & Performance Metrics */}
        <aside className="triage-team-column" aria-label="Triage Team & Health">
          {/* Triage Team Capacity */}
          <div className="team-sidebar-panel">
            <h3 className="panel-title">
              <Users size={14} color="var(--acc)" />
              Triage Team Activity
            </h3>
            <div>
              {liveBoard?.team_capacity.map((analyst) => (
                <div key={analyst.name} className="analyst-list-item">
                  <div className="analyst-info">
                    <span className="analyst-name">{analyst.name}</span>
                    <span className="analyst-sub">{analyst.role}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="meta-pill" style={{ fontSize: 10 }}>
                      {analyst.active_tickets} active
                    </span>
                    {analyst.current_ticket && (
                      <span style={{ fontSize: 9.5, display: 'block', color: 'var(--muted)', marginTop: 2 }}>
                        {analyst.current_ticket}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Connectors Health */}
          <div className="team-sidebar-panel">
            <h3 className="panel-title">
              <ShieldCheck size={14} color="var(--acc3)" />
              Connectors Health
            </h3>
            <div>
              {liveBoard?.connectors_health.map((conn) => (
                <div key={conn.connector} className="connector-status-row">
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="status-dot-green" />
                    <b>{conn.connector}</b>
                  </span>
                  <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {conn.latency_ms}ms
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="team-sidebar-panel">
            <h3 className="panel-title">
              <TrendingUp size={14} color="var(--acc)" />
              Triage Performance
            </h3>
            {liveBoard && (
              <div className="metric-grid-2x2">
                <div className="metric-tile">
                  <span className="metric-tile-val">{liveBoard.performance_metrics.mttt}</span>
                  <span className="metric-tile-label">Mean Time to Triage</span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-val">{liveBoard.performance_metrics.auto_triage_success_rate}</span>
                  <span className="metric-tile-label">Auto-Triage Success</span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-val">{liveBoard.performance_metrics.analyst_validation_rate}</span>
                  <span className="metric-tile-label">Analyst Validation</span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-val">{liveBoard.performance_metrics.rca_accuracy_rate}</span>
                  <span className="metric-tile-label">RCA Accuracy</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
      </>
      )}

      {/* Escalate Modal */}
      {showEscalateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 24,
              width: 440,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--tx)' }}>
              Escalate {selectedTicketId} to Engineering Team
            </h3>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                Target Application / Resolver Team
              </label>
              <select
                value={targetTeam}
                onChange={(e) => setTargetTeam(e.target.value)}
                style={{ width: '100%', padding: 8, marginTop: 4 }}
              >
                <option value="Billing Platform Team">Billing Platform Team</option>
                <option value="Core NetOps">Core NetOps</option>
                <option value="Payment Gateway Team">Payment Gateway Team</option>
                <option value="Data Platform Team">Data Platform Team</option>
                <option value="Identity & SSO Team">Identity & SSO Team</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                Handoff Note / Rationale
              </label>
              <textarea
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                rows={3}
                placeholder="Diagnostic findings validated; transferring ownership..."
                style={{ width: '100%', padding: 8, marginTop: 4 }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn-tool-secondary"
                onClick={() => setShowEscalateModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-tool-run"
                onClick={handleEscalateSubmit}
              >
                Confirm Handoff
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Ticket Detail Drawer */}
      {drawerTicketId && (
        <TicketDetailPanel
          ticketId={drawerTicketId}
          onClose={() => setDrawerTicketId(null)}
          onTicketUpdated={() => loadBoard()}
        />
      )}
    </div>
  );
};
