import React from 'react';
import { Sliders, ShieldCheck } from 'lucide-react';
import type { ConnectorExecutionLimitsCardProps } from './types';

export const ConnectorExecutionLimitsCard: React.FC<ConnectorExecutionLimitsCardProps> = ({
  timeoutSeconds,
  onTimeoutChange,
  timeoutDefault = 30,
  retryAttempts = 3,
  onRetryAttemptsChange,
  retryAttemptsDefault = 3,
  retryBackoff = 2,
  onRetryBackoffChange,
  retryBackoffDefault = 2,
  rateLimit = 120,
  onRateLimitChange,
  rateLimitDefault = 120,
  maxResponseBytes,
  onMaxResponseBytesChange,
  maxBytesDefault = 10485760,
  hasMaxResponseBytes = false,
  readOnly = false,
}) => {
  return (
    <div className="prism-execution-limits-section">
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Sliders size={15} style={{ color: 'var(--acc, #2563eb)' }} />
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx, #0f172a)', margin: 0 }}>
            Execution Bounds &amp; Telemetry
          </h4>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted, #475569)', margin: 0 }}>
          Shared runtime execution bounds and audit logging parameters.
        </p>
      </div>

      <div className="prism-form-grid-2">
        <div className="prism-form-group">
          <label className="prism-label">
            Request Timeout (seconds) <span className="prism-req">*</span>
          </label>
          <input
            type="number"
            className="prism-input"
            value={timeoutSeconds}
            min={1}
            max={120}
            disabled={readOnly}
            onChange={e => onTimeoutChange(Number(e.target.value) || timeoutDefault)}
          />
          <span className="prism-field-caption">
            Maximum execution time for requests to this connector (Default: {timeoutDefault}s)
          </span>
        </div>

        <div className="prism-form-group">
          <label className="prism-label">
            Retry Attempts <span className="prism-req">*</span>
          </label>
          <input
            type="number"
            className="prism-input"
            value={retryAttempts ?? 3}
            min={0}
            max={10}
            disabled={readOnly}
            onChange={e => onRetryAttemptsChange && onRetryAttemptsChange(Number(e.target.value) ?? (retryAttemptsDefault ?? 3))}
          />
          <span className="prism-field-caption">
            Number of automatic retries on transient network errors (Default: {retryAttemptsDefault ?? 3})
          </span>
        </div>

        <div className="prism-form-group">
          <label className="prism-label">
            Retry Backoff (seconds) <span className="prism-req">*</span>
          </label>
          <input
            type="number"
            className="prism-input"
            value={retryBackoff ?? 5}
            min={1}
            max={60}
            disabled={readOnly}
            onChange={e => onRetryBackoffChange && onRetryBackoffChange(Number(e.target.value) ?? (retryBackoffDefault ?? 5))}
          />
          <span className="prism-field-caption">
            Exponential or linear backoff delay between retry attempts (Default: {retryBackoffDefault ?? 5}s)
          </span>
        </div>

        <div className="prism-form-group">
          <label className="prism-label">
            Rate Limit (requests/min) <span className="prism-req">*</span>
          </label>
          <input
            type="number"
            className="prism-input"
            value={rateLimit ?? 100}
            min={1}
            max={1000}
            disabled={readOnly}
            onChange={e => onRateLimitChange && onRateLimitChange(Number(e.target.value) ?? (rateLimitDefault ?? 100))}
          />
          <span className="prism-field-caption">
            Maximum request frequency allowed to the remote API (Default: {rateLimitDefault ?? 100} req/min)
          </span>
        </div>

        {hasMaxResponseBytes && onMaxResponseBytesChange && (
          <div className="prism-form-group full-width">
            <label className="prism-label">Max Response Bytes</label>
            <input
              type="number"
              className="prism-input"
              value={maxResponseBytes ?? maxBytesDefault}
              min={1024}
              disabled={readOnly}
              onChange={e => onMaxResponseBytesChange(Number(e.target.value) || maxBytesDefault)}
            />
            <span className="prism-field-caption">
              Payload limit: {(((maxResponseBytes ?? maxBytesDefault) / (1024 * 1024))).toFixed(1)} MB
            </span>
          </div>
        )}

        <div className="prism-form-group full-width" style={{ marginTop: '4px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#065f46',
            }}
          >
            <ShieldCheck size={16} style={{ flexShrink: 0, color: '#059669' }} />
            <span>
              <strong style={{ color: '#064e3b' }}>Audit Logging:</strong> All connector requests, parameter resolutions, and test probes are recorded with tenant and project lineage in the platform audit store.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
