import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, Search, Workflow, Bot, GitBranch, Wrench, ShieldCheck } from 'lucide-react';
import type { HarnessDefinition } from '../types/harness';

interface StudioGraphCanvasProps {
  harness: HarnessDefinition;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

type Position = { x: number; y: number };

const kindIcon = (kind: string) => {
  const normalized = kind.toLowerCase();
  if (normalized.includes('tool') || normalized.includes('connector')) return <Wrench size={14} />;
  if (normalized.includes('join') || normalized.includes('parallel') || normalized.includes('branch')) return <GitBranch size={14} />;
  if (normalized.includes('policy') || normalized.includes('governance')) return <ShieldCheck size={14} />;
  if (normalized.includes('workflow') || normalized.includes('group')) return <Workflow size={14} />;
  return <Bot size={14} />;
};

export const StudioGraphCanvas: React.FC<StudioGraphCanvasProps> = ({ harness, selectedNodeId, onSelectNode }) => {
  const graph = harness.runtimeGraph;
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 52, y: 44 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number; start: Position } | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; start: Position } | null>(null);

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const childrenByParent = useMemo(() => {
    const result = new Map<string, string[]>();
    nodes.forEach(node => {
      if (node.parent) result.set(node.parent, [...(result.get(node.parent) || []), node.id]);
    });
    return result;
  }, [nodes]);

  useEffect(() => {
    const next: Record<string, Position> = {};
    const roots = nodes.filter(node => !node.parent);
    roots.forEach((node, index) => {
      const prior = positions[node.id];
      next[node.id] = prior || { x: 70 + (index % 3) * 300, y: 58 + Math.floor(index / 3) * 190 };
      const children = childrenByParent.get(node.id) || [];
      children.forEach((childId, childIndex) => {
        const childPrior = positions[childId];
        next[childId] = childPrior || { x: next[node.id].x + (childIndex % 2) * 260, y: next[node.id].y + 142 + Math.floor(childIndex / 2) * 148 };
      });
    });
    nodes.forEach((node, index) => {
      if (!next[node.id]) next[node.id] = positions[node.id] || { x: 70 + (index % 4) * 260, y: 60 + Math.floor(index / 4) * 170 };
    });
    setPositions(next);
    // Keep expansion state scoped to nodes that still exist after a server refresh.
    setCollapsed(current => new Set([...current].filter(id => nodes.some(node => node.id === id))));
  }, [nodes, childrenByParent]);

  const visibleNodes = useMemo(() => {
    const collapsedParents = new Set([...collapsed]);
    return nodes.filter(node => {
      let parent = node.parent;
      while (parent) {
        if (collapsedParents.has(parent)) return false;
        parent = nodes.find(candidate => candidate.id === parent)?.parent || null;
      }
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return node.label.toLowerCase().includes(needle) || node.kind.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
    });
  }, [nodes, collapsed, query]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const visibleEdges = edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  const handlePointerMove = (event: React.PointerEvent) => {
    if (dragging) {
      const dx = (event.clientX - dragging.x) / zoom;
      const dy = (event.clientY - dragging.y) / zoom;
      setPositions(current => ({ ...current, [dragging.id]: { x: Math.max(16, dragging.start.x + dx), y: Math.max(16, dragging.start.y + dy) } }));
    } else if (panning) {
      setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
    }
  };
  const stopPointer = () => { setDragging(null); setPanning(null); };
  const fit = () => { setZoom(1); setPan({ x: 52, y: 44 }); };

  if (!graph) {
    return <div className="hs-graph-empty">The server has not returned a resolved graph yet.</div>;
  }

  return (
    <div
      ref={containerRef}
      className="hs-canvas-container hs-graph-canvas"
      onPointerMove={handlePointerMove}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
      onPointerDown={event => {
        if (event.target === event.currentTarget) {
          setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y, start: pan });
          onSelectNode(null);
        }
      }}
    >
      <div className="hs-graph-toolbar">
        <div className="hs-graph-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find component" aria-label="Find component" /></div>
        <span className="hs-graph-count">{visibleNodes.length}/{nodes.length} nodes</span>
      </div>
      <div className="hs-graph-controls">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.55, value - 0.1))}><Minus size={13} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(1.8, value + 0.1))}><Plus size={13} /></button>
        <button type="button" aria-label="Fit graph" onClick={fit}><Maximize2 size={13} /></button>
      </div>
      <div className="hs-canvas-world hs-graph-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="hs-svg-wires" width="5000" height="5000" aria-hidden="true">
          <defs><marker id="studio-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--hs-wire-stroke)" /></marker></defs>
          {visibleEdges.map(edge => {
            const source = positions[edge.source]; const target = positions[edge.target];
            if (!source || !target) return null;
            const x1 = source.x + 112; const y1 = source.y + 88; const x2 = target.x + 112; const y2 = target.y;
            const curve = Math.max(34, Math.abs(y2 - y1) * 0.48);
            return <g key={`${edge.source}:${edge.target}:${edge.kind}`}><path className="hs-wire-base" markerEnd="url(#studio-arrow)" d={`M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`} />{edge.label && <text className="hs-wire-caption" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle">{edge.label}</text>}</g>;
          })}
        </svg>
        {visibleNodes.map(node => {
          const position = positions[node.id] || { x: 60, y: 60 };
          const hasChildren = (childrenByParent.get(node.id) || []).length > 0;
          const isCollapsed = collapsed.has(node.id);
          const selected = selectedNodeId === node.id;
          return (
            <div
              key={node.id}
              className={`hs-graph-node ${selected ? 'selected' : ''} ${node.enabled === false ? 'disabled' : ''} ${hasChildren ? 'group' : ''}`}
              style={{ left: position.x, top: position.y }}
              onPointerDown={event => { event.stopPropagation(); setDragging({ id: node.id, x: event.clientX, y: event.clientY, start: position }); onSelectNode(node.id); }}
              onClick={event => { event.stopPropagation(); onSelectNode(node.id); }}
            >
              <div className="hs-graph-node-head"><span className="hs-graph-node-icon">{kindIcon(node.kind)}</span><span className="hs-graph-node-kind">{node.kind}</span>{hasChildren && <button type="button" className="hs-graph-collapse" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.label}`} onClick={event => { event.stopPropagation(); setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}>{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}</div>
              <div className="hs-graph-node-label">{node.label}</div>
              <div className="hs-graph-node-meta">{node.ref || node.source || node.id}</div>
              {node.reason && <div className="hs-graph-node-reason">{node.reason}</div>}
              {hasChildren && <div className="hs-graph-node-children">{isCollapsed ? `${(childrenByParent.get(node.id) || []).length} internal components hidden` : `${(childrenByParent.get(node.id) || []).length} internal components`}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
