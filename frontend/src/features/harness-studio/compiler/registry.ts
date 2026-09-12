import type { RegistryComponent } from '../types/harness';

/**
 * The browser has no authoritative component registry. Keep this lookup empty
 * and use the graph returned by the backend instead of presenting stale,
 * client-only agents or connector permissions as available components.
 */
export const COMPONENT_REGISTRY: Record<string, RegistryComponent> = {};

const BLOCKED_MODULE_PREFIXES = new Set([
  'os', 'sys', 'subprocess', 'shutil', 'pathlib', 'importlib', 'pickle', 'marshal', 'shelve', 'pty', 'pdb', 'webbrowser', 'antigravity', 'builtins',
]);

export function validatePythonReference(reference: string): { valid: boolean; reason?: string } {
  if (!reference || typeof reference !== 'string') return { valid: false, reason: 'Empty reference' };
  const topModule = reference.trim().split('.')[0].toLowerCase();
  if (BLOCKED_MODULE_PREFIXES.has(topModule)) return { valid: false, reason: `Blocked module reference: '${topModule}'` };
  return { valid: false, reason: 'Python references are inert in Studio; register the implementation in the backend component registry.' };
}
