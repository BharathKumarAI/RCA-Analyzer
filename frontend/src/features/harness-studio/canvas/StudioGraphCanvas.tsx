import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, Search, Workflow, Bot, GitBranch, Wrench, ShieldCheck } from 'lucide-react';
import type { HarnessDefinition } from '../types/harness';
import type { StudioTrace } from '../harnessApi';

interface StudioGraphCanvasProps {
  harness: HarnessDefinition;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  trace?: StudioTrace | null;
}

type Position = { x: number; y: number };

const NODE_WIDTH = 224;
const NODE_HEIGHT = 132;
const COLUMN_GAP = 96;
const ROW_GAP = 42;
const DEPENDENCY_KINDS = new Set(['model', 'model_profile', 'tool', 'connector', 'skill', 'policy', 'governance', 'binding', 'dependency']);
const EXECUTION_KINDS = new Set(['execution', 'delegation', 'branch', 'join']);
const isDependencyEdgeKind = (kind: string) => !EXECUTION_KINDS.has(kind.toLowerCase()) && !/sub.?agent|workflow|contains|sequence|parallel|next|execution|delegat|branch|join/.test(kind.toLowerCase());

const kindIcon = (kind: string) => {
  const normalized = kind.toLowerCase();
  if (normalized.includes('tool') || normalized.includes('connector')) return <Wrench size={14} />;
  if (normalized.includes('join') || normalized.includes('parallel') || normalized.includes('branch')) return <GitBranch size={14} />;
  if (normalized.includes('policy') || normalized.includes('governance')) return <ShieldCheck size={14} />;
  if (normalized.includes('workflow') || normalized.includes('group')) return <Workflow size={14} />;
  return <Bot size={14} />;
};

