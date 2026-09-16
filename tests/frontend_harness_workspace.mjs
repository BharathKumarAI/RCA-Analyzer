import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/features/harness-studio/harnessApi.ts', import.meta.url), 'utf8');
const withoutServiceImport = source.replace("import { authHeaders } from '../../services/api';", "const authHeaders = (initial) => { const headers = new Headers(initial); headers.set('Authorization', 'Bearer studio-session'); return headers; };");
const output = ts.transpileModule(withoutServiceImport, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const calls = [];
globalThis.fetch = async (path, init = {}) => {
  calls.push({ path, init });
  if (path === '/api/v1/harness/export?capability=incident_triage') return new Response('zip', { status: 200, headers: { 'content-type': 'application/zip' } });
  if (path === '/api/v1/harness/import') return new Response(JSON.stringify({ files: {}, graph: { nodes: [], edges: [] }, diagnostics: [], compatibility: {}, revision: 'sha256:import', status: 'DRAFT', permissions: {}, capability: 'incident_triage' }), { status: 200 });
  if (path.includes('/trace')) return new Response(JSON.stringify({ events: [{ sequence: 1, kind: 'complete' }] }), { status: 200 });
  if (path.includes('/runs?stream=true')) return new Response('event: run\ndata: {"run_id":"run-1"}\n\nevent: complete\ndata: {"run_id":"run-1","summary":"done"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  return new Response(JSON.stringify({ files: { 'rca/workflow.yaml': 'root: root' }, graph: { nodes: [], edges: [] }, diagnostics: [], compatibility: {}, revision: 'sha256:revision', status: 'PLATFORM', permissions: { edit: true }, capability: 'incident_triage' }), { status: 200 });
};
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

await api.fetchStudioWorkspace('incident_triage');
assert.equal(calls.at(-1).path, '/api/v1/harness/workspace?capability=incident_triage');
await api.validateStudioWorkspace({ 'root_agent.yaml': 'name: root' }, 'incident_triage');
assert.deepEqual(JSON.parse(calls.at(-1).init.body), { files: { 'root_agent.yaml': 'name: root' }, capability: 'incident_triage' });
await api.saveStudioDraft({ files: { 'root_agent.yaml': 'name: root' }, capability: 'incident_triage', expected_revision: 'sha256:revision', draft_id: 'draft-1' });
assert.deepEqual(JSON.parse(calls.at(-1).init.body).expected_revision, 'sha256:revision');
await api.reviewStudioDraft('draft-1', 'submit', 'sha256:revision', 'Ready for independent review');
assert.deepEqual(JSON.parse(calls.at(-1).init.body), { expected_revision: 'sha256:revision', reason: 'Ready for independent review' });
await api.importStudioBundle(new File(['name: root'], 'root_agent.yaml'), 'incident_triage');
assert.ok(calls.at(-1).init.body instanceof FormData);
const events = [];
await api.streamStudioRun('incident_triage', 'Inspect', event => events.push(event));
assert.deepEqual(events.map(event => event.type), ['run', 'complete']);
assert.equal('connector_selections' in JSON.parse(calls.at(-1).init.body), false);
const connectorSelections = { jira: { instance_id: 'support-east', environment_id: 'production' }, splunk: { instance_id: 'logs-primary' } };
await api.streamStudioRun('incident_triage', 'Inspect', () => {}, undefined, { connectorSelections });
assert.deepEqual(JSON.parse(calls.at(-1).init.body), { capability: 'incident_triage', prompt: 'Inspect', connector_selections: connectorSelections });
assert.equal((await api.fetchStudioTrace('run-1')).events[0].sequence, 1);
await api.exportStudioBundle('incident_triage');
assert.equal((await calls.at(-1).init.headers.get('Authorization')), 'Bearer studio-session');

const page = await fs.readFile(new URL('../frontend/src/features/harness-studio/HarnessStudioPage.tsx', import.meta.url), 'utf8');
assert.match(page, /validationRequest/);
assert.match(page, /errorDiagnostics\(result\.diagnostics\) \? workspace\.graph : result\.graph/);
assert.match(page, /source\['x-rca'\]/);
console.log('frontend Harness Studio backend contract checks passed');

// Network chunks may split a multibyte character, CRLF, or an event boundary.
const frames = 'event: run\r\ndata: {"run_id":"r"}\r\n\r\nevent: complete\r\ndata: {"summary":\r\ndata: "Café complete"}\r\n\r\n';
const bytes = new TextEncoder().encode(frames);
globalThis.fetch = async (_path, init) => {
  assert.equal(init.headers.get('Idempotency-Key'), 'retry-safe');
  assert.equal(JSON.parse(init.body).chat_id, 'chat-existing');
  assert.deepEqual(JSON.parse(init.body).connector_selections, connectorSelections);
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
};
const splitEvents = [];
const result = await api.streamStudioRun('attachment_review', 'Inspect', value => splitEvents.push(value), undefined, { chatId: 'chat-existing', idempotencyKey: 'retry-safe', connectorSelections });
assert.deepEqual(splitEvents.map(value => value.type), ['run', 'complete']);
assert.equal(result.summary, 'Café complete');
globalThis.fetch = async () => new Response('event: run\ndata: {"run_id":"r"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
await assert.rejects(() => api.streamStudioRun('a', 'b', () => {}), /connection ended before/);
globalThis.fetch = async () => new Response('event: error\ndata: {"detail":"Timed out"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
await assert.rejects(() => api.streamStudioRun('a', 'b', event => { if (event.type === 'error') throw new Error(event.data.detail); }), /Timed out/);
console.log('Stream chunk boundaries, interruption, callback errors, and conversation binding passed');

// An interrupted Playground submission preserves its key and input for a safe retry.
const vm = await import('node:vm');
const playground = await fs.readFile(new URL('../frontend/src/features/harness-studio/playground/Playground.tsx', import.meta.url), 'utf8');
const playgroundAst = ts.createSourceFile('Playground.tsx', playground, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let runCode;
function locateRun(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(playgroundAst) === 'run') runCode = `const ${node.getText(playgroundAst)}; globalThis.run = run;`;
  ts.forEachChild(node, locateRun);
}
locateRun(playgroundAst);
const attemptKeys = [];
let uuid = 0;
const context = {
  input: 'Inspect the failure', capability: 'incident_triage', runningRef: { current: false },
  connectorScope: { ready: true, selections: { itsm: { instance_id: 'jira-main', environment_id: 'prod' } } },
  attemptRef: { current: null }, traceRef: { current: null }, traceFetchRef: { current: null }, abortRef: { current: null },
  AbortController, crypto: { randomUUID: () => `key-${++uuid}` },
  setInput: value => { context.input = typeof value === 'function' ? value(context.input) : value; },
  setError() {}, setRunning() {}, setEvents() {}, setRunId() {}, setMessages() {}, onTrace() {},
  async streamStudioRun(_capability, _prompt, _event, _signal, options) { attemptKeys.push(options.idempotencyKey); throw new Error('Connection interrupted'); },
};
vm.runInNewContext(ts.transpileModule(runCode, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText, context);
await context.run();
assert.equal(context.input, 'Inspect the failure');
await context.run();
assert.equal(attemptKeys[0], attemptKeys[1]);
context.connectorScope.selections = { itsm: { instance_id: 'jira-main', environment_id: 'staging' } };
await context.run();
assert.notEqual(attemptKeys[1], attemptKeys[2]);
context.streamStudioRun = async (_capability, _prompt, event, _signal, options) => { attemptKeys.push(options.idempotencyKey); event({ type: 'complete', data: { status: 'SUCCEEDED' } }); };
await context.run();
assert.equal(context.attemptRef.current, null);
console.log('Playground preserves uncertain retry identity and resets it after a terminal response');
