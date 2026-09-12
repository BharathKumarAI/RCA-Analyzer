import { HarnessDefinition } from '../types/harness';
import { serializeHarnessToYaml } from './harnessCompiler';

export function downloadTextFile(filename: string, text: string, mimeType: string = 'text/yaml') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportActiveFile(harness: HarnessDefinition) {
  const activePath = harness.adk.activeFilePath;
  const file = harness.adk.configurationFiles.find(f => f.path === activePath);
  const content = file ? file.content : serializeHarnessToYaml(harness);
  const fileName = activePath.split('/').pop() || 'agent_config.yaml';
  downloadTextFile(fileName, content);
}

export function exportPrismHarnessYaml(harness: HarnessDefinition) {
  const content = serializeHarnessToYaml(harness);
  const fileName = `${harness.metadata.projectId || 'prism'}_harness.yaml`;
  downloadTextFile(fileName, content);
}

export function exportAdkAgentBundle(harness: HarnessDefinition) {
  // Combine into a multi-file concatenated package manifest or bundle
  const chunks: string[] = [
    '# =========================================================================',
    '# GOOGLE ADK 2.x MULTI-AGENT COMPOSITION BUNDLE',
    `# Project: ${harness.metadata.projectId}`,
    `# Exported at: ${new Date().toISOString()}`,
    '# =========================================================================',
    '',
  ];

  harness.adk.configurationFiles
    .filter(f => f.kind === 'adk_agent')
    .forEach(f => {
      chunks.push(`# --- FILE: ${f.path} ---`);
      chunks.push(f.content);
      chunks.push('\n');
    });

  chunks.push('# --- FILE: .env.example ---');
  chunks.push('GEMINI_API_KEY=your_gemini_api_key_here');
  chunks.push('ADK_MODE=live');
  chunks.push('LOG_LEVEL=INFO');

  const bundleName = `${harness.metadata.projectId || 'adk'}_agent_bundle.yaml`;
  downloadTextFile(bundleName, chunks.join('\n'));
}

export function generateFlattenedPreview(harness: HarnessDefinition): string {
  const lines: string[] = [
    '# FLATTENED COMPOSITE PREVIEW (Read-Only)',
    `# Generated for project: ${harness.metadata.projectId}`,
    '',
  ];

  harness.adk.configurationFiles.forEach(f => {
    lines.push(`\n# ==========================================`);
    lines.push(`# Path: ${f.path}`);
    lines.push(`# ==========================================`);
    lines.push(f.content);
  });

  return lines.join('\n');
}
