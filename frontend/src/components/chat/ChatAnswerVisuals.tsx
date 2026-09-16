import { useId, useState } from 'react';
import type { AnswerVisual, ChartVisual, CodeVisual, GraphVisual, TableVisual } from '../../types/visuals';
import './answer-visuals.css';
import { MarkdownCodeBlock } from '../MarkdownCodeBlock';

type SourceAction = (evidenceId?: string) => void;
const formatValue = (value: string | number | boolean | null) => value === null ? 'Unknown' : typeof value === 'number' ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(value) : String(value);

function Sources({ ids, onInspectSources }: { ids: string[]; onInspectSources?: SourceAction }) {
  return <span className="answer-visual-sources">{ids.map((id, index) => <button key={id} type="button" className="answer-visual-source" disabled={!onInspectSources} title={`Inspect evidence ${id}`} onClick={() => onInspectSources?.(id)}>Source {index + 1}<span className="answer-visual-sr-only">: {id}</span></button>)}</span>;
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return <div className="answer-visual-toggle" aria-label="Display format"><button type="button" aria-pressed={!table} onClick={() => onChange(false)}>Visual</button><button type="button" aria-pressed={table} onClick={() => onChange(true)}>Data table</button></div>;
}

/** Gaps remain gaps. The zero baseline is included so bar lengths are not misleading. */
function chartGeometry(points: ChartVisual['points']) {
  const values = points.flatMap(point => point.value === null ? [] : [point.value]);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const width = Math.max(640, points.length * 34 + 110), height = 280;
  // Normalize before subtracting so opposite finite extremes cannot overflow.
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const span = max / scale - min / scale || 1;
  const x = (index: number) => 70 + (index + 0.5) * (width - 95) / points.length;
  const y = (value: number) => 20 + (max / scale - value / scale) / span * 190;
  return { width, height, min, max, x, y };
}

function Chart({ visual, onInspectSources }: { visual: ChartVisual; onInspectSources?: SourceAction }) {
  const [table, setTable] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chart = chartGeometry(visual.points);
  const selected = selectedIndex === null ? null : visual.points[selectedIndex];
  const selectPoint = (index: number) => setSelectedIndex(index);
  return <>
    <ViewToggle table={table} onChange={setTable} />
    <p className="answer-visual-note">{visual.y_label} ({visual.unit}) · {visual.x_label}. Select a point to inspect its sources. Missing values remain unknown.</p>
    {table ? <div className="answer-visual-scroll"><table><caption>{visual.title} — recorded data</caption><thead><tr><th scope="col">{visual.x_label}</th><th scope="col">{visual.y_label} ({visual.unit})</th><th scope="col">Basis</th><th scope="col">Evidence</th></tr></thead><tbody>{visual.points.map(point => <tr key={point.label}><th scope="row">{point.label}</th><td>{formatValue(point.value)}</td><td>{point.basis}</td><td><Sources ids={point.evidence_ids} onInspectSources={onInspectSources} /></td></tr>)}</tbody></table></div> : <div className="answer-visual-scroll">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} width={chart.width} height={chart.height} role="group" aria-label={`${visual.title}, ${visual.chart_type} chart in ${visual.unit}`}>
        {[chart.min, chart.min / 2 + chart.max / 2, chart.max].filter((value, index, values) => values.indexOf(value) === index).map(value => <g key={value}><line x1={65} x2={chart.width - 20} y1={chart.y(value)} y2={chart.y(value)} className="answer-chart-grid" /><text x={60} y={chart.y(value) + 4} textAnchor="end" className="answer-chart-label">{formatValue(value)}</text></g>)}
        {visual.chart_type === 'line' && visual.points.map((point, index) => {
          const previous = visual.points[index - 1];
          return point.value !== null && previous?.value != null ? <line key={point.label} x1={chart.x(index - 1)} y1={chart.y(previous.value)} x2={chart.x(index)} y2={chart.y(point.value)} className={`answer-chart-line ${point.basis === 'inferred' || previous.basis === 'inferred' ? 'is-inferred' : ''}`} /> : null;
        })}
        {visual.points.map((point, index) => <g key={point.label} role="button" tabIndex={0} aria-label={`${point.label}: ${formatValue(point.value)} ${point.value === null ? '' : visual.unit}, ${point.basis}; inspect sources`} aria-pressed={selectedIndex === index} className={`answer-chart-point ${point.basis === 'inferred' ? 'is-inferred' : ''}`} onClick={() => selectPoint(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(index); } }}>
          <title>{`${point.label}: ${formatValue(point.value)} ${point.value === null ? '' : visual.unit} (${point.basis})`}</title>
          {point.value === null ? <text x={chart.x(index)} y={225} textAnchor="middle" className="answer-chart-label">?</text> : visual.chart_type === 'bar' ? <rect x={chart.x(index) - 10} y={Math.min(chart.y(point.value), chart.y(0)) - (point.value === 0 ? 1 : 0)} width={20} height={Math.max(2, Math.abs(chart.y(point.value) - chart.y(0)))} rx={2} /> : <circle cx={chart.x(index)} cy={chart.y(point.value)} r={selectedIndex === index ? 7 : 5} />}
          <text x={chart.x(index)} y={248} textAnchor="middle" className="answer-chart-label">{point.label.length > 12 ? `${point.label.slice(0, 11)}…` : point.label}</text>
        </g>)}
      </svg>
    </div>}
    <div className="answer-visual-detail" aria-live="polite">{selected ? <><strong>{selected.label}</strong><span>{formatValue(selected.value)} {selected.value === null ? '' : visual.unit} · {selected.basis}</span><Sources ids={selected.evidence_ids} onInspectSources={onInspectSources} /></> : <span>Observed measurements use solid marks; inferred values use dashed outlines.</span>}</div>
  </>;
}

