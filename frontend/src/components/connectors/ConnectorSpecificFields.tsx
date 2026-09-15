import React from 'react';
import { Terminal, Database, Server, Radio, Info } from 'lucide-react';
import type { ConnectorSpecificFieldsProps } from './types';

export const ConnectorSpecificFields: React.FC<ConnectorSpecificFieldsProps> = ({
  connectorType,
  customJql,
  onCustomJqlChange,
  attachmentProcessing = 'local_only',
  onAttachmentProcessingChange,
  jiraProjectKey,
  onJiraProjectKeyChange,
  splunkIndex,
  onSplunkIndexChange,
  searchWindowSeconds = 86400,
  onSearchWindowSecondsChange,
  maxResults = 50,
  onMaxResultsChange,
  unixLogPath,
  onUnixLogPathChange,
  sshPort = 22,
  onSshPortChange,
  kafkaTopicFilter,
  onKafkaTopicFilterChange,
  oracleDriverMode = 'thin',
  onOracleDriverModeChange,
  oracleClientLibDir,
  onOracleClientLibDirChange,
  oracleConnectionFormat = 'ezconnect',
  onOracleConnectionFormatChange,
  scopeValue,
  onScopeValueChange,
  readOnly = false,
}) => {
  // Jira / ITSM
  if (connectorType === 'itsm') {
    return (
      <div className="prism-connector-specific-fields">
        <div className="prism-form-grid-2">
          {onJiraProjectKeyChange && (
            <div className="prism-form-group">
              <label className="prism-label">
                Jira Project Key <span className="prism-req">*</span>
              </label>
              <input
                type="text"
                className="prism-input mono"
                value={jiraProjectKey || ''}
                placeholder="PROJ"
                disabled={readOnly}
                onChange={e => onJiraProjectKeyChange(e.target.value.toUpperCase())}
              />
              <span className="prism-field-caption">Primary Jira project key for incident triage</span>
            </div>
          )}

          {onAttachmentProcessingChange && (
            <div className="prism-form-group">
              <label className="prism-label">
                Attachment Processing Mode <span className="prism-req">*</span>
              </label>
              <select
                className="prism-select"
                value={attachmentProcessing}
                disabled={readOnly}
                onChange={e => onAttachmentProcessingChange(e.target.value)}
              >
                <option value="local_only">local_only (Strict bounded parallel parsing)</option>
                <option value="skip">skip (Ignore ticket attachments)</option>
                <option value="summarize">summarize (Extract text and summarize)</option>
              </select>
              <span className="prism-field-caption">
                Local-only parsing policy during triage; remote fetches and macros are forbidden.
              </span>
            </div>
          )}

          {onMaxResultsChange && (
            <div className="prism-form-group">
              <label className="prism-label">
                Max Ticket Results <span className="prism-req">*</span>
              </label>
              <input
                type="number"
                className="prism-input"
                value={maxResults}
                min={1}
                max={100}
                disabled={readOnly}
                onChange={e => onMaxResultsChange(Number(e.target.value) || 50)}
              />
              <span className="prism-field-caption">Maximum issues fetched during incident discovery</span>
            </div>
          )}

          {onCustomJqlChange && (
            <div className="prism-form-group full-width">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label className="prism-label" style={{ margin: 0 }}>Custom JQL Filter (Saved Configuration)</label>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'rgba(37, 99, 235, 0.1)',
                      border: '1px solid rgba(37, 99, 235, 0.3)',
                      color: 'var(--acc, #2563eb)',
                      fontWeight: 600,
                    }}
                  >
                    Dynamic JQL Allowed
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: (customJql?.length || 0) > 4096 ? '#ef4444' : '#64748b' }}>
                  {customJql?.length || 0} / 4096 chars
                </span>
              </div>
              <textarea
                className="prism-textarea mono"
                rows={3}
                value={customJql || ''}
                placeholder="e.g. project = INC AND status != Closed"
                disabled={readOnly}
                onChange={e => onCustomJqlChange(e.target.value)}
              />
              <span className="prism-field-caption">
                Saved query appended to incident triage queries (max 4096 characters). Dynamic JQL evaluation supported.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Splunk / Log Search
  if (connectorType === 'log_search') {
    return (
      <div className="prism-connector-specific-fields">
        <div className="prism-form-grid-2">
          {onSplunkIndexChange && (
            <div className="prism-form-group">
              <label className="prism-label">
                Authorized Splunk Index <span className="prism-req">*</span>
              </label>
              <input
                type="text"
                className="prism-input mono"
                value={splunkIndex || ''}
                placeholder="main"
                disabled={readOnly}
                onChange={e => onSplunkIndexChange(e.target.value)}
              />
              <span className="prism-field-caption">Target index searched by the native Splunk client</span>
            </div>
          )}

          {onMaxResultsChange && (
            <div className="prism-form-group">
              <label className="prism-label">
                Max Log Results <span className="prism-req">*</span>
              </label>
              <input
                type="number"
                className="prism-input"
                value={maxResults}
                min={1}
                max={1000}
                disabled={readOnly}
                onChange={e => onMaxResultsChange(Number(e.target.value) || 100)}
              />
              <span className="prism-field-caption">Maximum events returned per log query (1–1000)</span>
            </div>
          )}

          {onSearchWindowSecondsChange && (
            <div className="prism-form-group full-width">
              <label className="prism-label">
                Search Time Window Seconds <span className="prism-req">*</span>
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number"
                  className="prism-input"
                  value={searchWindowSeconds}
                  min={60}
                  max={86400}
                  disabled={readOnly}
                  onChange={e => onSearchWindowSecondsChange(Number(e.target.value) || 86400)}
                />
                {!readOnly && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="prism-btn-reset"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      onClick={() => onSearchWindowSecondsChange(3600)}
                    >
                      1h
                    </button>
                    <button
                      type="button"
                      className="prism-btn-reset"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      onClick={() => onSearchWindowSecondsChange(86400)}
                    >
                      24h
                    </button>
                  </div>
                )}
              </div>
              <span className="prism-field-caption">
                Upper search limit: {searchWindowSeconds}s ({Math.round(searchWindowSeconds / 3600)} hours, capped at 86,400s / 24h)
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Unix
  if (connectorType === 'unix') {
    return (
      <div className="prism-connector-specific-fields">
        <div className="prism-form-grid-2">
          {onSshPortChange && (
            <div className="prism-form-group">
              <label className="prism-label">SSH Port</label>
              <input
                type="number"
                className="prism-input"
                value={sshPort}
                min={1}
                max={65535}
                disabled={readOnly}
                onChange={e => onSshPortChange(Number(e.target.value) || 22)}
              />
              <span className="prism-field-caption">Port for bounded SFTP connection (default 22)</span>
            </div>
          )}

          {onUnixLogPathChange && (
            <div className="prism-form-group full-width">
              <label className="prism-label">
                Approved Log File Path <span className="prism-req">*</span>
              </label>
              <input
                type="text"
                className="prism-input mono"
                value={unixLogPath || ''}
                placeholder="/var/log/application.log"
                disabled={readOnly}
                onChange={e => onUnixLogPathChange(e.target.value)}
              />
              <span className="prism-field-caption">
                Must be an absolute path (e.g. <code>/var/log/syslog</code>); path traversal (<code>..</code>) is rejected.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Kafka
  if (connectorType === 'kafka') {
    return (
      <div className="prism-connector-specific-fields">
        <div className="prism-form-grid-2">
          {onKafkaTopicFilterChange && (
            <div className="prism-form-group full-width">
              <label className="prism-label">Kafka Topic Filter Pattern</label>
              <input
                type="text"
                className="prism-input mono"
                value={kafkaTopicFilter || ''}
                placeholder="events-*"
                disabled={readOnly}
                onChange={e => onKafkaTopicFilterChange(e.target.value)}
              />
              <span className="prism-field-caption">
                Optional glob pattern (fnmatch) used to match configured topic names (max 256 characters).
              </span>
            </div>
          )}

          <div className="prism-form-group full-width">
            <div
              style={{
                display: 'flex',
                gap: '8px',
                padding: '10px 14px',
                background: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid rgba(37, 99, 235, 0.25)',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#1e40af',
              }}
            >
              <Radio size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#2563eb' }} />
              <div>
                <strong style={{ color: '#1e3a8a' }}>Kafka Partition Metadata Scope:</strong> Native Kafka provider inspects partition metadata only via SASL SCRAM-SHA-512 over TLS. No message consumption or consumer-group lag commits are executed.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Oracle
  if (connectorType === 'oracle') {
    return (
      <div className="prism-connector-specific-fields">
        <div className="prism-form-grid-2">
          {onOracleDriverModeChange && (
            <div className="prism-form-group">
              <label className="prism-label">Oracle Driver Mode</label>
              <select
                className="prism-select"
                value={oracleDriverMode}
                disabled={readOnly}
                onChange={e => onOracleDriverModeChange(e.target.value)}
              >
                <option value="thin">Thin Mode (Pure Python / No Instant Client)</option>
                <option value="thick">Thick Mode (Requires Oracle Client Libraries)</option>
              </select>
            </div>
          )}

          {onOracleConnectionFormatChange && (
            <div className="prism-form-group">
              <label className="prism-label">Connection Format</label>
              <select
                className="prism-select"
                value={oracleConnectionFormat}
                disabled={readOnly}
                onChange={e => onOracleConnectionFormatChange(e.target.value)}
              >
                <option value="ezconnect">EZConnect (host:port/service_name)</option>
                <option value="tns">TNS Name (tnsnames.ora)</option>
                <option value="sid">SID Descriptor</option>
              </select>
            </div>
          )}

          {oracleDriverMode === 'thick' && onOracleClientLibDirChange && (
            <div className="prism-form-group full-width">
              <label className="prism-label">Oracle Client Library Directory</label>
              <input
                type="text"
                className="prism-input mono"
                value={oracleClientLibDir || ''}
                placeholder="/opt/oracle/instantclient_19_8"
                disabled={readOnly}
                onChange={e => onOracleClientLibDirChange(e.target.value)}
              />
            </div>
          )}

          <div className="prism-form-group full-width">
            <div
              style={{
                display: 'flex',
                gap: '8px',
                padding: '10px 14px',
                background: 'rgba(217, 119, 6, 0.08)',
                border: '1px solid rgba(217, 119, 6, 0.25)',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#854d0e',
              }}
            >
              <Database size={16} style={{ flexShrink: 0, marginTop: '2px', color: '#d97706' }} />
              <div>
                <strong style={{ color: '#78350f' }}>Oracle Query Scope:</strong> Queries are strictly limited to <code>v$session</code> wait contention snapshots via <code>SET TRANSACTION READ ONLY</code>. Arbitrary SQL queries, DDL, and table explorations are blocked.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Generic Scope / REST Evidence (Confluence, GitLab, SignalFx, qTest, Kubernetes)
  return (
    <div className="prism-connector-specific-fields">
      <div className="prism-form-grid-2">
        {onScopeValueChange && (
          <div className="prism-form-group full-width">
            <label className="prism-label">
              {connectorType === 'confluence'
                ? 'Authorized Space Key'
                : connectorType === 'gitlab'
                ? 'Authorized Project Path'
                : connectorType === 'signalfx'
                ? 'Metric Scope / Filter'
                : connectorType === 'qtest'
                ? 'Project ID Scope'
                : connectorType === 'kubernetes'
                ? 'Authorized Namespace'
                : 'Authorized Scope'}
            </label>
            <input
              type="text"
              className="prism-input mono"
              value={scopeValue || ''}
              placeholder={
                connectorType === 'confluence'
                  ? 'KB'
                  : connectorType === 'gitlab'
                  ? 'org/repo'
                  : connectorType === 'kubernetes'
                  ? 'production'
                  : 'scope_identifier'
              }
              disabled={readOnly}
              onChange={e => onScopeValueChange(e.target.value)}
            />
            <span className="prism-field-caption">
              Scoped external resource identifier accessed by this connector.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
