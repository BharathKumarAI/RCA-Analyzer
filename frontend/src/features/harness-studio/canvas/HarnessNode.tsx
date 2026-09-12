import React from 'react';
import {
  Bot,
  Cpu,
  Workflow,
  Wrench,
  Sparkles,
  Shield,
  Layers,
  Database,
  ExternalLink,
  Code2,
} from 'lucide-react';
import { AdkComponent, StudioViewMode } from '../types/harness';

interface HarnessNodeProps {
  component: AdkComponent;
  x: number;
  y: number;
  isSelected: boolean;
  viewMode: StudioViewMode;
  onSelect: (id: string) => void;
  onOpenDefinition?: (filePath: string) => void;
  onStartDrag: (e: React.PointerEvent, id: string) => void;
  onStartPortDrag: (e: React.PointerEvent, id: string, port: string) => void;
}

export const HarnessNode: React.FC<HarnessNodeProps> = ({
  component,
  x,
  y,
  isSelected,
  viewMode,
  onSelect,
  onOpenDefinition,
  onStartDrag,
  onStartPortDrag,
}) => {
  const isAgent = component.kind === 'agent';
  const isRoot = isAgent && (component.id === 'root_orchestrator' || component.name.toLowerCase().includes('orchestrator'));
  const isSequential = isAgent && component.agentClass === 'SequentialAgent';
  const isWorkflow = component.kind === 'workflow';

  // Choose icon
  const renderIcon = () => {
    if (isWorkflow) return <Workflow size={16} />;
    if (isSequential) return <Layers size={16} />;
    return <Bot size={16} />;
  };

  return (
    <div
      className={`hs-node ${isRoot ? 'root' : ''} ${isSelected ? 'selected' : ''}`}
      style={{ left: `${x}px`, top: `${y}px` }}
      onPointerDown={e => onStartDrag(e, component.id)}
      onClick={e => {
        e.stopPropagation();
        onSelect(component.id);
      }}
    >
      {/* Ports */}
      <div
        className="hs-port left"
        title="Input connection port"
        onPointerDown={e => {
          e.stopPropagation();
          onStartPortDrag(e, component.id, 'left');
        }}
      />
      <div
        className="hs-port right"
        title="Output connection port"
        onPointerDown={e => {
          e.stopPropagation();
          onStartPortDrag(e, component.id, 'right');
        }}
      />
      <div
        className="hs-port top"
        title="Top port"
        onPointerDown={e => {
          e.stopPropagation();
          onStartPortDrag(e, component.id, 'top');
        }}
      />
      <div
        className="hs-port bottom"
        title="Bottom port"
        onPointerDown={e => {
          e.stopPropagation();
          onStartPortDrag(e, component.id, 'bottom');
        }}
      />

      <div className="hs-node-header">
        <div className="hs-node-icon">{renderIcon()}</div>
        <div className="hs-node-titles">
          <div className="hs-node-title" title={component.name}>
            {component.name}
          </div>
          <div className="hs-node-sub">
            {isAgent ? component.agentClass : 'Workflow Graph'}
          </div>
        </div>
      </div>

      <div className="hs-node-tags">
        {isAgent && component.origin.filePath && (
          <span className="hs-node-tag config-path" title={component.origin.filePath}>
            {component.origin.filePath.split('/').pop()}
          </span>
        )}
        {isAgent && component.origin.source === 'python' && (
          <span className="hs-node-tag python">Python</span>
        )}
        {isSequential && (
          <span className="hs-node-tag" style={{ color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
            Legacy Template
          </span>
        )}
        {isWorkflow && (
          <span className="hs-node-tag" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            ADK 2.x Graph
          </span>
        )}
      </div>

      <div className="hs-node-footer">
        <span>{isAgent ? `${component.tools?.length || 0} tools` : `${component.nodes.length} nodes`}</span>
        {isAgent && component.origin.filePath && onOpenDefinition && !isRoot && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '2px 5px', fontSize: '9px', display: 'flex', alignItems: 'center', gap: 3 }}
            onClick={e => {
              e.stopPropagation();
              onOpenDefinition(component.origin.filePath!);
            }}
            title="Open definition in YAML source"
          >
            <span>Open</span>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    </div>
  );
};