function DataTable({ visual, onInspectSources }: { visual: TableVisual; onInspectSources?: SourceAction }) {
  const [sort, setSort] = useState<{ index: number; direction: 1 | -1 } | null>(null);
  const rows = [...visual.rows];
  if (sort) rows.sort((a, b) => {
    const left = a.cells[sort.index], right = b.cells[sort.index];
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * sort.direction;
  });
  return <div className="answer-visual-scroll"><table><caption>{visual.title} — select a column to sort</caption><thead><tr>{visual.columns.map((column, index) => <th key={column.id} scope="col" aria-sort={sort?.index === index ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" className="answer-table-sort" onClick={() => setSort(previous => ({ index, direction: previous?.index === index && previous.direction === 1 ? -1 : 1 }))}>{column.label}{column.unit ? ` (${column.unit})` : ''}{sort?.index === index ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}<th scope="col">Basis</th><th scope="col">Evidence</th></tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.cells.map((cell, columnIndex) => <td key={visual.columns[columnIndex].id}>{formatValue(cell)}</td>)}<td>{row.basis}</td><td><Sources ids={row.evidence_ids} onInspectSources={onInspectSources} /></td></tr>)}</tbody></table></div>;
}

function Code({ visual, onInspectSources }: { visual: CodeVisual; onInspectSources?: SourceAction }) {
  const [copyState, setCopyState] = useState<string | null>(null);
  if (visual.language === 'mermaid') return <><MarkdownCodeBlock language="mermaid" source={visual.code} /><p className="answer-visual-note">{visual.basis === 'observed' ? 'Source diagram' : 'Inferred diagram; verify against the cited evidence'}</p><Sources ids={visual.evidence_ids} onInspectSources={onInspectSources} /></>;
  return <><div className="answer-visual-toolbar"><span>{visual.language} · {visual.basis === 'observed' ? 'Source excerpt' : 'Suggested snippet; review before use'}</span><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(visual.code); setCopyState('Copied'); } catch { setCopyState('Copy failed. Select and copy the text manually.'); } }}>Copy text</button></div><pre tabIndex={0} aria-label={`${visual.language} code, display only`}><code>{visual.code}</code></pre><p className="answer-visual-note">This snippet is displayed only; it has not been executed.</p>{copyState && <p role="status">{copyState}</p>}<Sources ids={visual.evidence_ids} onInspectSources={onInspectSources} /></>;
}

function graphLayout(visual: GraphVisual) {
  const columns = Math.min(4, visual.nodes.length);
  return { width: Math.max(440, columns * 205), height: Math.max(190, Math.ceil(visual.nodes.length / columns) * 120), positions: new Map(visual.nodes.map((node, index) => [node.id, { x: 105 + index % columns * 205, y: 65 + Math.floor(index / columns) * 120 }])) };
}

