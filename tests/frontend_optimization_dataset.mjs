import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
globalThis.window = { sessionStorage: { removeItem() {} }, localStorage: { removeItem() {} } };
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
api.setSessionToken('test-session');
const dataset = { id: 'curated', version: '1.0.0', description: 'Examples', train: [], holdout: [] };
globalThis.fetch = async (path, init) => {
  assert.equal(path, '/api/v1/optimization-datasets');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.get('Authorization'), 'Bearer test-session');
  assert.deepEqual(JSON.parse(init.body), dataset);
  return new Response(JSON.stringify({ dataset_id: 'curated', version: '1.0.0' }), { status: 201 });
};
assert.deepEqual(await api.registerOptimizationDataset(dataset), { dataset_id: 'curated', version: '1.0.0' });
globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Invalid, sensitive or conflicting dataset version' }), { status: 422 });
await assert.rejects(() => api.registerOptimizationDataset(dataset), error => error.status === 422 && error.message.includes('conflicting dataset version'));
console.log('frontend optimization dataset registration checks passed');
