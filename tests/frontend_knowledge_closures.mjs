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
const source = await read('components/KnowledgeClosureMonitor.tsx');
const ast = ts.createSourceFile('monitor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name) {
  let result;
  function walk(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast); ts.forEachChild(node, walk); }
  walk(ast); assert.ok(result, `${name} exists`); return result;
}
let request;
const service = { exports: {}, require: () => ({ request: async (url, options) => { request = { url, ...options }; return {}; } }) };
vm.runInNewContext(compile(await read('services/knowledge.ts')), service);
await service.exports.fetchClosureDashboard(); assert.equal(request.url, '/api/v1/knowledge/closures?limit=50');
await service.exports.fetchClosureDashboard('a/b+'); assert.equal(request.url, '/api/v1/knowledge/closures?limit=50&cursor=a%2Fb%2B');
await service.exports.fetchClosureDetail('a/b'); assert.equal(request.url, '/api/v1/knowledge/closures/a%2Fb');

const pending = [];
let generation = 1, detail = null, loading = false, error = '', selected;
const state = {
  alive: { current: true }, detailVersion: { current: 0 }, Error,
  getSessionGeneration: () => generation,
  setSelectedId: value => { selected = value; }, setDetail: value => { detail = value; }, setDetailError: value => { error = value; }, setDetailLoading: value => { loading = value; },
  fetchClosureDetail: id => new Promise((resolve, reject) => pending.push({ id, resolve, reject })),
};
vm.runInNewContext(compile(`globalThis.choose = ${initializer('choose')};`), state);
const first = state.choose('first'); const second = state.choose('second');
assert.equal(selected, 'second'); assert.equal(loading, true);
pending[1].resolve({ tracking_id: 'second' }); await second;
pending[0].resolve({ tracking_id: 'first' }); await first;
assert.equal(detail.tracking_id, 'second', 'Slow earlier selection cannot replace the chosen comparison'); assert.equal(loading, false);
const foreign = state.choose('old-project'); generation++; pending[2].resolve({ tracking_id: 'old-project' }); await foreign;
assert.equal(detail, null, 'A former project response cannot populate this project');
const failed = state.choose('missing'); pending[3].reject(new Error('Comparison unavailable')); await failed;
assert.equal(error, 'Comparison unavailable'); assert.equal(loading, false);
const closing = state.choose('close-while-loading'); await state.choose(''); pending[4].resolve({ tracking_id: 'closed' }); await closing;
assert.equal(detail, null); assert.equal(loading, false);

let dashboard = { items: [{ tracking_id: 'a' }] };
let next = { items: [{ tracking_id: 'a', updated_at: 2 }, { tracking_id: 'b' }], next_cursor: 'next', metrics: { tracked: 2 } };
const loadState = { alive: { current: true }, loadVersion: { current: 0 }, useCallback: fn => fn, getSessionGeneration: () => generation,
  fetchClosureDashboard: async cursor => { assert.equal(cursor, 'cursor'); return next; }, setLoading() {}, setError() {},
  setDashboard: value => { dashboard = typeof value === 'function' ? value(dashboard) : value; },
};
vm.runInNewContext(compile(`globalThis.load = ${initializer('load')};`), loadState);
await loadState.load('cursor');
assert.deepEqual(Array.from(dashboard.items, item => item.tracking_id), ['a', 'b']); assert.equal(dashboard.items[0].updated_at, 2); assert.equal(dashboard.metrics.tracked, 2);
const inputState = { limit: 50, editing: null, Error };
vm.runInNewContext(compile(`globalThis.input = ${initializer('input')};`), inputState);
assert.equal(inputState.input().kind, 'track_closures');
inputState.editing = { payload: { capability: 'payments_triage' } }; assert.equal(inputState.input().capability, 'payments_triage');
inputState.limit = 101; assert.throws(() => inputState.input(), /1 to 100/);

