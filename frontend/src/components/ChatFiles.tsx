import { useEffect, useRef, useState } from 'react';
import { Download, FileText, RefreshCw, X } from 'lucide-react';
import { downloadChatArtifact, downloadChatReport, fetchChatArtifactPreview, fetchChatArtifacts } from '../services/artifacts';
import type { ChatArtifact, ChatArtifactPreview } from '../services/artifacts';
import type { Run } from '../types/api';
import { AnswerMarkdown } from './AnswerMarkdown';
import './ChatFiles.css';

interface ChatFilesProps {
  chatId: string | null;
  runs: Run[];
  refreshVersion?: number;
  onCountChange?: (count: number) => void;
}
type SelectedFile = { kind: 'upload'; id: string } | { kind: 'report'; id: string };
const terminal = new Set<Run['status']>(['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED', 'SIMULATED']);
const reportStatus: Partial<Record<Run['status'], string>> = { COMPLETED: 'Complete', PARTIAL: 'Partial result', BLOCKED: 'Blocked', FAILED: 'Failed', CANCELLED: 'Stopped', SIMULATED: 'Simulated' };
const dateLabel = (value: number | string) => new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} bytes` : bytes < 1048576 ? `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB` : `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

export function ChatFiles({ chatId, runs, refreshVersion = 0, onCountChange }: ChatFilesProps) {
  const [files, setFiles] = useState<ChatArtifact[]>([]);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<ChatArtifactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const context = useRef(chatId);
  const previewRegion = useRef<HTMLElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const listRequest = useRef(0);
  const reportRuns = chatId ? runs.filter(run => terminal.has(run.status)) : [];
  const selectedUpload = selected?.kind === 'upload' ? files.find(file => file.artifact_id === selected.id) : null;
  const selectedReport = selected?.kind === 'report' ? reportRuns.find(run => run.id === selected.id) : null;

  useEffect(() => {
    const controller = new AbortController();
    context.current = chatId;
    listRequest.current += 1;
    setFiles([]); setError(null); setSelected(null); setNotice(null); setHasMore(false); setLoading(Boolean(chatId));
    setLoadingMore(false); setDownloading(false);
    if (chatId) void fetchChatArtifacts(chatId, undefined, controller.signal)
      .then(items => { if (!controller.signal.aborted) { setFiles(items); setHasMore(items.length === 100); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Files could not load. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); context.current = null; listRequest.current += 1; };
  }, [chatId, refreshVersion, attempt]);

  useEffect(() => { onCountChange?.(files.length + reportRuns.length); }, [files.length, reportRuns.length, onCountChange]);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setPreviewError(null); setDownloadError(null); setNotice(null);
    setPreviewLoading(Boolean(chatId && selected?.kind === 'upload'));
    if (selected) previewRegion.current?.focus();
    if (chatId && selected?.kind === 'upload') void fetchChatArtifactPreview(chatId, selected.id, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(cause => { if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : 'The text preview could not load. Try again or download the original.'); })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [chatId, selected, previewAttempt]);

  const loadMore = async () => {
    if (!chatId || loadingMore || !files.length) return;
    const requestedChat = chatId;
    const version = listRequest.current;
    setLoadingMore(true); setError(null);
    try {
      const next = await fetchChatArtifacts(chatId, files.at(-1)!.created_at);
      if (context.current !== requestedChat || version !== listRequest.current) return;
      setFiles(previous => [...new Map([...previous, ...next].map(file => [file.artifact_id, file])).values()]);
      setHasMore(next.length === 100);
    } catch (cause) { if (context.current === requestedChat && version === listRequest.current) setError(cause instanceof Error ? cause.message : 'More files could not load. Try again.'); }
    finally { if (context.current === requestedChat && version === listRequest.current) setLoadingMore(false); }
  };
  const download = async () => {
    if (!chatId || !selected || downloading) return;
    const requestedChat = chatId;
    const version = listRequest.current;
    setDownloading(true); setDownloadError(null); setNotice(null);
    try {
      const blob = selected.kind === 'upload' ? await downloadChatArtifact(chatId, selected.id) : await downloadChatReport(chatId, selected.id);
      if (context.current !== requestedChat || version !== listRequest.current) return;
      const name = selectedUpload?.filename || `${selected.id}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Download started. Check your browser’s downloads.');
    } catch (cause) { if (context.current === requestedChat && version === listRequest.current) setDownloadError(cause instanceof Error ? cause.message : 'Download failed. Try again.'); }
    finally { if (context.current === requestedChat && version === listRequest.current) setDownloading(false); }
  };

  return <section className="chat-files-panel" aria-label="Conversation files">
    <header><div><h3>Conversation files</h3><p>Original uploads and saved investigation reports.</p></div><button type="button" aria-label="Refresh conversation files" disabled={!chatId || loading || loadingMore || downloading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button></header>
    {!chatId ? <p className="chat-files-empty">Attach a file in the message box, then send your question. Saved files appear here.</p> : <>
      {error && <div className="chat-files-error" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry file list</button></div>}
      {loading && <p role="status">Loading files…</p>}
      {!loading && !files.length && !error && <p className="chat-files-empty">No uploaded files are saved in this conversation.</p>}
      {!!files.length && <section><h4>Uploads</h4><ul className="chat-file-list">{files.map(file => <li key={file.artifact_id}><button type="button" aria-label={`Preview ${file.filename}`} aria-pressed={selected?.kind === 'upload' && selected.id === file.artifact_id} onClick={event => { previewTrigger.current = event.currentTarget; setSelected({ kind: 'upload', id: file.artifact_id }); }}><FileText size={17} aria-hidden="true" /><span><strong>{file.filename}</strong><small>{fileSize(file.size_bytes)} · {dateLabel(file.created_at)}</small></span></button></li>)}</ul>{hasMore && <button type="button" className="chat-files-action" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading more…' : 'Load earlier files'}</button>}</section>}
      <section className="chat-file-reports"><h4>Investigation reports</h4><p>Download a JSON record with the investigation and its evidence.</p>{reportRuns.length ? <ul className="chat-file-list">{reportRuns.map(run => <li key={run.id}><button type="button" aria-label={`Preview report: ${run.prompt || 'Investigation'}`} aria-pressed={selected?.kind === 'report' && selected.id === run.id} onClick={event => { previewTrigger.current = event.currentTarget; setSelected({ kind: 'report', id: run.id }); }}><FileText size={17} aria-hidden="true" /><span><strong>{run.prompt || 'Investigation report'}</strong><small>{run.mode === 'demo' ? 'Simulated · ' : ''}{reportStatus[run.status]} · {dateLabel(run.created_at)}</small></span></button></li>)}</ul> : <p className="chat-files-empty">Reports appear when an investigation finishes or stops.</p>}</section>
      {(selectedUpload || selectedReport) && <section ref={previewRegion} tabIndex={-1} className="chat-file-preview" aria-labelledby="chat-file-preview-title"><header><h4 id="chat-file-preview-title">{selectedUpload?.filename || 'Investigation report'}</h4><button type="button" aria-label="Close file preview" onClick={() => { setSelected(null); previewTrigger.current?.focus(); }}><X size={16} aria-hidden="true" /></button></header>
        {previewLoading && <p role="status">Loading extracted text…</p>}
        {previewError && <div className="chat-files-error" role="alert"><p>{previewError}</p><button type="button" onClick={() => setPreviewAttempt(value => value + 1)}>Retry preview</button></div>}
        {preview && <><p>Extracted text preview{preview.media_type.startsWith('image/') ? ' · images contribute OCR text only' : ''}.</p>{preview.warnings.length > 0 && <div className="chat-file-warnings"><h5>Extraction notes</h5><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}<pre tabIndex={0} aria-label="Extracted file text">{preview.text || 'No extracted text is available.'}</pre>{preview.truncated && <p>The preview is shortened. Download the original to read the complete file.</p>}</>}
        {selectedReport && <>{selectedReport.mode === 'demo' && <p className="chat-file-warnings">This report contains a simulated investigation for testing.</p>}{selectedReport.result ? <div className="chat-file-report-preview"><AnswerMarkdown text={selectedReport.result.summary} />{!!selectedReport.result.uncertainties.length && <><h5>Still uncertain</h5><ul>{selectedReport.result.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></>}</div> : <p>{reportStatus[selectedReport.status]}. This record includes the saved status and any evidence collected.</p>}</>}
        {downloadError && <p className="chat-files-error" role="alert">{downloadError}</p>}
        {notice && <p role="status">{notice}</p>}
        <button type="button" className="btn btn-secondary chat-file-download" disabled={downloading} onClick={() => void download()}><Download size={15} aria-hidden="true" />{downloading ? 'Preparing download…' : selectedUpload ? 'Download original' : 'Download report (JSON)'}</button>
        {selectedUpload && <p className="chat-file-expiry">Original retained until {dateLabel(selectedUpload.expires_at)}.</p>}
      </section>}
    </>}
  </section>;
}
