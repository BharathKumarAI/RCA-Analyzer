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
const apiUrl = moduleUrl(await read('services/api.ts'));
const api = await import(apiUrl);
const service = await import(moduleUrl((await read('services/triage.ts')).replace("from './api'", `from '${apiUrl}'`)));
api.setSessionToken('test-only-token');
api.setProjectContext('scope-a');
let request;
const result = { outcome: 'FINDINGS', summary: 'Saved timeout investigation', findings: [{ summary: 'Observed timeout', evidence_ids: ['source-1'] }, { summary: 'Hypothesis needs confirmation', evidence_ids: [] }], uncertainties: ['Failure cause unconfirmed'], recommended_actions: ['Review recorded trace'] };
const analysis = { method: 'five_whys', run_id: 'saved-rca-run', status: 'PARTIAL', created_at: 1700000000, result };
globalThis.fetch = async (path, init) => { request = { path, ...init }; return Response.json(analysis); };
assert.equal((await service.analyzeTicketRca('INC/1', 'five_whys', 'attempt-key')).run_id, analysis.run_id);
assert.equal(request.path, '/api/v1/triage/tickets/INC%2F1/rca');
assert.equal(request.method, 'POST');
assert.deepEqual(JSON.parse(request.body), { method: 'five_whys' });
assert.equal(request.headers.get('Idempotency-Key'), 'attempt-key');
assert.equal(request.headers.get('X-RCA-Project'), 'scope-a');
assert.equal(request.headers.get('Authorization'), 'Bearer test-only-token');

const panelModule = { exports: {} };
vm.runInNewContext(compile(await read('components/RcaAnalysisPanel.tsx')), {
  module: panelModule, exports: panelModule.exports,
  require: id => id === './AnswerMarkdown' ? { AnswerMarkdown: ({ text }) => React.createElement('p', null, text) }
    : id === '../services/api' ? api : require(id),
});
const panel = renderToStaticMarkup(React.createElement(panelModule.exports.RcaAnalysisPanel, { analysis, onOpenRun: () => {} }));
for (const text of ['Saved timeout investigation', 'View source source-1', 'Failure cause unconfirmed', 'Review recorded trace', 'Open investigation saved-rca-run', 'No source citation was saved']) assert.ok(panel.includes(text), text);
assert.doesNotMatch(panel, /89%|ISOLATED ROOT CAUSE|probability|2100/);
assert.ok(panel.indexOf('Observed timeout') < panel.indexOf('Hypothesis needs confirmation'));

const workbenchSource = await read('pages/RCAWorkbench.tsx');
const workbenchAst = ts.createSourceFile('RCAWorkbench.tsx', workbenchSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let analyzeCode;
function findAnalyze(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(workbenchAst) === 'handleAnalyze') analyzeCode = `const ${node.getText(workbenchAst)}; globalThis.analyze = handleAnalyze;`;
  ts.forEachChild(node, findAnalyze);
}
findAnalyze(workbenchAst);
let saved = { ticket_id: 'INC-1', available_methods: [], analyses: {} };
let lastError = null;
let callCount = 0;
const keys = [];
const context = {
  canEdit: true, selectedTicketId: 'INC-1', activeMethod: 'five_whys', rcaData: saved,
  analysisRunning: { current: false }, pendingAttempt: { current: null }, requestVersion: { current: 1 },
  crypto: { randomUUID: () => `attempt-${keys.length}` }, ApiError: api.ApiError,
  setAnalyzing: () => {}, setAnalysisError: error => { lastError = error; }, setRcaData: update => { saved = update(saved); },
  analyzeTicketRca: async (_ticket, _method, key) => {
    keys.push(key);
    if (++callCount === 1) throw new api.ApiError(0, 'Connection lost');
    return analysis;
  },
};
vm.runInNewContext(compile(analyzeCode), context);
await context.analyze();
assert.equal(lastError.retryable, true);
await context.analyze(true);
assert.equal(keys[0], keys[1], 'An uncertain retry must reuse the same idempotency key');
assert.equal(saved.analyses.five_whys.run_id, analysis.run_id);
assert.equal(context.pendingAttempt.current, null);
await context.analyze();
assert.notEqual(keys[2], keys[1], 'A new explicit analysis gets a new key');
context.canEdit = false;
await context.analyze();
assert.equal(keys.length, 3, 'Read-only roles cannot trigger RCA mutation');
context.canEdit = true;
context.selectedTicketId = 'INC-2';
await context.analyze();
assert.equal(keys.length, 3, 'A changed selection must not run with stale ticket data');
context.selectedTicketId = 'INC-1';
context.analyzeTicketRca = async () => { context.requestVersion.current++; return { ...analysis, run_id: 'stale-run' }; };
await context.analyze();
assert.equal(saved.analyses.five_whys.run_id, analysis.run_id, 'A late result cannot overwrite a newer selection');

