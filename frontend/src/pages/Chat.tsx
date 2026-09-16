import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Brain,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { RunKnowledgeSelector, type RunKnowledgeSelection } from '../components/RunKnowledgeSelector';
import { AnswerMarkdown } from '../components/AnswerMarkdown';
import { ChatFiles } from '../components/ChatFiles';
import { RunFeedback } from '../components/RunFeedback';
import { RunConnectorSelectors, useRunConnectorSelections, loadRunConnectorGroups, connectorSelectionsReady } from '../components/RunConnectorSelectors';
import { ChatThinkingAccordion } from '../components/chat/ChatThinkingAccordion';
import { ChatVisualCard } from '../components/chat/ChatVisualCard';
import { ChatExecutiveBrief } from '../components/chat/ChatExecutiveBrief';
import {
  cancelRun,
  fetchRun,
  fetchCapabilities,
  fetchConfig,
  fetchRunEvidence,
  fetchRunTrace,
  mapRun,
  uploadInvestigationFiles,
} from '../services/api';
import type { RunEvidence, RunTraceEvent } from '../services/api';
import {
  CHAT_PAGE_SIZE,
  CHAT_MESSAGE_PAGE_SIZE,
  createConversation,
  fetchConversations,
  fetchConversationRuns,
  fetchConversationMessages,
  resolveChatQuestion,
} from '../services/chat';
import type { Conversation, ChatMessage } from '../services/chat';
import { streamStudioRun } from '../features/harness-studio/harnessApi';
import type { CapabilityItem, Run, RuntimeConfig } from '../types/api';
import './chat.css';

const stageLabels: Record<string, string> = {
  itsm: 'Ticket system',
  log_search: 'Logs',
  root: 'Investigation',
  knowledge: 'Project knowledge',
  get_ticket: 'Read a ticket',
  query_range: 'Search logs',
  triage: 'Reviewing the incident',
  logs: 'Checking logs',
  extraction: 'Reviewing documents',
  queued: 'Starting your investigation',
  accepted: 'Starting your investigation',
  orchestrator: 'Understanding your question',
  request_orchestrator: 'Understanding your question',
  rca_synthesizer: 'Preparing the answer',
  context: 'Relevant project context',
  planning: 'Planning the investigation',
  ingestion: 'Reading the evidence',
  collection: 'Gathering evidence',
  retrieval: 'Finding relevant information',
  analysis: 'Checking possible causes',
  synthesis: 'Bringing the findings together',
  validation: 'Checking the answer against its sources',
  completed: 'Investigation complete',
  file_parser: 'Reading your files',
  attachment_review: 'Reviewing files and project knowledge',
};

const investigationNames: Record<string, string> = {
  attachment_review: 'Files & project knowledge',
  incident_triage: 'Investigate an incident',
  ticket_review: 'Review a ticket',
  incident_timeline: 'Build an incident timeline',
  log_correlation: 'Investigate logs',
};

const readable = (value: string) => {
  const key = value.replace(/^(agent|tool|workflow):/, '');
  return key.startsWith('model:') ? 'Model response' : stageLabels[key] || key.replace(/[_-]/g, ' ');
};

const short = (value: string, limit = 280) =>
  value.length <= limit ? value : `${value.slice(0, limit).replace(/\s+\S*$/, '')}…`;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

const active = (run: Run) => run.status === 'RUNNING' || run.status === 'QUEUED';
const terminal = (run: Run) => ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'SIMULATED', 'PARTIAL'].includes(run.status);

const statusText: Partial<Record<Run['status'], string>> = {
  COMPLETED: 'Complete',
  PARTIAL: 'Some evidence is missing',
  BLOCKED: 'Needs your attention',
  FAILED: 'Could not finish',
  CANCELLED: 'Stopped',
  SIMULATED: 'Demo result',
};

