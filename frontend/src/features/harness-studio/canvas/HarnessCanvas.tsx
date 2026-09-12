import React, { useState, useRef, useEffect } from 'react';
import { HarnessDefinition, StudioViewMode, HarnessEdge } from '../types/harness';
import { HarnessNode } from './HarnessNode';
import { CanvasControls } from './CanvasControls';

interface HarnessCanvasProps {
  harness: HarnessDefinition;
  viewMode: StudioViewMode;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onOpenDefinition: (filePath: string) => void;
  onChangeViewMode: (mode: StudioViewMode) => void;
  onConnectNodes?: (sourceId: string, targetId: string) => void;
}

interface NodePosition {
  x: number;
  y: number;
}

export const HarnessCanvas: React.FC<HarnessCanvasProps> = ({
  harness,
  viewMode,
  selectedNodeId,
  onSelectNode,
  onOpenDefinition,
  onChangeViewMode,
  onConnectNodes,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Node positions map
  const [positions, setPositions] = useState<Record<string, NodePosition>>({});

  // Active dragging node
  const [dragNode, setDragNode] = useState<{ id: string; startX: number; startY: number; nodeStartX: number; nodeStartY: number } | null>(null);

  // Active port connecting wire
  const [connecting, setConnecting] = useState<{ sourceId: string; port: string; currentX: number; currentY: number } | null>(null);

  // Initialize layout positions
  useEffect(() => {
    const newPos: Record<string, NodePosition> = { ...positions };
    const comps = Object.values(harness.adk.components);

    let placed = 0;
    comps.forEach(comp => {
      if (!newPos[comp.id]) {
        if (comp.id === 'root_orchestrator' || comp.name.toLowerCase().includes('orchestrator')) {
          newPos[comp.id] = { x: 380, y: 80 };
        } else {
          newPos[comp.id] = { x: 140 + (placed % 3) * 290, y: 300 + Math.floor(placed / 3) * 160 };
          placed++;
        }
      }
    });
    setPositions(newPos);
  }, [harness.adk.components]);

  // Canvas Pan Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 0 && e.target === containerRef.current) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      onSelectNode(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
    } else if (dragNode) {
      const dx = (e.clientX - dragNode.startX) / zoom;
      const dy = (e.clientY - dragNode.startY) / zoom;
      setPositions(prev => ({
        ...prev,
        [dragNode.id]: {
          x: Math.max(0, dragNode.nodeStartX + dx),
          y: Math.max(0, dragNode.nodeStartY + dy),
        },
      }));
    } else if (connecting && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setConnecting({
        ...connecting,
        currentX: (e.clientX - rect.left - pan.x) / zoom,
        currentY: (e.clientY - rect.top - pan.y) / zoom,
      });
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setDragNode(null);
    setConnecting(null);
  };

  // Node Dragging
  const handleStartDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const current = positions[id] || { x: 0, y: 0 };
    setDragNode({
      id,
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: current.x,
      nodeStartY: current.y,
    });
    onSelectNode(id);
  };

  // Port Dragging (Connecting)
  const handleStartPortDrag = (e: React.PointerEvent, id: string, port: string) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setConnecting({
      sourceId: id,
      port,
      currentX: (e.clientX - rect.left - pan.x) / zoom,
      currentY: (e.clientY - rect.top - pan.y) / zoom,
    });
  };

  // Build edges from subagents and tools
  const edges: Array<{ id: string; fromId: string; toId: string; label: string; relation: string }> = [];
  Object.values(harness.adk.components).forEach(comp => {
    if (comp.kind === 'agent' && comp.sub_agents) {
      comp.sub_agents.forEach(sub => {
        let targetId = '';
        let label = 'subagent';
        if (sub.type === 'config_path') {
          const match = Object.values(harness.adk.components).find(c => c.origin.filePath === sub.path);
          if (match) {
            targetId = match.id;
            label = sub.path.split('/').pop() || 'config_path';
          }
        } else if (sub.type === 'code') {
          targetId = sub.reference;
          label = 'python:code';
        }

        if (targetId && positions[comp.id] && positions[targetId]) {
          edges.push({
            id: `edge_${comp.id}_${targetId}`,
            fromId: comp.id,
            toId: targetId,
            label,
            relation: 'sub_agent',
          });
        }
      });
    }
  });

  return (
    <div
      ref={containerRef}
      className="hs-canvas-container"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="hs-canvas-world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG Wire Layer */}
        <svg className="hs-svg-wires">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--hs-wire-stroke, #58a6ff)" />
            </marker>
          </defs>

          {edges.map(edge => {
            const p1 = positions[edge.fromId];
            const p2 = positions[edge.toId];
            if (!p1 || !p2) return null;

            const x1 = p1.x + 110;
            const y1 = p1.y + 110;
            const x2 = p2.x + 110;
            const y2 = p2.y;

            const dy = Math.abs(y2 - y1) * 0.5;
            const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;

            return (
              <g key={edge.id} className="hs-wire-group">
                <path d={d} className="hs-wire-base" markerEnd="url(#arrow)" />
                {viewMode !== 'runtime' && (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} className="hs-wire-caption" textAnchor="middle">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Active connecting wire */}
          {connecting && positions[connecting.sourceId] && (
            <path
              d={`M ${positions[connecting.sourceId].x + 110} ${positions[connecting.sourceId].y + 60} L ${connecting.currentX} ${connecting.currentY}`}
              stroke="#ff946e"
              strokeWidth="2"
              strokeDasharray="5,5"
              fill="none"
            />
          )}
        </svg>

        {/* Nodes Layer */}
        {Object.values(harness.adk.components).map(comp => {
          const pos = positions[comp.id] || { x: 100, y: 100 };
          return (
            <HarnessNode
              key={comp.id}
              component={comp}
              x={pos.x}
              y={pos.y}
              isSelected={selectedNodeId === comp.id}
              viewMode={viewMode}
              onSelect={onSelectNode}
              onOpenDefinition={onOpenDefinition}
              onStartDrag={handleStartDrag}
              onStartPortDrag={handleStartPortDrag}
            />
          );
        })}
      </div>

      <CanvasControls
        zoom={zoom}
        viewMode={viewMode}
        onZoomIn={() => setZoom(z => Math.min(2, z + 0.15))}
        onZoomOut={() => setZoom(z => Math.max(0.4, z - 0.15))}
        onFit={() => {
          setZoom(1);
          setPan({ x: 60, y: 60 });
        }}
        onChangeViewMode={onChangeViewMode}
      />
    </div>
  );
};
