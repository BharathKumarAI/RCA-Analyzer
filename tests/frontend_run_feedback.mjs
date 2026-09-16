import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;
const apiUrl = moduleUrl(await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8'));
const api = await import(apiUrl);
const source = await fs.readFile(new URL('../frontend/src/services/feedback.ts', import.meta.url), 'utf8');
const feedback = await import(moduleUrl(source.replace("from './api'", `from '${apiUrl}'`)));
api.setSessionToken('test-only-token'); api.setProjectContext('team-a');
let latest;
globalThis.fetch = async (path, init) => { latest = { path, ...init }; return Response.json(null); };
assert.equal(await feedback.fetchRunFeedback('run/123'), null);
assert.equal(latest.path, '/api/v1/runs/run%2F123/feedback');
assert.equal(latest.headers.get('X-RCA-Project'), 'team-a');
assert.equal(latest.headers.get('Authorization'), 'Bearer test-only-token');
globalThis.fetch = async (path, init) => { latest = { path, ...init }; return Response.json({ rating: 'helpful', note: 'Grounded in the attached log.', revision: 1, updated_at: 123 }); };
await feedback.saveRunFeedback('run-1', { rating: 'helpful', note: 'Grounded in the attached log.', expected_revision: 0 });
assert.equal(latest.method, 'PUT');
assert.deepEqual(JSON.parse(latest.body), { rating: 'helpful', note: 'Grounded in the attached log.', expected_revision: 0 });
globalThis.fetch = async () => Response.json({ detail: 'Feedback changed in another session.' }, { status: 409 });
await assert.rejects(feedback.saveRunFeedback('run-1', { rating: 'needs_work', note: '', expected_revision: 1 }), error => error.status === 409);

// Exercise the actual save/reload handlers with a conflicting server revision.
const component = await fs.readFile(new URL('../frontend/src/components/RunFeedback.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('RunFeedback.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
let mountEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') mountEffect = node.arguments[0].getText(parsed);
  if (ts.isVariableDeclaration(node) && ['save', 'retry'].includes(node.name.getText(parsed))) handlers.push(`const ${node.getText(parsed)};`);
  ts.forEachChild(node, visit);
}
visit(parsed);
const state = { note: 'Keep this unsaved explanation.', rating: 'needs_work', saved: { revision: 1 }, ready: true, saving: false };
const context = { ...state, runId: 'run-1', ApiError: api.ApiError, Error, alive: { current: true }, requests: { current: new AbortController() }, getSessionGeneration: () => 1,
  saveRunFeedback: async () => { throw new api.ApiError(409, 'Changed'); },
  fetchRunFeedback: async () => ({ rating: 'helpful', note: 'Other session note', revision: 2, updated_at: 124 }),
};
for (const field of ['Note', 'Rating', 'Saved', 'Ready', 'Saving', 'Error', 'Notice', 'Loading', 'Attempt']) context[`set${field}`] = value => { const key = field[0].toLowerCase() + field.slice(1); state[key] = value; context[key] = value; };
vm.createContext(context);
vm.runInContext(ts.transpileModule(`${handlers.join('\n')}\nglobalThis.saveFeedback = save; globalThis.retryFeedback = retry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
await context.saveFeedback('needs_work');
assert.equal(state.note, 'Keep this unsaved explanation.', 'A conflict must preserve the note typed in this session');
assert.equal(state.saved.revision, 2, 'A conflict reloads the server revision before another save');
assert.equal(state.rating, 'needs_work');
assert.match(state.error, /save again/);
let retryPayload;
context.saveRunFeedback = async (_id, payload) => { retryPayload = payload; return { ...payload, revision: 3, updated_at: 125 }; };
await context.saveFeedback('needs_work');
assert.equal(retryPayload.expected_revision, 2);
assert.equal(retryPayload.note, 'Keep this unsaved explanation.');
assert.equal(state.notice, 'Feedback saved.');
context.saveRunFeedback = async () => { throw new api.ApiError(409, 'Changed again'); };
context.fetchRunFeedback = async () => { throw new Error('offline'); };
await context.saveFeedback('needs_work');
assert.equal(state.ready, false, 'A failed conflict reload cannot submit a stale revision');
assert.equal(state.note, 'Keep this unsaved explanation.');
context.fetchRunFeedback = async () => ({ revision: 4, note: 'Other note', rating: 'helpful' });
await context.retryFeedback();
assert.equal(state.saved.revision, 4);
assert.equal(state.note, 'Keep this unsaved explanation.');
console.log('Run feedback persists scoped revisions and preserves unsaved notes through conflicts and reconnects');

let observed, observerCallback, disconnects = 0, requests = 0, resolveFeedback;
context.AbortController = AbortController;
context.footer = { current: {} };
context.IntersectionObserver = class {
  constructor(callback, options) { observerCallback = callback; assert.equal(options.rootMargin, '100px'); }
  observe(element) { observed = element; }
  disconnect() { disconnects++; }
};
context.fetchRunFeedback = async (_id, signal) => {
  requests++;
  assert.equal(signal.aborted, false);
  return new Promise(resolve => { resolveFeedback = resolve; });
};
vm.runInContext(ts.transpileModule(`globalThis.mountFeedback = ${mountEffect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const cleanup = context.mountFeedback();
assert.equal(observed, context.footer.current);
assert.equal(requests, 0, 'History outside the viewport must not request feedback');
observerCallback([{ isIntersecting: false }]);
assert.equal(requests, 0);
observerCallback([{ isIntersecting: true }]);
assert.equal(requests, 1, 'Feedback loads when its footer comes into view');
const savedBeforeUnmount = state.saved;
cleanup();
assert.equal(context.requests.current.signal.aborted, true, 'Removing a chat aborts its pending feedback request');
assert.ok(disconnects >= 2);
resolveFeedback({ rating: 'helpful', note: 'Stale previous project', revision: 10 });
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.saved, savedBeforeUnmount, 'A late result cannot render after its conversation has been removed');
console.log('Offscreen history feedback is lazy and aborts cleanly when conversations change');
