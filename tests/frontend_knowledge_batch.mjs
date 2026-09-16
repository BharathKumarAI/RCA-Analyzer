import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const read = path => fs.readFile(new URL(`../frontend/src/${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;
const api = await import(moduleUrl(await read('services/api.ts')));
api.setSessionToken('test-only-token'); api.setProjectContext('authorized-project');
let request;
globalThis.fetch = async (path, init) => { request = { path, ...init }; return Response.json({ outcomes: [] }); };
const files = [new File(['first'], 'one.txt'), new File(['second'], 'two.txt')];
const metadata = [{ title: 'First document', tags: ['ops'] }, { title: 'Second document', category: 'Guide' }];
await api.uploadKnowledgeBatch(files.map((file, index) => ({ file, metadata: metadata[index] })));
assert.equal(request.path, '/api/v1/knowledge/upload/batch'); assert.equal(request.method, 'POST');
assert.equal(request.headers.get('X-RCA-Project'), 'authorized-project');
assert.equal(request.headers.get('Content-Type'), null, 'The browser must provide the multipart boundary');
assert.deepEqual(request.body.getAll('files').map(file => file.name), ['one.txt', 'two.txt']);
assert.deepEqual(JSON.parse(request.body.get('metadata')), metadata);

const source = await read('components/KnowledgeBatchUpload.tsx');
const ast = ts.createSourceFile('KnowledgeBatchUpload.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = {};
function visit(node) { if (ts.isVariableDeclaration(node) && ['choose', 'upload', 'edit'].includes(node.name.getText(ast))) declarations[node.name.getText(ast)] = `const ${node.getText(ast)};globalThis.${node.name.getText(ast)}=${node.name.getText(ast)};`; ts.forEachChild(node, visit); }
visit(ast);
let entries = [], error = '', generation = 1, calls = [], refreshes = 0;
const limits = { max_files: 4, max_file_bytes: 8, max_upload_batch_bytes: 12, allowed_extensions: ['.txt'] };
const context = { limits, pending: [], active: { current: false }, alive: { current: true }, Map, Set, Array, Error,
  getSessionGeneration: () => generation,
  setEntries: value => { entries = typeof value === 'function' ? value(entries) : value; context.pending = entries.filter(entry => !entry.outcome || entry.outcome.status === 'failed'); },
  setError: value => { error = value; }, setInputKey: () => {}, setBusy: () => {}, onUploaded: () => { refreshes++; },
  uploadKnowledgeBatch: async clean => { calls.push(clean); return { outcomes: [{ index: 0, status: 'created', filename: 'one.txt', document: { title: 'First draft' } }, { index: 1, status: 'failed', filename: 'two.txt', error: { message: 'Needs correction' } }] }; },
};
vm.runInNewContext(compile(Object.values(declarations).join('\n')), context);
context.choose(files); assert.equal(entries.length, 2);
context.edit(1, 'title', 'Keep my title'); context.edit(1, 'tags', 'ops, ops, database');
const original = entries;
context.choose([new File(['12345678'], 'a.txt'), new File(['12345678'], 'b.txt')]);
assert.equal(entries, original, 'An invalid selection preserves selected files and metadata'); assert.match(error, /batch limit/);
context.choose([new File(['x'], 'wrong.exe')]); assert.equal(entries, original); assert.match(error, /not enabled/);
context.choose([new File(['123456789'], 'huge.txt')]); assert.equal(entries, original); assert.match(error, /Each file/);
await context.upload({ preventDefault() {} });
assert.equal(entries[0].outcome.status, 'created'); assert.equal(entries[1].outcome.status, 'failed'); assert.equal(entries[1].title, 'Keep my title'); assert.equal(refreshes, 1);
assert.deepEqual(Array.from(calls[0][1].metadata.tags), ['ops', 'database']);
context.uploadKnowledgeBatch = async clean => { calls.push(clean); throw new Error('Network response lost'); };
await context.upload({ preventDefault() {} }); assert.equal(calls[1].length, 1); assert.equal(calls[1][0].file, files[1]); assert.equal(entries[1].title, 'Keep my title'); assert.match(error, /Network response lost/);
context.uploadKnowledgeBatch = async clean => { calls.push(clean); return { outcomes: [{ index: 0, status: 'duplicate', filename: 'two.txt', matched_revision: 2, duplicate_historical: true, document: { title: 'Existing document' } }] }; };
await context.upload({ preventDefault() {} });
assert.equal(calls[2][0].file, files[1]); assert.equal(entries[0].outcome.status, 'created'); assert.equal(entries[1].outcome.status, 'duplicate'); assert.equal(context.pending.length, 0); assert.equal(refreshes, 2);
context.choose([new File(['data'], 'next.txt')]);
let complete; context.uploadKnowledgeBatch = clean => { calls.push(clean); return new Promise(resolve => { complete = resolve; }); };
const pending = context.upload({ preventDefault() {} }); const callCount = calls.length;
await context.upload({ preventDefault() {} }); assert.equal(calls.length, callCount, 'Repeated submission cannot race a batch upload');
generation++; complete({ outcomes: [{ index: 0, status: 'created' }] }); await pending;
assert.equal(entries[0].outcome, undefined, 'A result for a previous identity cannot change this form'); assert.equal(refreshes, 2);

// Exercise real component effects and markup with controlled state, without a browser package.
const failed = { file: files[1], title: '<script>title</script>', category: '', tags: '', outcome: { status: 'failed', error: { message: 'Retry this file' } } };
const historical = { file: files[0], title: 'First', category: '', tags: '', outcome: { status: 'duplicate', matched_revision: 1, duplicate_historical: true, document: { title: 'Existing approved document' } } };
const effects = [], listeners = new Map(), history = [];
const browser = { location: { href: '/p/project/knowledge' }, history: { pushState: (_, _title, href) => { history.push(href); browser.location.href = href; } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
let index = 0; const states = [[historical, failed], limits, '', false, 0]; const module = { exports: {} };
vm.runInNewContext(compile(source), { module, exports: module.exports, window: browser, require: id => id === 'react' ? { ...React, useState: () => [states[index++], () => {}], useEffect: callback => effects.push(callback), useRef: value => ({ current: value }) } : id === '../services/api' ? { ...api, fetchConfig: () => new Promise(() => {}) } : require(id) });
const html = renderToStaticMarkup(React.createElement(module.exports.KnowledgeBatchUpload, { onUploaded() {} }));
assert.ok(html.includes('Retry 1 remaining files') && html.includes('matches an older revision; the current document is unchanged'));
assert.ok(html.includes('Remove two.txt from batch') && !html.includes('Remove one.txt from batch'));
assert.ok(html.includes('&lt;script&gt;title&lt;/script&gt;') && !html.includes('<script>'));
const cleanups = effects.map(effect => effect());
let prevented = false; listeners.get('rca:before-navigation')({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
let stopped = false; browser.location.href = '/p/project/runs';
listeners.get('popstate')({ isTrusted: true, preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
assert.equal(stopped, true); assert.equal(browser.location.href, '/p/project/knowledge'); assert.equal(history.length, 1);
cleanups.forEach(cleanup => cleanup?.()); assert.equal(listeners.size, 0);

const setup = await read('pages/ProjectSetup.tsx'); assert.match(setup, /onSaved=\{item => setStatusNotice\(\{ type: 'success', text: item\.upload_match \?/);
console.log('Knowledge batch preserves failed drafts, scoped retries and history; validates raw upload limits and renders duplicate outcomes honestly');
