import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const modules = new Map();
let latest;
globalThis.fetch = async (path, init = {}) => {
  latest = { path, ...init };
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
async function load(path, imports = {}) {
  const module = { exports: {} };
  const source = await fs.readFile(new URL('../frontend/src/' + path, import.meta.url), 'utf8');
  vm.runInNewContext(compile(source), {
    module, exports: module.exports, FormData, File, Headers, Response, AbortSignal, crypto, URL,
    fetch: (...args) => globalThis.fetch(...args),
    require: id => imports[id] ?? (id.endsWith('.css') ? {} : require(id)),
  });
  modules.set(path, module.exports);
  return module.exports;
}
const api = await load('services/api.ts');
api.setSessionToken('fixture-token'); api.setProjectContext('actual-project');
const okf = await load('services/okf.ts', { './api': api });
const improvement = await load('services/improvement.ts', { './api': api });
const hash = 'sha256:' + 'a'.repeat(64);
const file = new File(['---\ntype: runbook\n---\nVerified content'], 'concept.md');
await okf.previewOkf(file, 'bundle-1');
assert.equal(latest.path, '/api/v1/knowledge/okf/preview');
assert.equal(latest.headers.get('X-RCA-Project'), 'actual-project');
assert.equal(latest.headers.has('Content-Type'), false);
await okf.importOkf(file, { bundle_id: 'bundle-1', preview_hash: hash, concepts: [{ path: 'operations/concept.md', current_hash: hash }, { path: 'new.md', current_hash: null }] });
assert.equal(latest.body.get('preview_hash'), hash);
assert.deepEqual(JSON.parse(latest.body.get('expected_hashes')), { 'operations/concept.md': hash });
const bytes = new TextEncoder().encode('reviewed export');
const digest = 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
globalThis.fetch = async (path, init) => { latest = { path, ...init }; return new Response(bytes, { headers: { 'X-Content-SHA256': digest } }); };
const result = await okf.exportOkf([{ id: 'doc-1', content_hash: hash, okf_bundle_id: 'bundle-1' }], 'markdown', false);
assert.equal(await result.blob.text(), 'reviewed export');
assert.deepEqual(JSON.parse(latest.body), { bundle_id: 'bundle-1', document_ids: ['doc-1'], expected_hashes: { 'doc-1': hash }, include_drafts: false, format: 'markdown' });
globalThis.fetch = async () => new Response('corrupted', { headers: { 'X-Content-SHA256': digest } });
await assert.rejects(okf.exportOkf([{ id: 'doc-1', content_hash: hash }], 'markdown', false), /integrity check failed/);
globalThis.fetch = async (path, init = {}) => { latest = { path, ...init }; return new Response('{}', { headers: { 'content-type': 'application/json' } }); };
await improvement.enqueueImprovement({ kind: 'prepare_feedback', limit: 30 }, 'stable-request');
assert.equal(latest.headers.get('Idempotency-Key'), 'stable-request');
await improvement.saveImprovementSchedule({ name: 'Reviewed work', interval_seconds: 600, enabled: false, expected_revision: 7, job: { kind: 'prepare_feedback' } }, 'schedule/1');
assert.equal(latest.method, 'PUT'); assert.ok(latest.path.endsWith('schedule%2F1'));
assert.equal(JSON.parse(latest.body).expected_revision, 7);
await improvement.verifyImprovementCandidate('case/1', { expected_revision: 2, expected_outcome: 'INSUFFICIENT_EVIDENCE', expected_facts: ['No evidence of a cause'], reason: 'Checked saved evidence' });
assert.ok(latest.path.endsWith('case%2F1/verify'));
assert.equal(JSON.parse(latest.body).expected_revision, 2);
await improvement.fetchImprovementCandidate('case/1');
assert.equal(latest.path, '/api/v1/improvement/candidates/case%2F1');
await improvement.undoOptimization('opt/1', 'rollback', hash, 'Regression in independent review');
assert.equal(JSON.parse(latest.body).expected_hash, hash);
const feedback = await load('pages/ProjectFeedback.tsx', { '../services/api': api, '../services/triage': {} });
const markup = renderToStaticMarkup(React.createElement(feedback.ProjectFeedback));
assert.match(markup, /Select a recorded ticket/);
assert.match(markup, /<fieldset disabled=""/);
assert.doesNotMatch(markup, /RS-177053|aria-pressed="true"|incorporated into calibration/);
const exchange = await load('components/KnowledgeOkfExchange.tsx', { '../services/api': api, '../services/okf': okf });
const readonly = renderToStaticMarkup(React.createElement(exchange.KnowledgeOkfExchange, { items: [], canManage: false, onImported() {} }));
assert.match(readonly, /No eligible documents/); assert.doesNotMatch(readonly, /type="file"/);
console.log('OKF integrity, immutable revision controls, scoped jobs, and truthful feedback/knowledge empty states passed');
