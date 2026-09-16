import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source = await fs.readFile(new URL('../frontend/src/pages/Runs.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Runs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let effect, expression;
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('setSelectedSnapshot')) effect = node.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selected' && node.initializer.getText(ast).includes('selectedSnapshot')) expression = node.initializer.getText(ast);
  ts.forEachChild(node, walk);
}
walk(ast); assert.ok(effect); assert.ok(expression);
let generation = 1, resolve, reject, error, loading;
const state = { selectedId: 'historical', selectedSnapshot: null, runs: [{ id: 'newest' }], Error,
  getSessionGeneration: () => generation, fetchRun: () => new Promise((yes, no) => { resolve = yes; reject = no; }),
  setSelectedId: id => { state.selectedId = id; }, setSelectedSnapshot: run => { state.selectedSnapshot = run; },
  setSelectionLoading: value => { loading = value; }, setSelectionError: value => { error = value; },
};
vm.runInNewContext(compile(`globalThis.load = ${effect}; globalThis.selection = () => ${expression};`), state);
const flush = () => new Promise(resolve => setImmediate(resolve));
let cleanup = state.load(); assert.equal(state.selectedId, 'historical'); assert.equal(state.selection(), null); assert.equal(loading, true);
resolve({ id: 'historical', result: { summary: 'Recorded original finding' } }); await flush();
assert.equal(state.selection().id, 'historical'); assert.equal(loading, false); cleanup();
state.runs = [{ id: 'even-newer' }]; cleanup = state.load(); assert.equal(state.selection().id, 'historical', 'Refreshing the recent list retains the selected historical record');
resolve({ id: 'historical' }); await flush(); cleanup();
state.selectedId = 'missing'; cleanup = state.load(); reject(new Error('Run is unavailable')); await flush();
assert.equal(error, 'Run is unavailable'); assert.equal(state.selection(), null, 'Fetch failure cannot show a different run as the selected original'); assert.equal(loading, false); cleanup();
state.selectedId = 'old-project'; cleanup = state.load(); generation++; resolve({ id: 'old-project' }); await flush(); assert.equal(state.selection(), null); cleanup();
state.selectedId = 'cancelled'; cleanup = state.load(); cleanup(); resolve({ id: 'cancelled' }); await flush(); assert.equal(state.selection(), null);
state.selectedId = null; state.load(); assert.equal(state.selectedId, 'even-newer', 'Unlinked visits still select the first available row');
console.log('Historical run selection survives batch refresh with visible failures and stale-response guards');