const appSource = await read('App.tsx');
const roleExpression = /const canEditTriage = ([^;]+);/.exec(appSource)[1];
for (const role of ['PLATFORM_ADMIN', 'PROJECT_OWNER', 'PROJECT_ANALYST', 'PROJECT_MANAGER', 'PROJECT_VIEWER', 'GENERIC_USER']) {
  assert.equal(vm.runInNewContext(roleExpression, { principal: { roles: [role] } }), ['PLATFORM_ADMIN', 'PROJECT_OWNER', 'PROJECT_ANALYST'].includes(role));
}
const emptyRca = { ticket_id: 'INC-1', available_methods: [], analyses: {}, findings: [], fault_tree: { root_gate: null }, context_budget: null };
function renderWorkbench(rcaData, method = 'fault_tree') {
  const state = [[{ id: 'INC-1', summary: 'Recorded incident' }], 'INC-1', method, rcaData, false, null, false, null];
  let index = 0;
  const module = { exports: {} };
  vm.runInNewContext(compile(workbenchSource), { module, exports: module.exports, require: id =>
    id === 'react' ? { ...React, useState: () => [state[index++], () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: value => ({ current: value }) }
    : id === '../services/triage' ? service
    : id === '../services/api' ? api
    : id === '../components/RcaAnalysisPanel' ? panelModule.exports : require(id),
  });
  return renderToStaticMarkup(React.createElement(module.exports.RCAWorkbench, { canEdit: false }));
}
assert.match(renderWorkbench(emptyRca), /No saved analysis is available/);
const savedMarkup = renderWorkbench({ ...emptyRca, available_methods: ['five_whys'], analyses: { five_whys: analysis } }, 'five_whys');
assert.match(savedMarkup, /Saved timeout investigation/);
assert.doesNotMatch(savedMarkup, /ISOLATED ROOT CAUSE/);
console.log('RCA method requests, saved citations, retry identity, scope guards, roles and unavailable analyses verified');

context.analyzeTicketRca = async () => { throw new api.ApiError(409, 'HTTP 409', { detail: { message: 'Run blocked by policy', run_id: 'blocked-run', status: 'BLOCKED' } }); };
await context.analyze();
assert.equal(lastError.message, 'Run blocked by policy');
assert.equal(lastError.runId, 'blocked-run');
assert.equal(lastError.retryable, false);
assert.equal(context.pendingAttempt.current, null);
assert.equal(saved.analyses.five_whys.run_id, analysis.run_id, 'An unsuccessful attempt preserves earlier saved findings');

async function renderSavedPage(path, name, state, props = {}) {
  const source = await read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stateNames = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useState') stateNames.push(node.name.elements[0].getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  let index = 0;
  const module = { exports: {} };
  vm.runInNewContext(compile(source), { module, exports: module.exports, require: id =>
    id === 'react' ? { ...React, useState: initial => { const key = stateNames[index++]; return [key in state ? state[key] : typeof initial === 'function' ? initial() : initial, () => {}]; }, useEffect: () => {}, useCallback: fn => fn, useRef: value => ({ current: value }) }
    : id === '../services/triage' ? service
    : id === '../components/TicketDetailPanel' || id.endsWith('.css') ? {} : require(id),
  });
  return renderToStaticMarkup(React.createElement(module.exports[name], props));
}
const importedTicket = { ticket_id: 'INC-1', summary: 'Recorded waiting incident', description: 'Saved description', priority: 'UNKNOWN', work_state: 'WAITING', current_team: 'Saved team', assignee: null, reporter: null, environment: null, service: null, labels: [], custom_fields: {}, created_at: 1700000000, updated_at: 1700000000 };
const unknownSla = { ticket_id: 'INC-1', priority: 'UNKNOWN', sla_target_seconds: null, sla_remaining_seconds: null, sla_utilization: null, risk_state: 'UNKNOWN', sla_remaining_formatted: 'Not configured', sla_target_formatted: 'Not configured', sla_consumed_formatted: '0s', explanation: 'No SLA target configured', active_stay: null };
const importedEvidence = { evidence_id: 'imported-evidence', source: 'jira', summary: 'Recorded Jira evidence', query_ref: 'source-run', status: 'CANDIDATE', confidence: 0, payload_json: { evidence_id: 'source-1', source: { connector: 'jira', system: 'itsm' }, content_json: '{"ticket_id":"INC-1"}' } };
const workspace = { ticket: importedTicket, sla: unknownSla, queue_stays: [], investigation: { auto_triage_summary: result, what_changed: [], state: 'READY' }, evidence: [importedEvidence], findings: [], governed_actions: [], tool_proposals: [], events: [], related_tickets: [] };
const ticketMarkup = await renderSavedPage('components/TicketDetailPanel.tsx', 'TicketDetailPanel', { activeTab: 'evidence', workspace, loading: false }, { ticketId: 'INC-1', onClose: () => {}, canEdit: false });
assert.match(ticketMarkup, /Recorded Jira evidence/);
assert.match(ticketMarkup, /Confidence unassessed/);
assert.match(ticketMarkup, /Not configured/);
assert.match(ticketMarkup, /disabled="">Accept/);
const board = { urgency_strip: { breached: 0, at_risk: 0, action_required: 1, healthy: 0, unknown: 1 }, work_buckets: { ALL: 1, WAITING: 1 }, focus_queue: [{ ticket: importedTicket, sla: unknownSla, primary_action: 'View' }], team_capacity: [], connectors_health: [], performance_metrics: { mttt: null, mttt_trend: null, auto_triage_success_rate: null, auto_triage_success_trend: null, analyst_validation_rate: null, analyst_validation_trend: null, rca_accuracy_rate: null, rca_accuracy_trend: null }, total_tickets: 1, timestamp: 1700000000 };
const boardMarkup = await renderSavedPage('pages/TriageBoard.tsx', 'TriageBoard', { liveBoard: board, loading: false, workspace, selectedTicketId: 'INC-1' }, { canEdit: false });
assert.match(boardMarkup, /Recorded waiting incident/);
assert.match(boardMarkup, /Not configured/);
assert.doesNotMatch(boardMarkup, /Resolved &amp; Verified|NaN|AI Active|RCA Ready/);
assert.ok(boardMarkup.indexOf('Recorded waiting incident') > boardMarkup.indexOf('>Waiting</div>'), 'Waiting tickets render under the Waiting column');
console.log('Imported source payloads and unknown SLA render safely; waiting remains a distinct queue state');