function CompactText({ text, limit = 280 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <AnswerMarkdown text={expanded ? text : short(text, limit)} />
      {text.length > limit && (
        <button
          type="button"
          className="chat-text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  );
}

function splitSourceFields(entries: [string, unknown][]) {
  const priority = [
    'title',
    'summary',
    'key',
    'status',
    'excerpt',
    'text',
    'description',
    'content',
    'body',
    'created',
    'timestamp',
  ];
  const metadataKeys = new Set([
    'contenthash',
    'docid',
    'documentid',
    'excerptstart',
    'excerptend',
    'reviewedat',
    'reviewersubject',
    'authorsubject',
    'revision',
    'sha256',
    'attachmentid',
    'artifactid',
    'evidenceid',
    'tenantid',
    'projectid',
    'createdat',
    'updatedat',
    'expiresat',
    'sizebytes',
    'mediatype',
  ]);
  const metadata = (key: string) => metadataKeys.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
  const content = entries
    .filter(([key]) => !metadata(key))
    .sort(([left], [right]) => {
      const rank = (key: string) =>
        priority.includes(key.toLowerCase()) ? priority.indexOf(key.toLowerCase()) : priority.length;
      return rank(left) - rank(right);
    });
  return {
    primary: content.slice(0, 6),
    details: [...content.slice(6), ...entries.filter(([key]) => metadata(key))],
  };
}

function EvidenceView({ evidence }: { evidence: RunEvidence }) {
  let content: unknown = evidence.content_json;
  try {
    content = JSON.parse(evidence.content_json);
  } catch {
    /* Plain text evidence remains readable. */
  }
  const entries =
    content && typeof content === 'object' && !Array.isArray(content)
      ? Object.entries(content).filter(
          ([, value]) =>
            value !== null &&
            value !== '' &&
            (typeof value !== 'object' || Object.keys(value).length > 0),
        )
      : null;
  const sections = entries ? splitSourceFields(entries) : null;
  const fields = (items: [string, unknown][]) => (
    <dl>
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{readable(key)}</dt>
          <dd>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="chat-source-content">
      {sections ? (
        <>
          {!!sections.primary.length && fields(sections.primary)}
          {!!sections.details.length && (
            <details>
              <summary>More source details</summary>
              {fields(sections.details)}
            </details>
          )}
          {!sections.primary.length && !sections.details.length && (
            <p>No readable source fields were recorded.</p>
          )}
        </>
      ) : (
        <p>{typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</p>
      )}
    </div>
  );
}

export function Chat({
  initialCapability,
  requestVersion = 0,
  onRunUpdated,
  onOpenRun,
}: {
  initialCapability?: string;
  requestVersion?: number;
  onRunUpdated: (run: Run) => void;
  onOpenRun: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [capability, setCapability] = useState('');
  const connectorScope = useRunConnectorSelections(capability);
  const [knowledgeSelection, setKnowledgeSelection] = useState<RunKnowledgeSelection>({ environmentId: '', documentIds: [] });
  const [question, setQuestion] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [retainedAttachmentIds, setRetainedAttachmentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<RunEvidence[]>([]);
  const [events, setEvents] = useState<RunTraceEvent[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [panel, setPanel] = useState<'brief' | 'sources' | 'activity' | 'files'>('brief');
  const [panelOpen, setPanelOpen] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [focusedSource, setFocusedSource] = useState<string | null>(null);
  const [durationEvent, setDurationEvent] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const currentRun = useRef<string | null>(null);
  const submissionInFlight = useRef(false);
  const pendingAttempt = useRef<{ fingerprint: string; key: string; runId?: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const conversationRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const operation = useRef(0);
  const contextPanel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const activeRunKey = runs.filter(active).map(run => run.id).join(',');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      controller.current?.abort();
      historyRequest.current?.abort();
      conversationRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    historyRequest.current?.abort();
    const request = new AbortController();
    historyRequest.current = request;
    setLoading(true);
    setHistoryLoading(false);
    setHistoryError(null);
    setError(null);
    Promise.all([fetchCapabilities(), fetchConfig(), fetchConversations({ signal: request.signal })])
      .then(([available, settings, history]) => {
        const items = available.filter(item => item.is_authorized && item.runtime_supported !== false);
        if (cancelled) return;
        setCapabilities(items);
        setConfig(settings);
        setConversations(history);
        setHistoryHasMore(history.length === CHAT_PAGE_SIZE);
        setCapability(previous =>
          items.find(item => item.id === initialCapability)?.id ||
          items.find(item => item.id === previous)?.id ||
          '',
        );
      })
      .catch(err => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (historyRequest.current === request) historyRequest.current = null;
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      request.abort();
    };
  }, [attempt, initialCapability]);

  useEffect(() => {
    if (requestVersion && !busy && !submissionInFlight.current) {
      pendingAttempt.current = null;
      operation.current++;
      conversationRequest.current?.abort();
      conversationRequest.current = null;
      setLoading(false);
      setOlderLoading(false);
      setOlderError(null);
      setRunsHasMore(false);
      setMessagesHasMore(false);
      setChatId(null);
      setRuns([]);
      setMessages([]);
      setSelectedRun(null);
      setQuestion('');
      setFiles([]);
      setRetainedAttachmentIds([]);
      setFileCount(0);
      composer.current?.focus();
    }
    // A new chat is an explicit action, not a side effect of streaming updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestVersion]);

  useEffect(() => {
    if (!busy && !question.trim() && !files.length) return;
    const guard = (event: Event) => {
      if (busy) {
        event.preventDefault();
        setError('Stop the current investigation before leaving this conversation.');
      } else if (!window.confirm('Leave this conversation? Your unsent message and attachments will be discarded.')) {
        event.preventDefault();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('rca:before-navigation', guard);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('rca:before-navigation', guard);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [busy, question, files.length]);

  useEffect(() => {
    if (busy || !activeRunKey) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const values = await Promise.all(activeRunKey.split(',').map(fetchRun));
        if (cancelled) return;
        values.forEach(upsertRun);
        if (values.some(run => !active(run))) setDetailRevision(value => value + 1);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Read persisted status when a conversation is reopened, including request-bound cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, activeRunKey]);

  useEffect(() => {
    if (!panelOpen) return;
    const currentPanel = contextPanel.current;
    if (!currentPanel) return;
    currentPanel.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPanelOpen(false);
      }
      if (event.key === 'Tab' && window.matchMedia('(max-width: 850px)').matches) {
        const focusable = Array.from(
          currentPanel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), summary, a[href], [tabindex="0"]',
          ),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === currentPanel)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === currentPanel)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    currentPanel.addEventListener('keydown', keydown);
    return () => {
      currentPanel.removeEventListener('keydown', keydown);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen || panel === 'files') return;
    if (!selectedRun) {
      setEvidence([]);
      setEvents([]);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    setDetailError(null);
    setEvidence([]);
    setEvents([]);
    setDurationEvent(null);
    Promise.allSettled([fetchRunEvidence(selectedRun), fetchRunTrace(selectedRun)])
      .then(([sources, trace]) => {
        if (cancelled) return;
        const errors: string[] = [];
        if (sources.status === 'fulfilled') setEvidence(sources.value);
        else errors.push(`Sources could not be loaded: ${errorText(sources.reason)}`);
        if (trace.status === 'fulfilled') {
          setEvents(trace.value.events);
          if (trace.value.truncated) errors.push('Only the most recent saved activity is available for this investigation.');
        } else errors.push(`Activity could not be loaded: ${errorText(trace.reason)}`);
        setDetailError(errors.length ? errors.join(' ') : null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRun, detailRevision, panelOpen, panel]);

  useEffect(() => {
    if (busy && runs.length) {
      document.getElementById(`answer-${runs.at(-1)?.id}`)?.scrollIntoView({ block: 'start' });
    }
    // Move to a newly started answer once; later updates leave the reader in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.length]);

  const chooseConversation = async (id: string | null) => {
    if (busy || submissionInFlight.current) return;
    if (
      (question.trim() || files.length) &&
      !window.confirm('Start another conversation? Your unsent message and attachments will be discarded.')
    ) {
      return;
    }
    currentRun.current = null;
    if (id !== chatId || !id) pendingAttempt.current = null;
    const turn = ++operation.current;
    conversationRequest.current?.abort();
    conversationRequest.current = null;
    setOlderLoading(false);
    setOlderError(null);
    setRunsHasMore(false);
    setMessagesHasMore(false);
    setHistoryOpen(false);
    setError(null);
    setSelectedRun(null);
    setEvents([]);
    setEvidence([]);
    setFiles([]);
    setRetainedAttachmentIds([]);
    setQuestion('');
    setRuns([]);
    setMessages([]);
    setFileCount(0);
    setCapability('');
    setChatId(id);
    if (!id) {
      setLoading(false);
      composer.current?.focus();
      return;
    }
    const request = new AbortController();
    conversationRequest.current = request;
    setLoading(true);
    try {
      const [values, savedMessages] = await Promise.all([
        fetchConversationRuns(id, { signal: request.signal }),
        fetchConversationMessages(id, { signal: request.signal }),
      ]);
      if (!mounted.current || turn !== operation.current) return;
      if (values.some(run => run.id === pendingAttempt.current?.runId && terminal(run))) pendingAttempt.current = null;
      setRuns(values);
      setRunsHasMore(values.length === CHAT_PAGE_SIZE);
      setSelectedRun(values.at(-1)?.id || null);
      setMessages(savedMessages);
      setMessagesHasMore(savedMessages.length === CHAT_MESSAGE_PAGE_SIZE);
    } catch (err) {
      if (mounted.current && turn === operation.current) setError(errorText(err));
    } finally {
      if (conversationRequest.current === request) conversationRequest.current = null;
      if (mounted.current && turn === operation.current) setLoading(false);
    }
  };

  const loadMoreConversations = async () => {
    if (loading || historyRequest.current || !historyHasMore || !conversations.length) return;
    const request = new AbortController();
    historyRequest.current = request;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await fetchConversations({ before: conversations.at(-1)!.created_at, signal: request.signal });
      if (!mounted.current || request.signal.aborted || historyRequest.current !== request) return;
      setConversations(previous => [...previous, ...page.filter(item => !previous.some(saved => saved.chat_id === item.chat_id))]);
      setHistoryHasMore(page.length === CHAT_PAGE_SIZE);
    } catch (err) {
      if (mounted.current && !request.signal.aborted && historyRequest.current === request) setHistoryError(errorText(err));
    } finally {
      if (historyRequest.current === request) {
        historyRequest.current = null;
        if (mounted.current) setHistoryLoading(false);
      }
    }
  };

  const loadEarlierTurns = async () => {
    if (!chatId || loading || busy || conversationRequest.current || !(runsHasMore || messagesHasMore)) return;
    const turn = operation.current;
    const request = new AbortController();
    conversationRequest.current = request;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const [olderRuns, olderMessages] = await Promise.all([
        runsHasMore ? fetchConversationRuns(chatId, { before: Number(runs[0].raw?.created_at), signal: request.signal }) : Promise.resolve([]),
        messagesHasMore ? fetchConversationMessages(chatId, { before: messages[0].sequence, signal: request.signal }) : Promise.resolve([]),
      ]);
      if (!mounted.current || request.signal.aborted || turn !== operation.current) return;
      setRuns(previous => [...olderRuns.filter(item => !previous.some(saved => saved.id === item.id)), ...previous]);
      setMessages(previous => [...olderMessages.filter(item => !previous.some(saved => saved.id === item.id)), ...previous]);
      if (runsHasMore) setRunsHasMore(olderRuns.length === CHAT_PAGE_SIZE);
      if (messagesHasMore) setMessagesHasMore(olderMessages.length === CHAT_MESSAGE_PAGE_SIZE);
    } catch (err) {
      if (mounted.current && !request.signal.aborted && turn === operation.current) setOlderError(errorText(err));
    } finally {
      if (conversationRequest.current === request) {
        conversationRequest.current = null;
        if (mounted.current) setOlderLoading(false);
      }
    }
  };

  const upsertRun = (run: Run) => {
    if (pendingAttempt.current?.runId === run.id && terminal(run)) pendingAttempt.current = null;
    setRuns(previous =>
      previous.some(item => item.id === run.id)
        ? previous.map(item =>
            item.id === run.id && Number(run.raw?.revision || 0) >= Number(item.raw?.revision || 0)
              ? run
              : item,
          )
        : [...previous, run],
    );
    onRunUpdated(run);
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submissionInFlight.current || busy || runs.some(active) || loading || !config || !question.trim() || !connectorScope.ready) return;
    setError(null);
    const limits = config.file_limits;
    if (files.length > limits.max_files) {
      setError(`Choose up to ${limits.max_files} files.`);
      return;
    }
    if (
      files.some(
        file =>
          !limits.allowed_extensions.some(ext => file.name.toLowerCase().endsWith(ext.toLowerCase())),
      )
    ) {
      setError(`Supported files: ${limits.allowed_extensions.join(', ')}`);
      return;
    }
    if (files.some(file => file.size > limits.max_file_bytes)) {
      setError(`Each file must be smaller than ${(limits.max_file_bytes / 1048576).toFixed(1)} MB.`);
      return;
    }
    if (files.reduce((size, file) => size + file.size, 0) > config.execution.max_upload_batch_bytes) {
      setError('These files exceed the total upload size. Remove a file and try again.');
      return;
    }
    const sentQuestion = question.trim();
    submissionInFlight.current = true;
    const connectorSelections = { ...connectorScope.selections };
    conversationRequest.current?.abort();
    conversationRequest.current = null;
    setOlderLoading(false);
    setBusy(true);
    setEvents([]);
    setEvidence([]);
    setQuestion('');
    setPendingQuestion(sentQuestion);
    setPhase(files.length ? 'Reading your attachments' : 'Starting your investigation');
    currentRun.current = null;
    controller.current = new AbortController();
    try {
      let conversationId = chatId;
      if (!conversationId) {
        const conversation = await createConversation();
        if (!mounted.current) return;
        conversationId = conversation.chat_id;
        setChatId(conversationId);
        setConversations(previous => [{ ...conversation, title: sentQuestion }, ...previous]);
      }
      let attachmentIds: string[] = retainedAttachmentIds;
      if (files.length) {
        const uploaded = await uploadInvestigationFiles(files, conversationId);
        if (!mounted.current) return;
        attachmentIds = [...attachmentIds, ...uploaded.attachments.map(item => item.attachment_id)];
        setRetainedAttachmentIds(attachmentIds);
        setFiles([]);
      }
      if (controller.current.signal.aborted) return;
      let selectedCapability = capability;
      if (!selectedCapability) {
        setPhase('Understanding your question');
        const resolution = await resolveChatQuestion(
          { chat_id: conversationId, prompt: sentQuestion, attachment_ids: attachmentIds, knowledge_document_ids: knowledgeSelection.documentIds, environment_id: knowledgeSelection.environmentId || undefined },
          controller.current.signal,
        );
        if (!mounted.current || controller.current.signal.aborted) return;
        if (resolution.status !== 'ready' || !resolution.capability) {
          const savedMessages = await fetchConversationMessages(conversationId);
          if (!mounted.current || controller.current.signal.aborted) return;
          setMessages(previous => [...previous.filter(item => !savedMessages.some(saved => saved.id === item.id)), ...savedMessages]);
          if (!messages.length) setMessagesHasMore(savedMessages.length === CHAT_MESSAGE_PAGE_SIZE);
          setFiles([]);
          setRetainedAttachmentIds([]);
          setDetailRevision(value => value + 1);
          setConversations(previous =>
            previous.map(item =>
              item.chat_id === conversationId ? { ...item, title: sentQuestion } : item,
            ),
          );
          return;
        }
        selectedCapability = resolution.capability;
        const groups = await loadRunConnectorGroups(selectedCapability);
        if (!mounted.current || controller.current.signal.aborted) return;
        if (!connectorSelectionsReady(groups, connectorSelections)) {
          setCapability(selectedCapability);
          setQuestion(draft => draft || sentQuestion);
          setRetainedAttachmentIds(attachmentIds);
          setFiles([]);
          setError('Choose the sources for this investigation, then send your question again.');
          return;
        }
        setPhase(resolution.message);
      }
      const fingerprint = JSON.stringify({
        chat_id: conversationId,
        capability: selectedCapability,
        knowledgeSelection,
        prompt: sentQuestion,
        attachment_ids: attachmentIds,
        connector_selections: Object.fromEntries(Object.entries(connectorSelections).sort(([left], [right]) => left.localeCompare(right)).map(([name, selection]) => [name, { instance_id: selection.instance_id, environment_id: selection.environment_id }])),
      });
      if (pendingAttempt.current?.fingerprint !== fingerprint) pendingAttempt.current = { fingerprint, key: crypto.randomUUID() };
      const idempotencyKey = pendingAttempt.current.key;
      await streamStudioRun(
        selectedCapability,
        sentQuestion,
        update => {
          if (!mounted.current) return;
          if (update.type === 'run' && typeof update.data.run_id === 'string') {
            currentRun.current = update.data.run_id;
            if (pendingAttempt.current?.key === idempotencyKey) pendingAttempt.current.runId = update.data.run_id;
            setSelectedRun(update.data.run_id);
          }
          if (['progress', 'complete'].includes(update.type) && typeof update.data.run_id === 'string') {
            const run = mapRun(update.data);
            currentRun.current = run.id;
            if (pendingAttempt.current?.key === idempotencyKey) pendingAttempt.current.runId = run.id;
            upsertRun(run);
            setPendingQuestion('');
            setSelectedRun(run.id);
            setPhase(readable(String(update.data.stage || 'analysis')));
          }
          if (update.type === 'trace') {
            setEvents(previous => [...previous, update.data as RunTraceEvent].slice(-2000));
          }
          if (update.type === 'error') {
            if (typeof update.data.run_id === 'string' && ['FAILED', 'BLOCKED', 'CANCELLED'].includes(String(update.data.status))) {
              if (pendingAttempt.current?.key === idempotencyKey) pendingAttempt.current.runId = update.data.run_id;
              upsertRun(mapRun(update.data));
            }
            throw new Error(
              String(update.data.detail || update.data.reason || 'The investigation could not finish.'),
            );
          }
        },
        controller.current.signal,
        { chatId: conversationId, attachmentIds, connectorSelections, idempotencyKey, knowledgeSelection },
      );
      if (mounted.current) {
        setFiles([]);
        setRetainedAttachmentIds([]);
        setCapability('');
        setConversations(previous =>
          previous.map(item =>
            item.chat_id === conversationId ? { ...item, title: sentQuestion } : item,
          ),
        );
      }
    } catch (err) {
      if (mounted.current && !(err instanceof Error && err.name === 'AbortError')) {
        setError(errorText(err));
        setQuestion(draft => draft || sentQuestion);
        if (currentRun.current) {
          try {
            const saved = await fetchRun(currentRun.current);
            if (mounted.current) upsertRun(saved);
          } catch {
            /* Preserve the primary error and the reload action. */
          }
        }
      }
    } finally {
      submissionInFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        setStopping(false);
        setPendingQuestion('');
        setDetailRevision(value => value + 1);
        composer.current?.focus({ preventScroll: true });
      }
    }
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const runId = busy ? currentRun.current : runs.find(active)?.id;
      if (runId) upsertRun(await cancelRun(runId));
      controller.current?.abort();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setStopping(false);
    }
  };

  const inspect = (
    id: string,
    tab: 'brief' | 'sources' | 'activity' | 'files',
    source?: string,
  ) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedRun(id);
    setPanel(tab);
    setPanelOpen(true);
    setFocusedSource(source || null);
  };

  const handleCopySummary = async (runId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRunId(runId);
      setTimeout(() => setCopiedRunId(null), 2000);
    } catch {
      setError('Could not copy the summary. Select the text and copy it manually.');
    }
  };

  const handleSelectStarter = (promptText: string, starterCapability?: string) => {
    if (busy) return;
    if (
      question.trim() &&
      !window.confirm('Replace your current question with this investigation starter?')
    ) {
      return;
    }
    setQuestion(promptText);
    if (starterCapability) setCapability(starterCapability);
    composer.current?.focus();
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    if (!busy && config) setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (busy || !config) return;
    const droppedFiles = Array.from(event.dataTransfer.files || []);
    if (droppedFiles.length) {
      setFiles(previous => [...previous, ...droppedFiles]);
    }
  };

  const timedEvents = events.filter(
    item =>
      typeof item.details?.duration_ms === 'number' &&
      Number.isFinite(item.details.duration_ms) &&
      item.details.duration_ms >= 0,
  );
  const maxDuration = Math.max(1, ...timedEvents.map(item => Number(item.details?.duration_ms)));
  const activity = events.filter(item => !['agent_event', 'state_delta'].includes(String(item.kind)));
  const visibleActivity = activity.slice(-50);
  const selected = runs.find(run => run.id === selectedRun);
  const anyActive = runs.some(active);

  const turns = [
    ...runs.map(run => ({
      kind: 'run' as const,
      run,
      time: Number(run.raw?.created_at) * 1000 || Date.parse(run.created_at) || 0,
    })),
    ...messages.map(message => ({
      kind: 'message' as const,
      message,
      time: message.created_at * 1000,
    })),
  ].sort((left, right) => left.time - right.time);

  const filteredConversations = conversations.filter(item => {
    if (!historySearch.trim()) return true;
    return (item.title || 'Untitled conversation')
      .toLowerCase()
      .includes(historySearch.trim().toLowerCase());
  });

  const availableStarters = [
    {
      label: 'Summarize incident activity',
      prompt: 'Summarize the recent incident activity, open alerts, and suspected service degradation across our systems.',
    },
    {
      label: 'Review attached diagnostics',
      prompt: 'Review the attached diagnostic files and identify any error patterns, anomalies, or potential root causes.',
    },
    ...(capabilities.some(c => c.id === 'incident_triage')
      ? [
          {
            label: 'Triage an incident ticket',
            capability: 'incident_triage',
            prompt: 'Triage the recent incident ticket: assess priority, impacted dependencies, and immediate mitigation steps.',
          },
        ]
      : []),
    ...(capabilities.some(c => c.id === 'log_correlation')
      ? [
          {
            label: 'Investigate logs & errors',
            capability: 'log_correlation',
            prompt: 'Investigate the error spikes and exception stack traces across service logs during the incident window.',
          },
        ]
      : []),
    ...(capabilities.some(c => c.id === 'attachment_review')
      ? [
          {
            label: 'Review runbooks & evidence',
            capability: 'attachment_review',
            prompt: 'Analyze our approved runbooks and attached incident notes to determine recommended recovery actions.',
          },
        ]
      : []),
  ].slice(0, 4);

  return (
    <div className={`chat-page ${panelOpen ? 'chat-panel-open' : ''} ${historyOpen ? 'chat-history-open' : ''}`}>
      <header className="chat-header">
        <div className="chat-header-left">
          <button
            type="button"
            className={`chat-history-toggle-btn ${historyOpen ? 'is-active' : ''}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-expanded={historyOpen}
            title={historyOpen ? 'Hide conversation history' : 'Show conversation history'}
            aria-label="Toggle conversation history"
          >
            {historyOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
            <span>History</span>
            {conversations.length ? <span className="chat-badge">{conversations.length}{historyHasMore ? '+' : ''}</span> : null}
          </button>
          <div className="chat-header-divider" aria-hidden="true" />
          <div className="chat-header-brand-icon" aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div>
            <h1>Chat with RCA assist</h1>
            <p className="chat-header-description">Ask a question. Follow the evidence.</p>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className={`btn btn-secondary ${panelOpen && panel !== 'files' ? 'is-active' : ''}`}
            onClick={() => {
              returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              if (panelOpen && panel !== 'files') {
                setPanelOpen(false);
              } else {
                setPanel(selectedRun ? 'brief' : 'activity');
                setPanelOpen(true);
              }
            }}
            title="Inspect Executive Brief and Advanced Reasoning"
          >
            <Brain size={15} />
            <span>Reasoning & Brief</span>
          </button>
          <button
            type="button"
            className={`btn btn-secondary ${panelOpen && panel === 'files' ? 'is-active' : ''}`}
            onClick={() => {
              returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setPanel('files');
              setPanelOpen(true);
            }}
          >
            <Paperclip size={15} />
            <span>Files</span>
            {fileCount ? <span className="chat-badge">{fileCount}</span> : null}
          </button>
          {config?.mode === 'demo' && <span className="chat-demo">Demo mode</span>}
          <button
            type="button"
            className="btn btn-primary chat-new-btn"
            disabled={busy || loading}
            onClick={() => void chooseConversation(null)}
          >
            <Plus size={15} />
            <span>New chat</span>
          </button>
        </div>
      </header>

      <div className="chat-body">
        {historyOpen && (
          <aside className="chat-history-sidebar" aria-label="Conversation history">
            <div className="chat-history-sidebar-header">
              <div className="chat-history-sidebar-title">
                <Clock3 size={15} />
                <span>Conversations</span>
                {conversations.length ? <span className="chat-badge">{conversations.length}{historyHasMore ? '+' : ''}</span> : null}
              </div>
              <div className="chat-history-sidebar-actions">
                <button
                  type="button"
                  className="chat-history-new-btn"
                  title="Start a new conversation"
                  disabled={busy || loading}
                  onClick={() => void chooseConversation(null)}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="chat-history-close"
                  onClick={() => setHistoryOpen(false)}
                  title="Collapse conversation history"
                  aria-label="Close conversation history"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>

            <div className="chat-history-search-container">
              <div className="chat-history-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Filter loaded conversations…"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  aria-label="Filter loaded conversation history"
                />
                {historySearch && (
                  <button
                    type="button"
                    className="chat-history-search-clear"
                    onClick={() => setHistorySearch('')}
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="chat-history-list">
              {!conversations.length && (
                <p className="chat-history-empty">Your conversations will appear here.</p>
              )}
              {!!conversations.length && !filteredConversations.length && (
                <p className="chat-history-empty">No loaded conversations match &ldquo;{historySearch}&rdquo;.</p>
              )}
              {filteredConversations.map(item => (
                <button
                  type="button"
                  disabled={busy || loading}
                  key={item.chat_id}
                  aria-current={item.chat_id === chatId ? 'true' : undefined}
                  className={`chat-history-item ${item.chat_id === chatId ? 'is-current' : ''}`}
                  onClick={() => void chooseConversation(item.chat_id)}
                >
                  <MessageSquare size={14} className="chat-history-item-icon" />
                  <div className="chat-history-item-text">
                    <span className="chat-history-item-title">{item.title || 'Untitled conversation'}</span>
                    <time className="chat-history-item-time">
                      {new Date(item.created_at * 1000).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  </div>
                </button>
              ))}
              {historyError && <p role="alert" className="chat-notice">Earlier conversations could not be loaded: {historyError}</p>}
              {historyHasMore && (
                <button type="button" className="btn btn-secondary" disabled={loading || historyLoading} aria-busy={historyLoading} onClick={() => void loadMoreConversations()}>
                  {historyLoading ? 'Loading conversations…' : historyError ? 'Retry earlier conversations' : 'Load more conversations'}
                </button>
              )}
            </div>
          </aside>
        )}
        <section className="chat-conversation" aria-label="Investigation conversation">
          <div className="chat-messages">
            {loading && <p role="status" className="chat-notice">Loading your workspace…</p>}
            {!loading && (runsHasMore || messagesHasMore) && (
              <div className="chat-notice">
                {olderError && <p role="alert">Earlier history could not be loaded: {olderError}</p>}
                <button type="button" className="btn btn-secondary" disabled={busy || olderLoading} aria-busy={olderLoading} onClick={() => void loadEarlierTurns()}>
                  {olderLoading ? 'Loading earlier history…' : olderError ? 'Retry earlier history' : 'Load earlier messages and investigations'}
                </button>
              </div>
            )}
            {!loading && !turns.length && !busy && (
              <div className="chat-welcome">
                <div className="chat-welcome-mark">
                  <MessageSquare size={28} />
                </div>
                <h2>What would you like to understand?</h2>
                <div className="chat-welcome-capabilities-strip">
                  <span className="chat-welcome-pill pill-reasoning">
                    <Brain size={13} />
                    Cognitive Reasoning DAG
                  </span>
                  <span className="chat-welcome-pill pill-brief">
                    <Briefcase size={13} />
                    Plain-English Executive Brief
                  </span>
                  <span className="chat-welcome-pill pill-visual">
                    <Sparkles size={13} />
                    Adaptive Visual RCA
                  </span>
                </div>
                <p>
                  Ask about an incident or your team’s runbooks. Add a ticket number or attach evidence to get started.
                </p>
                <div className="chat-guidance">
                  <BookOpen size={16} />
                  <span>Approved project knowledge is available here. Attach evidence for this conversation.</span>
                </div>
                {!!availableStarters.length && (
                  <div className="chat-starters" aria-label="Suggested investigations">
                    <p className="chat-starters-label">Suggested starters:</p>
                    <div className="chat-starters-grid">
                      {availableStarters.map((starter, index) => (
                        <button
                          key={index}
                          type="button"
                          className="chat-starter-card"
                          onClick={() => handleSelectStarter(starter.prompt, starter.capability)}
                        >
                          <span className="chat-starter-icon">
                            <Sparkles size={14} />
                          </span>
                          <span className="chat-starter-text">{starter.label}</span>
                          <ArrowUp size={13} className="chat-starter-arrow" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {turns.map(turn => {
              if (turn.kind === 'message') {
                const message = turn.message;
                return message.role === 'user' ? (
                  <article className="chat-exchange" key={message.id}>
                    <div className="chat-question">
                      <span className="chat-speaker">You</span>
                      <p>{message.content}</p>
                    </div>
                  </article>
                ) : (
                  <article className="chat-exchange" key={message.id}>
                    <div className="chat-answer">
                      <div className="chat-answer-heading">
                        <span className="chat-assist-mark">R</span>
                        <strong>RCA assist</strong>
                      </div>
                      <AnswerMarkdown text={message.content} />
                      {!!message.choices.length && (
                        <div className="chat-followups">
                          {message.choices.map(choice => (
                            <button
                              key={choice.capability}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  question.trim() &&
                                  !window.confirm('Replace your unsent question with this investigation?')
                                ) {
                                  return;
                                }
                                setCapability(choice.capability);
                                setQuestion(choice.prompt);
                                setRetainedAttachmentIds(message.attachment_ids || []);
                                composer.current?.focus();
                              }}
                            >
                              {investigationNames[choice.capability] || choice.label}
                              <ArrowUp size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              }
              const run = turn.run;
              return (
                <article key={run.id} className="chat-exchange">
                  <div className="chat-question">
                    <span className="chat-speaker">You</span>
                    <p>{run.prompt}</p>
                  </div>
                  <div className="chat-answer" id={`answer-${run.id}`}>
                    <div className="chat-answer-heading">
                      <span className="chat-assist-mark">R</span>
                      <strong>RCA assist</strong>
                      <span className={`chat-status ${run.status.toLowerCase()}`}>
                        {active(run) ? (
                          <span className="chat-status-active">
                            <span className="chat-progress-dot" aria-hidden="true" />
                            {readable(String(run.raw?.stage || 'analysis'))}
                          </span>
                        ) : (
                          statusText[run.status] || run.status
                        )}
                      </span>
                    </div>
                    {run.mode === 'demo' && (
                      <p className="chat-demo-note">Simulated investigation · for testing only</p>
                    )}
                    <ChatThinkingAccordion
                      run={run}
                      events={selectedRun === run.id ? events : []}
                      activePhase={busy && currentRun.current === run.id ? phase : undefined}
                      isStreaming={active(run)}
                      onOpenActivityTab={() => inspect(run.id, 'activity')}
                    />
                    {run.result ? (
                      <>
                        <ChatVisualCard
                          run={run}
                          onInspectSources={evId => inspect(run.id, 'sources', evId)}
                          onOpenRun={onOpenRun}
                        />
                        <div className="chat-summary-wrapper">
                          <CompactText text={run.result.summary} />
                          <button
                            type="button"
                            className="chat-copy-btn"
                            title="Copy summary to clipboard"
                            aria-label="Copy summary to clipboard"
                            onClick={() => handleCopySummary(run.id, run.result?.summary || '')}
                          >
                            {copiedRunId === run.id ? (
                              <Check size={13} className="chat-copied-check" />
                            ) : (
                              <Copy size={13} />
                            )}
                            <span>{copiedRunId === run.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        {!!run.result.findings.length && (
                          <section className="chat-findings">
                            <h3>Key findings</h3>
                            {run.result.findings.slice(0, 3).map((finding, index) => (
                              <div className="chat-finding" key={index}>
                                <span className="chat-finding-number">{index + 1}</span>
                                <div>
                                  <CompactText text={finding.summary} limit={200} />
                                  <button
                                    className="chat-text-button"
                                    type="button"
                                    disabled={!finding.evidence_ids.length}
                                    onClick={() => inspect(run.id, 'sources', finding.evidence_ids[0])}
                                  >
                                    View {finding.evidence_ids.length === 1 ? 'source' : `${finding.evidence_ids.length} sources`}
                                  </button>
                                </div>
                              </div>
                            ))}
                            {run.result.findings.length > 3 && (
                              <details>
                                <summary>{run.result.findings.length - 3} more findings</summary>
                                {run.result.findings.slice(3).map((finding, index) => (
                                  <div key={index} className="chat-finding">
                                    <span className="chat-finding-number">{index + 4}</span>
                                    <div>
                                      <AnswerMarkdown text={finding.summary} />
                                      <button
                                        type="button"
                                        className="chat-text-button"
                                        disabled={!finding.evidence_ids.length}
                                    onClick={() => inspect(run.id, 'sources', finding.evidence_ids[0])}
                                      >
                                        View sources
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </details>
                            )}
                          </section>
                        )}
                        {!!run.result.uncertainties.length && (
                          <div className="chat-uncertainty">
                            <h3>Still uncertain</h3>
                            <CompactText text={run.result.uncertainties[0]} limit={220} />
                            {run.result.uncertainties.length > 1 && (
                              <details>
                                <summary>More uncertainties</summary>
                                <ul>
                                  {run.result.uncertainties.slice(1).map((text, index) => (
                                    <li key={index}>
                                      <AnswerMarkdown text={text} />
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        )}
                        {!!run.result.recommended_actions.length && (
                          <section className="chat-next-step">
                            <div className="chat-next-step-title">
                              <CheckCircle2 size={15} />
                              <h3>Suggested next step</h3>
                            </div>
                            <CompactText text={run.result.recommended_actions[0]} limit={220} />
                            {run.result.recommended_actions.length > 1 && (
                              <details>
                                <summary>Other suggested actions</summary>
                                <ol>
                                  {run.result.recommended_actions.slice(1).map((text, index) => (
                                    <li key={index}>
                                      <AnswerMarkdown text={text} />
                                    </li>
                                  ))}
                                </ol>
                              </details>
                            )}
                          </section>
                        )}
                      </>
                    ) : active(run) ? (
                      <p className="chat-progress" role="status">
                        <span className="chat-progress-dot" />
                        {busy ? phase : 'This investigation is in progress. Its saved status updates automatically.'}
                      </p>
                    ) : (
                      <div className="chat-simulated-box">
                        <p className="chat-simulated-reason">
                          {String(run.raw?.reason || 'No answer is available for this investigation.')}
                        </p>
                        <div className="chat-simulated-callout">
                          <Brain size={15} />
                          <span>
                            Open <strong>Activity</strong> or <strong>Sources</strong> below to review saved investigation details.
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="chat-answer-actions">
                      <button
                        type="button"
                        className="chat-action-btn-brief"
                        onClick={() => inspect(run.id, 'brief')}
                        title="Plain-English summary for non-technical users"
                      >
                        <Briefcase size={14} /> Executive brief
                      </button>
                      <button type="button" onClick={() => inspect(run.id, 'sources')}>
                        <BookOpen size={14} /> {run.evidence_count || 0} sources
                      </button>
                      <button type="button" onClick={() => inspect(run.id, 'activity')}>
                        <Clock3 size={14} /> Activity
                      </button>
                      <button type="button" onClick={() => onOpenRun(run.id)}>
                        <FileText size={14} /> Full report <ExternalLink size={11} />
                      </button>
                    </div>
                    {!!run.result?.follow_up_questions?.length && (
                      <div className="chat-followups" aria-label="Suggested follow-up questions">
                        {run.result.follow_up_questions.slice(0, 3).map((text, index) => (
                          <button
                            type="button"
                            key={index}
                            disabled={busy}
                            onClick={() => {
                              if (
                                question.trim() &&
                                !window.confirm('Replace your unsent question with this follow-up?')
                              ) {
                                return;
                              }
                              setQuestion(text);
                              composer.current?.focus();
                            }}
                          >
                            {short(text, 120)} <ArrowUp size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                    {run.mode === 'live' && !active(run) && run.result && (
                      <RunFeedback key={run.id} runId={run.id} />
                    )}
                  </div>
                </article>
              );
            })}
            {pendingQuestion && (
              <div className="chat-exchange">
                <div className="chat-question">
                  <span className="chat-speaker">You</span>
                  <p>{pendingQuestion}</p>
                </div>
                <p className="chat-progress" role="status">
                  <span className="chat-progress-dot" />
                  {phase}
                </p>
              </div>
            )}
          </div>

          <div
            className={`chat-composer-area ${dragActive ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {error && (
              <div role="alert" className="chat-error">
                <span>{error}</span>
                {!config && (
                  <button type="button" onClick={() => setAttempt(value => value + 1)}>
                    Retry
                  </button>
                )}
                {config && chatId && !busy && (
                  <button type="button" disabled={loading} onClick={() => void chooseConversation(chatId)}>Reload conversation</button>
                )}
                <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>
                  <X size={16} />
                </button>
              </div>
            )}
            {anyActive && !busy && (
              <div className="chat-notice">
                This conversation has an active investigation.{' '}
                <button
                  type="button"
                  className="chat-text-button"
                  onClick={() => void chooseConversation(chatId)}
                >
                  Refresh conversation
                </button>
              </div>
            )}
            <form
              className={`chat-composer ${dragActive ? 'is-drag-target' : ''}`}
              onSubmit={send}
            >
              {dragActive && (
                <div className="chat-drag-overlay" aria-hidden="true">
                  <Paperclip size={24} />
                  <span>Drop files to attach to this investigation</span>
                </div>
              )}
              <label className="sr-only" htmlFor="chat-question">
                Your question
              </label>
              <textarea
                ref={composer}
                id="chat-question"
                value={question}
                onChange={event => setQuestion(event.target.value)}
                maxLength={16000}
                rows={2}
                placeholder={
                  busy
                    ? 'You can draft your next question while RCA assist investigates…'
                    : 'What happened, where, and when? (⌘ + Enter to investigate)'
                }
                disabled={loading}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {!!files.length && (
                <ul className="chat-files">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <Paperclip size={13} />
                      <span>{file.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        disabled={busy}
                        onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="chat-composer-tools">
                <div className="chat-input-tools">
                  <label className={`chat-attach ${!config || busy ? 'disabled' : ''}`}>
                    <Paperclip size={16} />
                    <span>Attach</span>
                    <input
                      type="file"
                      aria-label="Attach files to this conversation"
                      accept={config?.file_limits.allowed_extensions.join(',')}
                      multiple
                      disabled={!config || busy}
                      onChange={event => {
                        setFiles(previous => [...previous, ...Array.from(event.target.files || [])]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  <label className="chat-workflow">
                    <span className="sr-only">Investigation type</span>
                    <select
                      aria-label="Investigation type"
                      value={capability}
                      onChange={event => setCapability(event.target.value)}
                      disabled={loading || busy}
                    >
                      <option value="">Auto-detect capability</option>
                      {capabilities.map(item => (
                        <option key={item.id} value={item.id}>
                          {investigationNames[item.id] || item.name || readable(item.id)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} aria-hidden="true" />
                  </label>
                </div>
                {busy || anyActive ? (
                  <button
                    className="chat-send chat-stop"
                    type="button"
                    onClick={() => void stop()}
                    disabled={stopping}
                  >
                    <Square size={13} />
                    <span>{stopping ? 'Stopping…' : 'Stop'}</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="chat-send"
                    disabled={loading || !config || !question.trim() || anyActive || !connectorScope.ready}
                    aria-label="Send question"
                  >
                    <ArrowUp size={16} />
                    <span>Investigate</span>
                  </button>
                )}
              </div>
              <RunConnectorSelectors state={connectorScope} disabled={loading || busy} />
              <RunKnowledgeSelector capability={capability} connectors={connectorScope.selections} value={knowledgeSelection} onChange={setKnowledgeSelection} disabled={loading || busy} />
            </form>
            <p className="chat-composer-note">
              Review the evidence before acting.{' '}
              {config?.mode === 'demo'
                ? 'Demo mode records a simulation without diagnostic findings.'
                : 'Suggestions do not change your connected systems.'}
            </p>
          </div>
        </section>

        {panelOpen && (
          <aside
            ref={contextPanel}
            tabIndex={-1}
            className="chat-context"
            aria-label="Investigation details"
          >
            <div className="chat-context-header">
              <h2>Behind the answer</h2>
              <button
                type="button"
                aria-label="Close investigation details"
                onClick={() => setPanelOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="chat-tabs" role="tablist" aria-label="Investigation details">
              <button
                id="brief-tab"
                role="tab"
                aria-controls="brief-panel"
                aria-selected={panel === 'brief'}
                onClick={() => setPanel('brief')}
              >
                <Briefcase size={13} style={{ marginRight: 4 }} />
                Executive Brief
              </button>
              <button
                id="sources-tab"
                role="tab"
                aria-controls="sources-panel"
                aria-selected={panel === 'sources'}
                onClick={() => setPanel('sources')}
              >
                <BookOpen size={13} style={{ marginRight: 4 }} />
                Sources {evidence.length ? `(${evidence.length})` : ''}
              </button>
              <button
                id="activity-tab"
                role="tab"
                aria-controls="activity-panel"
                aria-selected={panel === 'activity'}
                onClick={() => setPanel('activity')}
              >
                <Clock3 size={13} style={{ marginRight: 4 }} />
                Activity
              </button>
              <button
                id="files-tab"
                role="tab"
                aria-controls="files-panel"
                aria-selected={panel === 'files'}
                onClick={() => setPanel('files')}
              >
                <Paperclip size={13} style={{ marginRight: 4 }} />
                Files {fileCount ? `(${fileCount})` : ''}
              </button>
            </div>
            <div className="chat-context-scroll">
              {panel !== 'files' && detailsLoading && <p role="status">Loading saved details…</p>}
              {panel !== 'files' && detailError && (
                <div role="alert" className="chat-notice">
                  {detailError}
                  <button
                    type="button"
                    className="chat-text-button"
                    onClick={() => setDetailRevision(value => value + 1)}
                  >
                    Retry
                  </button>
                </div>
              )}
              {panel === 'files' ? (
                <div id="files-panel" role="tabpanel" aria-labelledby="files-tab">
                  <ChatFiles
                    key={chatId || 'new'}
                    chatId={chatId}
                    runs={runs}
                    refreshVersion={detailRevision}
                    onCountChange={setFileCount}
                  />
                </div>
              ) : panel === 'brief' ? (
                <div id="brief-panel" role="tabpanel" aria-labelledby="brief-tab">
                  {selected && !detailsLoading ? (
                    <ChatExecutiveBrief run={selected} evidence={evidence} onInspectSources={() => setPanel('sources')} />
                  ) : (
                    <p className="chat-context-empty">Select an investigation to view its executive brief.</p>
                  )}
                </div>
              ) : panel === 'sources' ? (
                <div id="sources-panel" role="tabpanel" aria-labelledby="sources-tab">
                  <p className="chat-context-intro">
                    Evidence collected for this answer. Open a source to review what it says.
                  </p>
                  {!evidence.length && !detailsLoading && (
                    <p>
                      {detailError ? 'Sources are unavailable. Retry loading saved details.' : selected && active(selected)
                        ? 'Sources will appear as evidence is saved. Refresh to check progress.'
                        : 'No sources were collected for this answer.'}
                    </p>
                  )}
                  {evidence.map((item, index) => (
                    <details
                      className="chat-source"
                      key={`${item.evidence_id}-${focusedSource}`}
                      open={focusedSource === item.evidence_id || undefined}
                    >
                      <summary>
                        <span className="chat-source-index">{index + 1}</span>
                        <span>
                          {readable(item.source.connector)}
                          <small>{readable(item.source.system)}</small>
                        </span>
                      </summary>
                      <EvidenceView evidence={item} />
                    </details>
                  ))}
                </div>
              ) : (
                <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab">
                  <p className="chat-context-intro">Saved investigation steps and measured time.</p>
                  {!!timedEvents.length && (
                    <section className="chat-duration-chart">
                      <h3>Time by step</h3>
                      <p>Select a bar for the exact time.</p>
                      {timedEvents.map((item, index) => (
                        <button
                          key={`${item.sequence}-${index}`}
                          type="button"
                          onClick={() => setDurationEvent(index)}
                          aria-pressed={durationEvent === index}
                          aria-label={`${readable(String(item.node_id || item.kind))}: ${(
                            Number(item.details?.duration_ms) / 1000
                          ).toFixed(2)} seconds`}
                        >
                          <span>{readable(String(item.node_id || item.kind))}</span>
                          <span className="chat-duration-track">
                            <span
                              style={{
                                width: `${Math.max(
                                  1,
                                  (Number(item.details?.duration_ms) / maxDuration) * 100,
                                )}%`,
                              }}
                            />
                          </span>
                        </button>
                      ))}
                      {durationEvent !== null && timedEvents[durationEvent] && (
                        <output>
                          {readable(
                            String(
                              timedEvents[durationEvent].node_id || timedEvents[durationEvent].kind,
                            ),
                          )}
                          : {(Number(timedEvents[durationEvent].details?.duration_ms) / 1000).toFixed(2)}{' '}
                          seconds
                        </output>
                      )}
                    </section>
                  )}
                  {!visibleActivity.length && !detailsLoading && <p>No saved activity yet.</p>}
                  <p className="chat-context-intro">
                    {activity.length > 50
                      ? `Showing the latest 50 of ${activity.length} saved steps.`
                      : ''}
                  </p>
                  <ol className="chat-activity">
                    {visibleActivity.map((item, index) => (
                      <li key={`${item.sequence}-${index}`}>
                        {String(item.kind).includes('failed') ? (
                          <X size={13} className="chat-activity-error" />
                        ) : String(item.kind).includes('completed') ? (
                          <Check size={13} />
                        ) : (
                          <Clock3 size={13} />
                        )}
                        <div>
                          <strong>{readable(String(item.node_id || item.kind || 'Update'))}</strong>
                          <span>{readable(String(item.kind || ''))}</span>
                          {typeof item.details?.message === 'string' && (
                            <p>{short(item.details.message, 160)}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {panel !== 'files' && selectedRun && (
                <button
                  type="button"
                  className="chat-text-button"
                  onClick={() => setDetailRevision(value => value + 1)}
                >
                  Refresh details
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
