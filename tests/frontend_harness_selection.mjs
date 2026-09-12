import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const page = await fs.readFile(new URL('../frontend/src/pages/HarnessLibrary.tsx', import.meta.url), 'utf8');
const source = page.slice(page.indexOf('const key ='), page.indexOf('export const HarnessLibrary:')) + '\nexport { toItems };';
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { toItems } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const response = {
  document: { agents: [{ definition: { id: 'shared', name: 'Agent' }, enabled: true }], plugins: [{ id: 'shared', name: 'Plugin', enabled: true }] },
  selection: { agents: [], plugins: [], disabled_agents: ['shared'], disabled_plugins: ['shared'], disabled_skills: [], disabled_capabilities: [] },
  effective_agents: [], effective_plugins: [], permissions: { manage_project: true },
  skills: [{ id: 'governed', customizable: false }, { id: 'project-disabled', enabled: false, customizable: true }], capabilities: [{ id: 'disabled-project', enabled: false, customizable: true }],
};
let items = toItems(response);
assert.equal(items.find(item => item.kind === 'agent').selected, false, 'deselecting every agent must survive reload');
assert.equal(items.find(item => item.kind === 'plugin').selected, false, 'deselecting every plugin must survive reload');
assert.equal(items.find(item => item.kind === 'skill').customizable, false, 'server delegation controls skill editing');
assert.equal(items.find(item => item.kind === 'capability').customizable, true, 'a project-disabled capability can be re-enabled');
assert.equal(items.find(item => item.id === 'project-disabled').immutable, undefined, 'project-disabled skills remain available to re-enable');
assert.equal(items.find(item => item.id === 'project-disabled').customizable, true);
response.selection.disabled_agents = [];
response.permissions.manage_project = false;
items = toItems(response);
assert.equal(items.find(item => item.kind === 'agent').selected, true, 'empty selection inherits defaults');
assert.equal(items.find(item => item.kind === 'agent').customizable, false, 'readers cannot edit project inheritance');
console.log('frontend harness selection checks passed');

const toggleSource = page.slice(page.indexOf('  const toggle ='), page.indexOf('  const save ='));
const toggleModule = ts.transpileModule(`
  const canManageProject = true;
  const key = item => item.kind + ':' + item.id;
  export let selected = new Set(['agent:shared', 'plugin:shared']);
  const setSelected = update => { selected = update(selected); };
  ${toggleSource}
  export { toggle };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const state = await import(`data:text/javascript;base64,${Buffer.from(toggleModule).toString('base64')}`);
state.toggle({ kind: 'agent', id: 'shared', source: 'platform', customizable: true });
assert.deepEqual([...state.selected], ['plugin:shared'], 'toggling one resource must not affect another kind with the same ID');
state.toggle({ kind: 'agent', id: 'shared', source: 'platform', customizable: true });
assert.equal(state.selected.has('agent:shared'), true);
state.toggle({ kind: 'plugin', id: 'shared', source: 'platform', customizable: false });
assert.equal(state.selected.has('plugin:shared'), true, 'locked resources cannot be toggled');
console.log('frontend harness toggle checks passed');
