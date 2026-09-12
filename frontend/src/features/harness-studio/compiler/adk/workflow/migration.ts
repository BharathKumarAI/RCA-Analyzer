import {
  AdkAgentComponent,
  AdkWorkflowComponent,
  WorkflowNode,
  WorkflowEdge,
} from '../../../types/harness';

export function convertSequentialToWorkflow(sequentialAgent: AdkAgentComponent): AdkWorkflowComponent {
  const nodes: WorkflowNode[] = [
    {
      id: 'node_start',
      name: 'START',
      type: 'start',
    },
  ];

  const edges: WorkflowEdge[] = [];
  const subAgents = sequentialAgent.sub_agents || [];

  let prevNodeId = 'node_start';

  subAgents.forEach((sub, idx) => {
    const nodeId = `node_step_${idx + 1}`;
    let label = `Step ${idx + 1}`;
    if (sub.type === 'config_path') {
      label = sub.path.split('/').pop()?.replace(/\.ya?ml$/, '') || label;
    } else if (sub.type === 'code') {
      label = sub.reference.split('.').pop() || label;
    }

    nodes.push({
      id: nodeId,
      name: label,
      type: 'agent',
      agentRef: sub,
    });

    edges.push({
      id: `edge_${prevNodeId}_to_${nodeId}`,
      fromNode: prevNodeId,
      toNode: nodeId,
    });

    prevNodeId = nodeId;
  });

  nodes.push({
    id: 'node_end',
    name: 'END',
    type: 'end',
  });

  edges.push({
    id: `edge_${prevNodeId}_to_node_end`,
    fromNode: prevNodeId,
    toNode: 'node_end',
  });

  return {
    kind: 'workflow',
    id: `${sequentialAgent.id}_workflow`,
    name: `${sequentialAgent.name} (Workflow)`,
    description: `Migrated from SequentialAgent to ADK 2.x graph Workflow`,
    nodes,
    edges,
    origin: {
      source: 'generated',
      editable: true,
      filePath: sequentialAgent.origin.filePath,
    },
  };
}
