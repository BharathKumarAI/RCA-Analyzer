import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['refreshProjectDirectory', 'refreshTelemetry'].includes(node.name.getText(parsed))) declarations[node.name.getText(parsed)] = `const ${node.getText(parsed)};`;
  ts.forEachChild(node, visit);
}
visit(parsed);
for (const name of ['refreshProjectDirectory', 'refreshTelemetry']) {
  assert.ok(declarations[name]);
  for (const fails of [false, true]) {
    let resolve, reject, generation = 1;
    const state = {};
    const fetcher = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    const context = { principal: {}, Error, getSessionGeneration: () => generation, fetchProjects: fetcher, fetchHealth: fetcher };
    for (const key of ['Projects', 'ProjectError', 'Health', 'HealthUpdatedAt', 'HealthError', 'TelemetryRefreshing']) context[`set${key}`] = value => { state[key] = value; };
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(`${declarations[name]}\nglobalThis.refresh = ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const pending = context.refresh();
    generation++;
    if (fails) reject(new Error('Previous account unavailable')); else resolve({ project_id: 'previous-account' });
    await pending;
    for (const key of ['Projects', 'ProjectError', 'Health', 'HealthUpdatedAt', 'HealthError']) assert.equal(state[key], undefined, `${name} must discard a previous scope's ${fails ? 'error' : 'data'}`);
    if (name === 'refreshTelemetry') assert.equal(state.TelemetryRefreshing, true, 'An older refresh cannot clear the new scope status');
  }
}
console.log('Project and telemetry refreshes ignore stale identity responses and failures');