export const StudioGraphCanvas: React.FC<StudioGraphCanvasProps> = ({ harness, selectedNodeId, onSelectNode, trace }) => {
  const graph = trace?.graph || harness.runtimeGraph;
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 52, y: 44 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [layoutRevision, setLayoutRevision] = useState(0);
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

  const dependencyNodeIds = useMemo(() => {
    return new Set(nodes.filter(node => DEPENDENCY_KINDS.has(node.kind.toLowerCase())).map(node => node.id));
  }, [nodes, edges]);

  const graphKey = useMemo(() => nodes.map(node => `${node.id}:${node.parent || ''}`).join('|'), [nodes]);
  useEffect(() => {
    const next: Record<string, Position> = {};
    const rowStep = NODE_HEIGHT + ROW_GAP;
    const columnStep = NODE_WIDTH + COLUMN_GAP;
    const hiddenByCollapse = (node: { parent?: string | null }) => {
      let parent = node.parent;
      while (parent) {
        if (collapsed.has(parent)) return true;
        parent = nodes.find(candidate => candidate.id === parent)?.parent || null;
      }
      return false;
    };
    const executionNodes = nodes.filter(node => !dependencyNodeIds.has(node.id) && !hiddenByCollapse(node));
    const executionIds = new Set(executionNodes.map(node => node.id));
    const roots = executionNodes.filter(node => !node.parent || !executionIds.has(node.parent));
    let cursor = 0;
    const layoutTree = (id: string, depth: number): number => {
      const children = (childrenByParent.get(id) || []).filter(childId => executionIds.has(childId));
      if (children.length === 0) {
        const y = cursor * rowStep + 56;
        cursor += 1;
        next[id] = { x: 64 + depth * columnStep, y };
        return y;
      }
      const childYs = children.map(childId => layoutTree(childId, depth + 1));
      const y = Math.max(childYs[0], (childYs[0] + childYs[childYs.length - 1]) / 2);
      next[id] = { x: 64 + depth * columnStep, y };
      return y;
    };
    roots.forEach(root => layoutTree(root.id, 0));
    executionNodes.forEach(node => {
      if (!next[node.id]) next[node.id] = { x: 64, y: cursor++ * rowStep + 56 };
    });
    const selectedDependencyIds = new Set<string>();
    if (selectedNodeId) edges.forEach(edge => {
      if (edge.source === selectedNodeId && isDependencyEdgeKind(edge.kind)) selectedDependencyIds.add(edge.target);
      if (edge.target === selectedNodeId && isDependencyEdgeKind(edge.kind)) selectedDependencyIds.add(edge.source);
    });
    const dependencyNodes = nodes.filter(node => dependencyNodeIds.has(node.id) && selectedDependencyIds.has(node.id));
    const deepest = Math.max(...Object.values(next).map(position => position.x), 64);
    const dependencyX = 64 + (Math.floor((deepest - 64) / columnStep) + 2) * columnStep;
    dependencyNodes.forEach((node, index) => { next[node.id] = { x: dependencyX, y: 56 + index * rowStep }; });
    setPositions(next);
    setLayoutRevision(value => value + 1);
  }, [nodes, edges, childrenByParent, dependencyNodeIds, graphKey, collapsed, selectedNodeId]);
  useEffect(() => {
    setCollapsed(new Set(nodes.filter(node => node.parent &&
      (childrenByParent.get(node.id) || []).length > 0).map(node => node.id)));
  // Reset expansion only when the server changes graph structure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  const visibleNodes = useMemo(() => {
    const collapsedParents = new Set([...collapsed]);
    const selectedDependencyNeighbors = new Set<string>([selectedNodeId || '']);
    if (selectedNodeId) edges.forEach(edge => {
      if (edge.source === selectedNodeId && isDependencyEdgeKind(edge.kind)) selectedDependencyNeighbors.add(edge.target);
      if (edge.target === selectedNodeId && isDependencyEdgeKind(edge.kind)) selectedDependencyNeighbors.add(edge.source);
    });
    return nodes.filter(node => {
      if (dependencyNodeIds.has(node.id) && !selectedDependencyNeighbors.has(node.id)) return false;
      let parent = node.parent;
      while (parent) {
        if (collapsedParents.has(parent)) return false;
        parent = nodes.find(candidate => candidate.id === parent)?.parent || null;
      }
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return node.label.toLowerCase().includes(needle) || node.kind.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
    });
  }, [nodes, collapsed, query, dependencyNodeIds, selectedNodeId, edges]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => {
    const endpoint = (id: string) => {
      let current = id;
      while (!visibleIds.has(current)) {
        const parent = nodes.find(node => node.id === current)?.parent;
        if (!parent) return null;
        current = parent;
      }
      return current;
    };
    const seen = new Set<string>();
    return edges.flatMap(edge => {
      const source = endpoint(edge.source); const target = endpoint(edge.target);
      if (!source || !target || source === target) return [];
      const key = `${source}:${target}:${edge.kind}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...edge, source, target }];
    });
  }, [edges, nodes, visibleIds]);
  const eventStatus = useMemo(() => {
    const status = new Map<string, { state: string; kind: string; details?: Record<string, unknown> }>();
    (trace?.events || []).forEach(event => {
      if (!event.node_id) return;
      const kind = event.kind.toLowerCase();
      const state = kind.includes('fail') || kind.includes('error') ? 'failed' : kind.includes('block') ? 'blocked' : kind.includes('complete') || kind.includes('finish') || kind === 'done' ? 'completed' : kind.includes('start') || kind.includes('running') ? 'running' : status.get(event.node_id)?.state || 'observed';
      status.set(event.node_id, { state, kind: event.kind, details: event.details });
    });
    return status;
  }, [trace]);

  useEffect(() => {
    if (!selectedNodeId) return;
    let current = nodes.find(node => node.id === selectedNodeId)?.parent || null;
    if (!current) return;
    setCollapsed(previous => {
      const next = new Set(previous);
      let changed = false;
      while (current) {
        if (next.delete(current)) changed = true;
        current = nodes.find(node => node.id === current)?.parent || null;
      }
      return changed ? next : previous;
    });
  }, [selectedNodeId, nodes]);

  const selectNode = (nodeId: string) => {
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (node && (childrenByParent.get(node.id) || []).length > 0) {
      setCollapsed(previous => {
        if (!previous.has(node.id)) return previous;
        const next = new Set(previous);
        next.delete(node.id);
        return next;
      });
    }
    onSelectNode(nodeId);
  };

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
  const fit = useCallback(() => {
    const bounds = visibleNodes.reduce((result, node) => {
      const position = positions[node.id];
      if (!position) return result;
      return { minX: Math.min(result.minX, position.x), minY: Math.min(result.minY, position.y), maxX: Math.max(result.maxX, position.x + NODE_WIDTH), maxY: Math.max(result.maxY, position.y + NODE_HEIGHT) };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !Number.isFinite(bounds.minX)) return;
    const padding = 56;
    const scale = Math.max(0.25, Math.min(1.1, (rect.width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX), (rect.height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY)));
    setZoom(scale);
    setPan({ x: padding - bounds.minX * scale, y: padding - bounds.minY * scale });
  }, [positions, visibleNodes]);

  const visibleKey = visibleNodes.map(node => node.id).join('|');
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    fitRef.current();
  }, [layoutRevision, visibleKey]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.25, value - 0.1))}><Minus size={13} /></button>
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
            const x1 = source.x + NODE_WIDTH / 2; const y1 = source.y + NODE_HEIGHT; const x2 = target.x + NODE_WIDTH / 2; const y2 = target.y;
            const curve = Math.max(34, Math.abs(y2 - y1) * 0.48);
            const dependency = isDependencyEdgeKind(edge.kind);
            return <g key={`${edge.source}:${edge.target}:${edge.kind}`}><path className={`hs-wire-base ${dependency ? 'hs-wire-dependency' : ''}`} markerEnd="url(#studio-arrow)" d={`M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`} /><text className="hs-wire-caption" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle">{edge.kind}</text></g>;
          })}
        </svg>
        {visibleNodes.map(node => {
          const position = positions[node.id] || { x: 60, y: 60 };
          const hasChildren = (childrenByParent.get(node.id) || []).length > 0;
          const isCollapsed = collapsed.has(node.id);
          const selected = selectedNodeId === node.id;
          const execution = eventStatus.get(node.id);
          return (
            <div
              key={node.id}
              className={`hs-graph-node ${selected ? 'selected' : ''} ${node.enabled === false ? 'disabled' : ''} ${hasChildren ? 'group' : ''} ${execution ? `run-${execution.state}` : ''}`}
              style={{ left: position.x, top: position.y }}
              onPointerDown={event => { event.stopPropagation(); setDragging({ id: node.id, x: event.clientX, y: event.clientY, start: position }); }}
              onClick={event => { event.stopPropagation(); selectNode(node.id); }}
              role="button"
              tabIndex={0}
              aria-label={`Select ${node.label}`}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } }}
            >
              <div className="hs-graph-node-head"><span className="hs-graph-node-icon">{kindIcon(node.kind)}</span><span className="hs-graph-node-kind">{node.kind}</span>{hasChildren && <button type="button" className="hs-graph-collapse" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.label}`} onClick={event => { event.stopPropagation(); setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}>{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}</div>
              <div className="hs-graph-node-label">{node.label}</div>
              <div className="hs-graph-node-meta">{node.ref || node.source || node.id}</div>
              {execution && <div className="hs-graph-node-run"><span />{execution.state} · {execution.kind}</div>}
              {node.reason && <div className="hs-graph-node-reason">{node.reason}</div>}
              {hasChildren && <div className="hs-graph-node-children">{isCollapsed ? `${(childrenByParent.get(node.id) || []).length} internal components hidden` : `${(childrenByParent.get(node.id) || []).length} internal components`}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
