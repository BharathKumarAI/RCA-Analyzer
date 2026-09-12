import { HarnessDefinition, HarnessHealthScore } from '../types/harness';
import { COMPONENT_REGISTRY, validatePythonReference } from '../compiler/registry';

export interface ValidationFinding {
  tier: 1 | 2 | 3 | 4;
  tierName: 'Syntax' | 'Reference' | 'Topology' | 'Enterprise Policy';
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  remediation?: string;
}

export function validateHarness(harness: HarnessDefinition): {
  isValid: boolean;
  hasErrors: boolean;
  findings: ValidationFinding[];
  healthScore: HarnessHealthScore;
} {
  const findings: ValidationFinding[] = [];

  // Tier 1: Syntax & Structural Basics
  if (!harness.metadata.id) {
    findings.push({
      tier: 1,
      tierName: 'Syntax',
      severity: 'error',
      message: 'Harness metadata ID is required.',
      remediation: 'Provide a valid identifier for this harness.',
    });
  }

  // Tier 2: Reference Validation
  const filePaths = new Set(harness.adk.configurationFiles.map(f => f.path));
  const components = Object.values(harness.adk.components);

  components.forEach(comp => {
    if (comp.kind === 'agent') {
      // Check subagent references
      (comp.sub_agents || []).forEach(sub => {
        if (sub.type === 'config_path') {
          if (!filePaths.has(sub.path) && !filePaths.has(sub.path.replace(/^\.\//, ''))) {
            findings.push({
              tier: 2,
              tierName: 'Reference',
              severity: 'error',
              nodeId: comp.id,
              message: `Subagent config_path '${sub.path}' referenced by '${comp.name}' does not exist in workspace.`,
              remediation: `Create the file '${sub.path}' or adjust the reference path.`,
            });
          }
        } else if (sub.type === 'code') {
          const check = validatePythonReference(sub.reference);
          if (!check.valid) {
            findings.push({
              tier: 2,
              tierName: 'Reference',
              severity: 'error',
              nodeId: comp.id,
              message: check.reason || `Invalid code reference '${sub.reference}'`,
              remediation: 'Register component in Component Registry or use an approved package root.',
            });
          }
        }
      });

      // Check tool bindings
      (comp.tools || []).forEach(t => {
        const bound = harness.harness.tools.find(tool => tool.id === t.name);
        if (!bound && !t.name.startsWith('google_search')) {
          findings.push({
            tier: 2,
            tierName: 'Reference',
            severity: 'warning',
            nodeId: comp.id,
            message: `Tool '${t.name}' used by '${comp.name}' has no active ToolBinding in harness.`,
            remediation: 'Register the tool in the harness tools list with connector mapping.',
          });
        }
      });
    }
  });

  // Tier 3: Topology & Cycle Detection
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function checkCycle(nodeId: string, path: string[]): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);

    const comp = harness.adk.components[nodeId];
    if (comp && comp.kind === 'agent' && comp.sub_agents) {
      for (const sub of comp.sub_agents) {
        let childId = '';
        if (sub.type === 'config_path') {
          const childComp = Object.values(harness.adk.components).find(
            c => c.origin.filePath === sub.path
          );
          if (childComp) childId = childComp.id;
        } else if (sub.type === 'code') {
          childId = sub.reference;
        }

        if (childId) {
          if (!visited.has(childId)) {
            if (checkCycle(childId, [...path, childId])) return true;
          } else if (recStack.has(childId)) {
            findings.push({
              tier: 3,
              tierName: 'Topology',
              severity: 'error',
              nodeId,
              message: `Circular delegation detected: ${path.join(' -> ')} -> ${childId}`,
              remediation: 'Break the circular loop between subagent references.',
            });
            return true;
          }
        }
      }
    }

    recStack.delete(nodeId);
    return false;
  }

  components.forEach(c => {
    if (!visited.has(c.id)) {
      checkCycle(c.id, [c.id]);
    }
  });

  // Check for orphan agents
  const referencedNodeIds = new Set<string>();
  components.forEach(c => {
    if (c.kind === 'agent' && c.sub_agents) {
      c.sub_agents.forEach(s => {
        if (s.type === 'config_path') {
          const match = Object.values(harness.adk.components).find(x => x.origin.filePath === s.path);
          if (match) referencedNodeIds.add(match.id);
        }
      });
    }
  });

  components.forEach(c => {
    if (c.id !== 'root_orchestrator' && !c.name.toLowerCase().includes('root') && !referencedNodeIds.has(c.id)) {
      findings.push({
        tier: 3,
        tierName: 'Topology',
        severity: 'info',
        nodeId: c.id,
        message: `Agent '${c.name}' is not currently delegated by any parent orchestrator.`,
        remediation: 'Add to an orchestrator sub_agents list or convert to a standalone entrypoint.',
      });
    }
  });

  // Tier 4: Enterprise Policy & Governance
  const hasPrivacyPolicy = harness.harness.policies.some(p => p.type === 'privacy');
  const usesItsm = harness.harness.tools.some(t => t.id.startsWith('itsm'));
  if (usesItsm && !hasPrivacyPolicy) {
    findings.push({
      tier: 4,
      tierName: 'Enterprise Policy',
      severity: 'warning',
      message: 'ITSM ticket extraction is active without a PII/Privacy masking policy.',
      remediation: 'Add a Privacy/PII Masking policy to redact emails and customer tokens.',
    });
  }

  const hasEvaluation = harness.harness.evaluations.length > 0;
  if (!hasEvaluation) {
    findings.push({
      tier: 4,
      tierName: 'Enterprise Policy',
      severity: 'warning',
      message: 'Harness has zero evaluation assertions or regression benchmarks.',
      remediation: 'Attach at least one evaluation assertion or test dataset.',
    });
  }

  const hasErrors = findings.some(f => f.severity === 'error');

  // Compute Health Score
  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;

  const archScore = Math.max(40, 100 - errorCount * 25 - warningCount * 5);
  const govScore = hasPrivacyPolicy ? 95 : 75;
  const relScore = errorCount === 0 ? 92 : 60;
  const evalScore = hasEvaluation ? 90 : 65;
  const overall = Math.round((archScore + govScore + relScore + evalScore + 95) / 5);

  const healthScore: HarnessHealthScore = {
    overall,
    architecture: archScore,
    governance: govScore,
    reliability: relScore,
    observability: harness.harness.observability.tracing ? 95 : 70,
    evaluation: evalScore,
    findings: findings.map(f => ({
      severity: f.severity,
      category: f.tierName,
      message: f.message,
      nodeId: f.nodeId,
      remediation: f.remediation,
    })),
  };

  return {
    isValid: !hasErrors,
    hasErrors,
    findings,
    healthScore,
  };
}
