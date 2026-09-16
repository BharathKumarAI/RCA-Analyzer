/** Mirrors app/runtime/visuals.py. Visuals are saved data, never executable markup. */
export type VisualBasis = 'observed' | 'inferred';
export interface CitedDatum { basis: VisualBasis; evidence_ids: string[] }
interface VisualBase { id: string; title: string; description: string }
export interface ChartPoint extends CitedDatum { label: string; value: number | null }
export interface ChartVisual extends VisualBase {
  kind: 'chart'; chart_type: 'bar' | 'line'; x_label: string; y_label: string; unit: string; points: ChartPoint[];
}
export interface TableColumn { id: string; label: string; data_type: 'text' | 'number' | 'boolean' | 'timestamp'; unit: string | null }
export interface TableRow extends CitedDatum { cells: Array<string | number | boolean | null> }
export interface TableVisual extends VisualBase { kind: 'table'; columns: TableColumn[]; rows: TableRow[] }
export interface CodeVisual extends VisualBase, CitedDatum {
  kind: 'code'; language: 'text' | 'json' | 'yaml' | 'sql' | 'python' | 'javascript' | 'typescript' | 'shell' | 'java' | 'xml' | 'diff' | 'mermaid'; code: string;
}
export interface GraphNode extends CitedDatum {
  id: string; label: string; node_type: 'service' | 'database' | 'queue' | 'host' | 'deployment' | 'external' | 'other';
  status: 'affected' | 'degraded' | 'healthy' | 'unknown';
}
export interface GraphEdge extends CitedDatum { id: string; source: string; target: string; label: string }
export interface GraphVisual extends VisualBase {
  kind: 'graph' | 'service_map' | 'blast_radius'; nodes: GraphNode[]; edges: GraphEdge[]; focus_node_ids: string[];
}
export type AnswerVisual = ChartVisual | TableVisual | CodeVisual | GraphVisual;
