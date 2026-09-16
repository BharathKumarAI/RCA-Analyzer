// RCA assist Agent Harness Studio Canonical Domain Model

export interface AdkCompatibility {
  adkVersion: string; // e.g. "2.0.0"
  agentConfigSchemaVersion?: string;
  features: {
    agentConfig: boolean;
    workflowRuntime: boolean;
    taskApi: boolean;
    plugins: boolean;
    a2a: boolean;
  };
}

export type ComponentSourceType = 'adk_yaml' | 'python' | 'rca_assist_registry' | 'generated' | 'external';

export interface ComponentOrigin {
  source: ComponentSourceType;
  editable: boolean;
  filePath?: string;
  componentId?: string;
}

export interface ComponentSchemaDescriptor {
  source: 'rca_assist_registry' | 'explicit_json_schema' | 'adk_config_type' | 'pydantic' | 'none';
  schema?: Record<string, unknown>;
}

export type AdkNodeReference =
  | { type: 'config_path'; path: string }
  | { type: 'code'; reference: string; package?: string }
  | { type: 'registry'; componentId: string; version?: string }
  | { type: 'inline'; node: AdkAgentComponent | AdkWorkflowComponent };

export interface AdkAgentComponent {
  kind: 'agent';
  id: string;
  agentClass: 'LlmAgent' | 'SequentialAgent' | 'ParallelAgent' | 'LoopAgent' | 'custom' | string;
  name: string;
  model?: string;
  modelProfile?: string;
  stageModel?: string;
  description?: string;
  instruction?: string;
  sub_agents?: AdkNodeReference[];
  tools?: Array<{ name: string; args?: Record<string, unknown> }>;
  generate_content_config?: Record<string, unknown>;
  config_path?: string;
  custom_config?: Record<string, unknown>;
  schemaDescriptor?: ComponentSchemaDescriptor;
  origin: ComponentOrigin;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: 'agent' | 'function' | 'router' | 'join' | 'dynamic' | 'human_approval' | 'start' | 'end';
  agentRef?: AdkNodeReference;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  fromNode: string;
  toNode: string;
  condition?: string;
  label?: string;
}

export interface AdkWorkflowComponent {
  kind: 'workflow';
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  origin: ComponentOrigin;
}

export type AdkComponent = AdkAgentComponent | AdkWorkflowComponent;

export interface ConnectorBinding {
  capabilityId: string;
  connectorId: string;
  scope: 'global' | 'project' | 'environment';
  projectEnvironment?: string;
  connectorEnvironment?: string;
  parameterOverrides?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  enabled: boolean;
}

export interface ToolBinding {
  id: string;
  name: string;
  requiredConnectorId?: string;
  scope: 'global' | 'project' | 'environment';
  enabled: boolean;
  description?: string;
}

export interface RegistryComponent {
  id: string;
  name: string;
  kind: 'agent' | 'workflow' | 'tool' | 'plugin';
  description?: string;
  implementation: {
    type: 'python' | 'builtin' | 'mcp' | 'a2a';
    reference: string;
  };
  permissions: {
    tools: string[];
    connectors: string[];
    secrets: string[];
    network: { outbound: 'none' | 'restricted' | 'full'; allowedHosts?: string[] };
    environments: string[];
  };
  configuration?: {
    schema?: Record<string, unknown>;
  };
  compatibility: { adk: string };
  status: 'approved' | 'dev_only' | 'restricted';
}

export interface ConfigFileDefinition {
  path: string;
  content: string;
  isDirty?: boolean;
  kind: 'adk_agent' | 'rca_assist_harness' | 'env_example';
}

export type HarnessEdgeRelation =
  | 'sub_agent'
  | 'workflow'
  | 'tool'
  | 'skill'
  | 'plugin'
  | 'mcp'
  | 'a2a'
  | 'memory'
  | 'policy'
  | 'evaluation';

export interface HarnessEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: HarnessEdgeRelation;
  reference?: {
    type: 'config_path' | 'code' | 'inline' | 'registry';
    value?: string;
  };
  enabled: boolean;
  label?: string;
}

export interface HarnessDefinition {
  apiVersion: 'rca_assist/v1';
  compatibility: AdkCompatibility;
  metadata: {
    id: string;
    name: string;
    projectId: string;
    tenantId: string;
    version: number;
    revision: string;
    etag?: string;
    updatedAt: string;
    updatedBy: string;
    description?: string;
    tags?: string[];
  };
  adk: {
    root: AdkNodeReference;
    components: Record<string, AdkComponent>;
    configurationFiles: ConfigFileDefinition[];
    activeFilePath: string;
  };
  harness: {
    tools: ToolBinding[];
    connectors: ConnectorBinding[];
    skills: Array<{ id: string; version: string; agentId?: string; enabled: boolean; instruction?: string }>;
    memory: Array<{ id: string; type: 'working' | 'long_term' | 'artifact'; agentId?: string; config: Record<string, unknown> }>;
    policies: Array<{ id: string; type: 'guardrail' | 'privacy' | 'approval' | 'budget' | 'access'; config: Record<string, unknown> }>;
    optimizers: Array<{ id: string; type: 'context' | 'prompt' | 'cache' | 'reranker'; config: Record<string, unknown> }>;
    evaluations: Array<{ id: string; type: 'assertion' | 'dataset' | 'regression_gate'; config: Record<string, unknown> }>;
    observability: { tracing: boolean; feedback: boolean };
    extensions: Record<string, unknown>;
  };
  /** Server-resolved graph. Kept alongside the legacy ADK model so Studio can
   * render workflow, join, tool and governance nodes without inventing them
   * from client-side heuristics. */
  runtimeGraph?: {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      parent?: string | null;
      ref?: string | null;
      source?: string | null;
      enabled?: boolean;
      editable?: boolean;
      reason?: string | null;
      details?: Record<string, unknown>;
    }>;
    edges: Array<{ source: string; target: string; kind: string; label?: string | null }>;
  };
}

export type StudioViewMode = 'runtime' | 'configuration' | 'harness' | 'all';

export interface ExecutionSpan {
  id: string;
  nodeId: string;
  name: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  model?: string;
  tokens?: { prompt: number; completion: number; total: number };
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  policyDecisions?: Array<{ policy: string; action: 'allow' | 'block' | 'redact'; reason?: string }>;
  error?: string;
}

export interface TraceEdge {
  fromSpan: string;
  toSpan: string;
}

export interface ExecutionTrace {
  runId: string;
  spans: ExecutionSpan[];
  edges: TraceEdge[];
  totalDurationMs: number;
}

export interface HarnessHealthScore {
  overall: number; // 0-100
  architecture: number;
  governance: number;
  reliability: number;
  observability: number;
  evaluation: number;
  findings: Array<{
    severity: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    nodeId?: string;
    remediation?: string;
  }>;
}