// Render the real component and invoke actual queue/schedule button handlers.
const metric = { tracked: 1, open: 1, closed: 0, assessed: 0, insufficient: 0, pending: 0, errors: 0, alerts: 0, coverage: null, mean_deviation: null };
const record = { tracking_id: 'a', source_run_id: 'source-run', ticket_key: 'PAY-1', status: 'OPEN', last_checked_at: null, last_error: null, latest_judgment: null };
const ready = { metrics: metric, items: [record], next_cursor: null, generated_at: 1710000000, configuration: { deviation_threshold: 0.6, min_confidence: 0.8 } };
let queued = [], scheduled = [], failQueue = true;
function component(values) {
  let index = 0, refIndex = 0;
  const context = { exports: {}, crypto: { randomUUID: () => 'logical-request-key' }, require: id => {
    if (id === 'react') return { ...React, useState: initial => [index in values ? values[index++] : (index++, initial), () => {}], useRef: initial => ({ current: refIndex++ === 0 ? true : initial }), useEffect() {}, useCallback: fn => fn };
    if (id.endsWith('/api')) return { getSessionGeneration: () => generation };
    if (id.endsWith('/knowledge')) return { fetchClosureDashboard: async () => ready };
    if (id.endsWith('/improvement')) return { enqueueImprovement: async (body, key) => { queued.push({ body, key }); if (failQueue) throw new Error('Temporary outage'); return { job_id: 'job' }; }, saveImprovementSchedule: async (body, id) => { scheduled.push({ body, id }); } };
    if (id.endsWith('/ParameterSettingsPanel')) return { ParameterSettingsPanel: () => null };
    if (id.endsWith('/AnswerMarkdown')) return { AnswerMarkdown: ({ text }) => React.createElement('div', { 'data-markdown': true }, text) };
    return require(id);
  } };
  vm.runInNewContext(compile(source), context);
  return context.exports.KnowledgeClosureMonitor({ principal: { roles: ['PROJECT_OWNER'] }, jobs: [], schedules: [], onRefreshAutomation: async () => {}, onOpenRun() {}, onOpenAlerts() {} });
}
const tree = component([ready, null, '', false, false, false, '', '', '', 'Daily closures', 1440, 50, null]);
const html = renderToStaticMarkup(tree);
assert.match(html, /No closed tickets/); assert.match(html, /Not assessed/); assert.match(html, /model assessments, not verified accuracy/); assert.match(html, /PAY-1/);
assert.doesNotMatch(html, /NaN|Infinity/);
const failure = renderToStaticMarkup(component([null, null, '', false, false, false, 'Monitoring unavailable']));
assert.match(failure, /role="alert"/); assert.doesNotMatch(failure, /0 tracked investigations/);
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';
function findButton(node, label) {
  if (Array.isArray(node)) return node.map(item => findButton(item, label)).find(Boolean);
  if (node?.type === 'button' && text(node) === label) return node;
  return node?.props ? findButton(node.props.children, label) : null;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
findButton(tree, 'Check ticket closures now').props.onClick(); await flush();
failQueue = false; findButton(tree, 'Check ticket closures now').props.onClick(); await flush();
assert.equal(queued.length, 2); assert.equal(queued[0].key, queued[1].key, 'Uncertain retries retain the logical request id'); assert.equal(queued[1].body.kind, 'track_closures');
findButton(tree, 'Create closure schedule').props.onClick(); await flush();
assert.equal(scheduled[0].body.interval_seconds, 86400); assert.equal(scheduled[0].body.job.kind, 'track_closures');
const editing = { schedule_id: 'scoped', revision: 7, enabled: false, payload: { kind: 'track_closures', capability: 'payments_triage' } };
const editTree = component([ready, null, '', false, false, false, '', '', '', 'Saved schedule', 1440, 25, editing]);
findButton(editTree, 'Save closure schedule').props.onClick(); await flush();
assert.equal(scheduled[1].id, 'scoped'); assert.equal(scheduled[1].body.expected_revision, 7); assert.equal(scheduled[1].body.enabled, false); assert.equal(scheduled[1].body.job.capability, 'payments_triage');
console.log('Closure API, request races, pagination, unknown metrics, idempotent jobs and daily scoped schedules passed');
