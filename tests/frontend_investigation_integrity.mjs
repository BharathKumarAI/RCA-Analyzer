import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
async function component(name) {
  const source = await fs.readFile(new URL(`../frontend/src/components/chat/${name}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: id => id === '../AnswerMarkdown' ? { AnswerMarkdown: ({ text }) => React.createElement('p', null, text) } : require(id) });
  return props => renderToStaticMarkup(React.createElement(module.exports[name], props));
}
const brief = await component('ChatExecutiveBrief');
const visual = await component('ChatVisualCard');
const activity = await component('ChatThinkingAccordion');
const run = { id: 'saved-run', capability: 'incident_triage', status: 'FAILED', created_at: '2026-09-15T01:00:00Z', raw: { reason: 'Source connection unavailable' } };
const empty = brief({ run });
assert.match(empty, /Source connection unavailable/);
assert.match(empty, /No collected sources are available/);
assert.doesNotMatch(empty, /Checked|Critical Impact|Under active review|Root cause identified/);
const result = { outcome: 'FINDINGS', summary: 'PostgreSQL is healthy. Investigate the timeout.', findings: [{ summary: '14:02 UTC: Investigate the timeout.', evidence_ids: ['e1'] }], uncertainties: ['Failure mechanism is unconfirmed'], recommended_actions: ['Review the logs'], presentation: 'dashboard' };
const evidence = [{ evidence_id: 'e1', source: { connector: 'oracle', system: 'database' } }];
const saved = brief({ run: { ...run, status: 'PARTIAL', result }, evidence, onInspectSources: () => {} });
assert.match(saved, /oracle: 1 saved evidence item/);
assert.match(saved, /Failure mechanism is unconfirmed/);
assert.match(saved, /Review sources/);
assert.doesNotMatch(saved, /Jira|Splunk|Root cause identified/);
const dashboard = visual({ run: { ...run, result, evidence_count: 0 } });
assert.match(dashboard, /0 Sources/);
assert.doesNotMatch(dashboard, /Impacted:|Root cause isolated|Validated against runbooks|Across Jira/);
const timeline = visual({ run: { ...run, result: { ...result, presentation: 'timeline' } } });
assert.match(timeline, /14:02 UTC: Investigate the timeout/);
assert.match(timeline, /Findings in saved order/);
const unknown = visual({ run: { ...run, result } });
assert.match(unknown, /— Sources/);
const streaming = activity({ run, isStreaming: true });
assert.match(streaming, /Waiting for recorded investigation steps/);
assert.doesNotMatch(streaming, /Thought process|Reasoning|1 steps|Initial reasoning completed/);
const recorded = activity({ run, isStreaming: true, events: [{ node_id: 'tool:get_ticket', kind: 'tool_failed', details: { duration_ms: 12 } }] });
assert.match(recorded, /get_ticket: tool failed/);
assert.doesNotMatch(recorded, /step-completed/);
console.log('Investigation presentation uses saved evidence, explicit uncertainty and observable activity without fabricated telemetry');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;
const apiUrl = moduleUrl(await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8'));
const api = await import(apiUrl);
assert.equal(api.mapRun({ run_id: 'r', incident_id: 'INC-10', stage: 'analysis', status: 'FAILED' }).stages[0].status, 'unconfirmed');
assert.equal(api.mapRun({ run_id: 'r', incident_id: 'INC-10', stage: 'analysis', status: 'FAILED' }).incident_id, 'INC-10');
assert.equal(api.mapRun({ run_id: 'r', stage: 'analysis', status: 'QUEUED' }).stages[0].status, 'queued');
const triage = await import(moduleUrl((await fs.readFile(new URL('../frontend/src/services/triage.ts', import.meta.url), 'utf8')).replace("from './api'", `from '${apiUrl}'`)));
api.setSessionToken('test-only-token');
api.setProjectContext('project-a');
let sent;
globalThis.fetch = async (path, init) => { sent = { path, ...init }; return Response.json({ ticket_id: 'INC-10' }); };
assert.equal((await triage.importRunToTriage('run/one')).ticket_id, 'INC-10');
assert.equal(sent.path, '/api/v1/triage/runs/run%2Fone/import');
assert.equal(sent.method, 'POST');
assert.equal(sent.headers.get('X-RCA-Project'), 'project-a');
assert.equal(sent.headers.get('Authorization'), 'Bearer test-only-token');
await triage.promoteProposalEvidence('proposal-1', 'Reviewed saved result');
assert.equal(JSON.parse(sent.body).confidence, 0, 'Promotion must not fabricate a confidence percentage');
const metricsSource = await fs.readFile(new URL('../frontend/src/pages/Metrics.tsx', import.meta.url), 'utf8');
const metricsAst = ts.createSourceFile('Metrics.tsx', metricsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const snippets = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['getMetricValue', 'hasMissingChartData', 'filters'].includes(node.name.getText(metricsAst))) snippets.push(`const ${node.getText(metricsAst)};`);
  ts.forEachChild(node, visit);
}
visit(metricsAst);
const metricCode = ts.transpileModule(`${snippets.join('\n')}\nglobalThis.metric = getMetricValue; globalThis.missing = hasMissingChartData; globalThis.filters = filters;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const windowOption of ['24h', '30d', 'custom']) {
  const context = { useCallback: callback => callback, chartSeries: [{ value: null }, { value: 0 }], windowOption, startDate: '2026-09-01', endDate: '2026-09-15', mode: 'live', selectedCapability: '' };
  vm.runInNewContext(metricCode, context);
  assert.equal(context.missing, true);
  assert.equal(context.metric({}, 'tickets'), null);
  assert.equal(context.metric({ tickets: 0 }, 'tickets'), 0);
  assert.equal(context.filters.start, windowOption === 'custom' ? '2026-09-01' : undefined, 'Preset windows must not be overridden by calendar dates');
}

globalThis.fetch = async () => Response.json([{ draft_id: 'agent-a', status: 'APPROVED', definition: { id: 'agent-a', name: 'Saved agent', tools: [] } }]);
const [savedAgent] = await api.fetchAgents();
for (const field of ['accuracy', 'hallucination_rate', 'avg_latency_sec', 'temperature', 'thinking_budget', 'max_steps', 'permissions', 'rag_sources']) assert.equal(Object.hasOwn(savedAgent, field), false, `Unmeasured agent field ${field} must not be invented`);
globalThis.fetch = async () => Response.json({ status: 'healthy', active_runs: 2, total_runs: 8, mode: 'live' });
const savedHealth = await api.fetchHealth();
assert.equal(savedHealth.active_runs, 2);
for (const field of ['mttr_minutes', 'tool_success_rate', 'active_agents_count']) assert.equal(Object.hasOwn(savedHealth, field), false, `Unmeasured health field ${field} must not be invented`);
