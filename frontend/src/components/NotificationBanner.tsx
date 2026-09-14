import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationBannerProps {
  type?: NotificationType;
  message?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  /** Auto close timeout in milliseconds. Defaults to 10000 (10 seconds). Pass 0 to disable. */
  autoCloseMs?: number;
  action?: React.ReactNode;
  showProgress?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  type = 'info',
  message,
  children,
  onClose,
  autoCloseMs = 10000,
  action,
  showProgress = true,
  className = '',
  style,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [timeLeft, setTimeLeft] = useState(autoCloseMs);
  const startTimeRef = useRef<number>(Date.now());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset timer whenever message or children changes
  useEffect(() => {
    setTimeLeft(autoCloseMs);
    startTimeRef.current = Date.now();
  }, [message, children, autoCloseMs]);

  // Handle countdown with pause on hover
  useEffect(() => {
    if (!onCloseRef.current || autoCloseMs <= 0) return;
    if (isPaused) return;

    startTimeRef.current = Date.now();
    const timer = setTimeout(() => {
      onCloseRef.current?.();
    }, timeLeft);

    return () => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTimeRef.current;
      setTimeLeft(prev => Math.max(0, prev - elapsed));
    };
  }, [isPaused, timeLeft, autoCloseMs, message, children]);

  const renderIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 size={16} />;
      case 'error':
        return <AlertTriangle size={16} />;
      case 'warning':
        return <AlertCircle size={16} />;
      case 'info':
      default:
        return <Info size={16} />;
    }
  };

  const content = message || children;
  if (!content) return null;

  return (
    <div
      className={`notice-banner ${type} ${className}`}
      style={{ ...style, position: 'relative' }}
      role={type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="notice-main-content">
        <span className="notice-icon" aria-hidden="true">
          {renderIcon()}
        </span>
        <div className="notice-text">
          {content}
        </div>
      </div>

      <div className="notice-actions-group">
        {action}
        {onClose && (
          <button
            type="button"
            className="notice-close-btn"
            onClick={onClose}
            aria-label="Dismiss notification"
            title="Dismiss (auto-closes after 10s)"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showProgress && autoCloseMs > 0 && (
        <div className="notice-progress-track">
          <div
            className={`notice-progress-bar ${type}`}
            style={{
              animationDuration: `${autoCloseMs}ms`,
              animationPlayState: isPaused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </div>
  );
};
