import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/pages/Runs.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let effect;
let scheduled;
let requests = 0;
const updated = [];
const exports = {};
vm.runInNewContext(output, {
  exports,
  require(name) {
    if (name === 'react') return { useState: value => [value, () => {}], useEffect: callback => { effect = callback; } };
    if (name.includes('jsx-runtime')) return { jsx: () => null, jsxs: () => null };
    if (name.includes('services/api')) return { fetchRun: async id => { if (++requests === 1) throw new Error('temporary network error'); return { id, status: 'COMPLETED' }; } };
    return {};
  },
  window: { setTimeout: callback => { scheduled = callback; return 1; }, clearTimeout: () => { scheduled = null; } },
});
exports.Runs({ runs: [{ id: 'run-1', status: 'RUNNING', created_at: new Date().toISOString() }], onNewInvestigation() {}, onRunUpdated: run => updated.push(run) });
const cleanup = effect();
let callback = scheduled;
scheduled = null;
await callback();
assert.equal(requests, 1);
assert.equal(typeof scheduled, 'function', 'A transient failure must schedule another poll');
callback = scheduled;
scheduled = null;
await callback();
assert.equal(requests, 2);
assert.equal(updated[0].status, 'COMPLETED');
cleanup();
assert.equal(scheduled, null, 'Unmount must clear polling');
console.log('frontend run polling recovery checks passed');
