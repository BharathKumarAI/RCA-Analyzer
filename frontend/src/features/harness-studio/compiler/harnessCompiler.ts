import YAML from 'yaml';
import type { HarnessDefinition } from '../types/harness';

/** Serialize a server-resolved harness for local inspection/export.
 * Creation and validation belong to the backend compiler; the browser never
 * invents an executable default workflow. */
export function serializeHarnessToYaml(harness: HarnessDefinition): string {
  const data: Record<string, unknown> = {
    schema_version: '1.0',
    kind: 'PrismHarnessConfiguration',
    metadata: harness.metadata,
    compatibility: harness.compatibility,
    graph: harness.runtimeGraph,
    files: Object.fromEntries(harness.adk.configurationFiles.map(file => [file.path, file.content])),
  };
  return `# PRISM Harness source export\n# Runtime graph and policy are resolved by the RCA backend.\n\n${YAML.stringify(data)}`;
}
