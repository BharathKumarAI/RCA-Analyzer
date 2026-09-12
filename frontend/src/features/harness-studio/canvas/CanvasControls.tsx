import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Layers } from 'lucide-react';
import { StudioViewMode } from '../types/harness';

interface CanvasControlsProps {
  zoom: number;
  viewMode: StudioViewMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onChangeViewMode: (mode: StudioViewMode) => void;
}

export const CanvasControls: React.FC<CanvasControlsProps> = ({
  zoom,
  viewMode,
  onZoomIn,
  onZoomOut,
  onFit,
  onChangeViewMode,
}) => {
  return (
    <div className="hs-canvas-tools">
      <button type="button" className="icon-btn" onClick={onZoomIn} title="Zoom In">
        <ZoomIn size={14} />
      </button>
      <button type="button" className="icon-btn" onClick={onZoomOut} title="Zoom Out">
        <ZoomOut size={14} />
      </button>
      <button type="button" className="icon-btn" onClick={onFit} title="Fit to Screen">
        <Maximize2 size={14} />
      </button>
      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', padding: '0 6px', color: 'var(--muted)' }}>
        {Math.round(zoom * 100)}%
      </span>
      <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
      <div className="hs-view-segmented" style={{ background: 'transparent', border: 'none', padding: 0 }}>
        {(['runtime', 'configuration', 'harness', 'all'] as StudioViewMode[]).map(mode => (
          <button
            key={mode}
            type="button"
            className={`hs-view-btn ${viewMode === mode ? 'active' : ''}`}
            onClick={() => onChangeViewMode(mode)}
            style={{ fontSize: '10px', padding: '2px 7px' }}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
};
