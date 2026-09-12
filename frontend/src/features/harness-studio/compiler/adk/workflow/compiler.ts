import { AdkWorkflowComponent } from '../../../types/harness';

export function compileWorkflowToPython(workflow: AdkWorkflowComponent): string {
  const lines: string[] = [
    '"""Generated Google ADK 2.x Graph Workflow definition."""',
    '',
    'from google.adk.workflow import Workflow',
    'from google.adk.workflow import JoinNode',
    '',
    `def build_${workflow.id}() -> Workflow:`,
    `    workflow = Workflow(name="${workflow.name}")`,
    '',
  ];

  // Declare nodes
  workflow.nodes.forEach(node => {
    if (node.type === 'start' || node.type === 'end') return;
    if (node.agentRef?.type === 'config_path') {
      lines.push(`    # Node: ${node.name} (from ${node.agentRef.path})`);
      lines.push(`    node_${node.id} = workflow.add_agent_node("${node.name}", config_path="${node.agentRef.path}")`);
    } else if (node.agentRef?.type === 'code') {
      lines.push(`    # Node: ${node.name} (from ${node.agentRef.reference})`);
      lines.push(`    node_${node.id} = workflow.add_agent_node("${node.name}", code="${node.agentRef.reference}")`);
    } else {
      lines.push(`    # Node: ${node.name}`);
      lines.push(`    node_${node.id} = workflow.add_node("${node.name}")`);
    }
  });

  lines.push('');
  lines.push('    # Graph Edges');
  workflow.edges.forEach(edge => {
    lines.push(`    workflow.add_edge("${edge.fromNode}", "${edge.toNode}"${edge.condition ? `, condition="${edge.condition}"` : ''})`);
  });

  lines.push('');
  lines.push('    return workflow');
  return lines.join('\n');
}