function Graph({ visual, onInspectSources }: { visual: GraphVisual; onInspectSources?: SourceAction }) {
  const [table, setTable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(visual.focus_node_ids[0] || null);
  const [observedOnly, setObservedOnly] = useState(false);
  const markerId = useId().replaceAll(':', '');
  const layout = graphLayout(visual);
  const edges = visual.edges.filter(edge => !observedOnly || edge.basis === 'observed');
  const selected = visual.nodes.find(node => node.id === selectedId);
  const connections = selectedId ? edges.filter(edge => edge.source === selectedId || edge.target === selectedId) : edges;
  const nodesById = new Map(visual.nodes.map(node => [node.id, node]));
  return <>
    <div className="answer-visual-toolbar"><ViewToggle table={table} onChange={setTable} /><label><input type="checkbox" checked={observedOnly} onChange={event => setObservedOnly(event.target.checked)} /> Observed relationships only</label></div>
    <p className="answer-visual-note">{visual.kind === 'blast_radius' ? 'Affected scope reported in the evidence; focus nodes are outlined. ' : ''}Select a node to inspect its relationships and sources. Dashed lines are inferred; unknown status is not healthy.</p>
    {table ? <div className="answer-visual-scroll"><table><caption>{visual.title} — nodes</caption><thead><tr><th scope="col">Node</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Basis</th><th scope="col">Evidence</th></tr></thead><tbody>{visual.nodes.map(node => <tr key={node.id}><th scope="row"><button type="button" className="answer-table-sort" aria-pressed={selectedId === node.id} onClick={() => setSelectedId(node.id)}>{node.label}{visual.focus_node_ids.includes(node.id) ? ' (focus)' : ''}</button></th><td>{node.node_type}</td><td>{node.status}</td><td>{node.basis}</td><td><Sources ids={node.evidence_ids} onInspectSources={onInspectSources} /></td></tr>)}</tbody></table></div> : <div className="answer-visual-scroll"><svg role="group" aria-label={`${visual.title}, ${visual.nodes.length} nodes and ${edges.length} relationships`} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height}>
      <defs><marker id={markerId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {edges.map(edge => {
        const source = layout.positions.get(edge.source)!, target = layout.positions.get(edge.target)!;
        const active = selectedId === edge.source || selectedId === edge.target;
        return <g key={edge.id} className={`answer-graph-edge ${edge.basis === 'inferred' ? 'is-inferred' : ''} ${active ? 'is-active' : ''}`}><title>{`${nodesById.get(edge.source)?.label} → ${nodesById.get(edge.target)?.label}: ${edge.label} (${edge.basis})`}</title><path d={edge.source === edge.target ? `M${source.x + 55},${source.y - 25} C${source.x + 120},${source.y - 80} ${source.x - 120},${source.y - 80} ${source.x - 55},${source.y - 25}` : `M${source.x},${source.y + 26} L${target.x},${target.y - 31}`} markerEnd={`url(#${markerId})`} /></g>;
      })}
      {visual.nodes.map(node => {
        const position = layout.positions.get(node.id)!;
        return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.label}, ${node.node_type}, ${node.status}, ${node.basis}`} aria-pressed={selectedId === node.id} className={`answer-graph-node status-${node.status} ${selectedId === node.id || visual.focus_node_ids.includes(node.id) ? 'is-selected' : ''}`} onClick={() => setSelectedId(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}><title>{`${node.label} (${node.status}; ${node.basis})`}</title><rect x={position.x - 84} y={position.y - 30} width={168} height={62} rx={8} /><text x={position.x} y={position.y - 5} textAnchor="middle">{node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}</text><text x={position.x} y={position.y + 15} textAnchor="middle" className="answer-graph-meta">{node.status} · {node.basis}</text></g>;
      })}
    </svg></div>}
    {selected && <div className="answer-visual-detail" aria-live="polite"><strong>{selected.label}</strong><span>{selected.node_type} · {selected.status} · {selected.basis}</span><Sources ids={selected.evidence_ids} onInspectSources={onInspectSources} /><button type="button" onClick={() => setSelectedId(null)}>Show all relationships</button></div>}
    <div className="answer-visual-scroll"><table><caption>{selected ? `Relationships involving ${selected.label}` : 'Recorded relationships'}{observedOnly ? ' (observed only)' : ''}</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Relationship</th><th scope="col">Basis</th><th scope="col">Evidence</th></tr></thead><tbody>{connections.map(edge => <tr key={edge.id}><td>{nodesById.get(edge.source)?.label}</td><td>{nodesById.get(edge.target)?.label}</td><td>{edge.label}</td><td>{edge.basis}</td><td><Sources ids={edge.evidence_ids} onInspectSources={onInspectSources} /></td></tr>)}</tbody></table>{!connections.length && <p>No recorded relationships match this selection.</p>}</div>
  </>;
}

export function ChatAnswerVisuals({ visuals, onInspectSources }: { visuals: AnswerVisual[]; onInspectSources?: SourceAction }) {
  return <div className="answer-visuals">{visuals.map(visual => <section key={visual.id} className="answer-visual" aria-label={visual.title}><header><span className="answer-visual-kind">{visual.kind.replaceAll('_', ' ')}</span><h3>{visual.title}</h3>{visual.description && <p>{visual.description}</p>}</header>
    {visual.kind === 'chart' ? <Chart visual={visual} onInspectSources={onInspectSources} /> : visual.kind === 'table' ? <DataTable visual={visual} onInspectSources={onInspectSources} /> : visual.kind === 'code' ? <Code visual={visual} onInspectSources={onInspectSources} /> : <Graph visual={visual} onInspectSources={onInspectSources} />}
  </section>)}</div>;
}
