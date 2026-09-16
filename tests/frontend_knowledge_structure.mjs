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
function evaluate(source, imports = {}) {
  const context = { exports: {}, require: id => id in imports ? imports[id] : require(id) };
  vm.runInNewContext(compile(source), context);
  return context.exports;
}
let request;
const service = evaluate(await read('services/knowledge.ts'), { './api': { request: async (url, options) => { request = { url, ...options }; return {}; } } });
await service.fetchKnowledgeSettings(); assert.equal(request.url, '/api/v1/knowledge/settings');
await service.saveKnowledgeSettings(6, null, 4);
assert.equal(request.method, 'PUT'); assert.deepEqual(JSON.parse(JSON.stringify(request.body)), { lookback_months: 6, expected_revision: null, expected_definition_revision: 4 });
const structure = { topic: 'Payments / Checkout', summary: 'Known pool checks', blocks: [{ kind: 'sanity', title: 'Check available connections', content: 'Inspect the observed connection count.\n\n```sql\nSELECT 1;\n```' }] };
assert.equal(service.knowledgeStructureError(structure, 1000), null);
assert.match(service.knowledgeStructureError({ ...structure, topic: ' ' }, 1000), /topic/);
assert.match(service.knowledgeStructureError({ ...structure, blocks: [{ ...structure.blocks[0], content: 'x'.repeat(16001) }] }, 100000), /16,000/);
assert.match(service.knowledgeStructureError(structure, 20), /project text limit/);
assert.equal(service.knowledgeStructureError({ ...structure, blocks: [{ ...structure.blocks[0], kind: 'Customer-specific recovery check' }] }, 1000), null, 'Project section kinds are not a hard-coded taxonomy');
const topics = evaluate(await read('components/KnowledgeTopicFilter.tsx'));
assert.deepEqual(JSON.parse(JSON.stringify(topics.knowledgeTopics([{ structure }, { structure }, {}, { structure: { ...structure, topic: 'Release ownership' } }]))), [
  { topic: '', count: 1 }, { topic: 'Payments / Checkout', count: 2 }, { topic: 'Release ownership', count: 1 },
]);
const topicHtml = renderToStaticMarkup(React.createElement(topics.KnowledgeTopicFilter, { items: [{ structure }, {}], value: '', onChange() {} }));
assert.match(topicHtml, /Unclassified \(1\)/); assert.match(topicHtml, /Payments \/ Checkout \(1\)/);

// Execute the actual document submit function, checking structured round-trip and conversion.
const form = await read('components/KnowledgeDocumentForm.tsx');
const formAst = ts.createSourceFile('form.tsx', form, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let save;
function findSave(node) { if (ts.isVariableDeclaration(node) && node.name.getText(formAst) === 'save') save = node.initializer.getText(formAst); ts.forEachChild(node, findSave); }
findSave(formAst);
let payload, error;
const formState = { busy: false, title: 'Pool procedure', limits: { max_text_chars: 1000 }, item: { id: 'saved', content_hash: 'sha256:recorded' }, mode: 'structured', structure,
  content: 'Existing text', tags: 'ops, ops', associations: { required: false, capability_ids: [], environment_ids: [], connector_instance_ids: [] }, category: 'Runbooks', metadata: '',
  knowledgeStructureError: service.knowledgeStructureError, setError: value => { error = value; }, setSaved() {}, setBusy() {}, reset() {}, onSaved() {},
  updateKnowledgeDoc: async (id, body) => { assert.equal(id, 'saved'); payload = body; return body; },
};
vm.runInNewContext(compile(`globalThis.save = ${save};`), formState);
await formState.save({ preventDefault() {} });
assert.equal(payload.structure.topic, structure.topic); assert.equal(payload.content, ''); assert.equal(payload.expected_hash, 'sha256:recorded');
assert.deepEqual(Array.from(payload.tags), ['ops']);
formState.mode = 'text'; await formState.save({ preventDefault() {} }); assert.equal(payload.structure, null); assert.equal(payload.content, 'Existing text');
formState.mode = 'structured'; formState.structure = { ...structure, blocks: [] }; payload = undefined; await formState.save({ preventDefault() {} }); assert.equal(payload, undefined); assert.match(error, /complete every section/);

const intake = await read('components/KnowledgeIntake.tsx');
const intakeAst = ts.createSourceFile('intake.tsx', intake, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let captureInput;
function findCapture(node) { if (ts.isVariableDeclaration(node) && node.name.getText(intakeAst) === 'captureInput') captureInput = node.initializer.getText(intakeAst); ts.forEachChild(node, findCapture); }
findCapture(intakeAst);
const selected = { instance_id: 'jira-production', environment_id: 'production' };
const sourceState = { settings: { lookback_months: 3 }, settingsDirty: false, sources: ['documents'], limit: 50, topic: '', editing: null,
  capabilityIds: { closed_tickets: 'ticket_review' }, sourceLabels: { closed_tickets: 'Closed Jira tickets', confluence: 'Confluence pages' },
  jira: { ready: false, loading: false, error: null, selections: { itsm: selected }, groups: [{ adapter: 'itsm', choices: [{ value: selected }] }] },
  confluence: { loading: false, error: null, selections: {}, groups: [] }, jiraCapabilities: [{ id: 'ticket_review' }], confluenceCapabilities: [],
};
vm.runInNewContext(compile(`globalThis.input = ${captureInput};`), sourceState);
assert.equal(sourceState.input().capture.lookback_months, undefined, 'New capture uses saved server settings rather than a client-invented 90-day window');
sourceState.sources = ['closed_tickets']; assert.equal(sourceState.input().capture.connector_selections.itsm.instance_id, 'jira-production', 'Capture only requires its source adapter, not unrelated connectors on the same capability');
sourceState.jira.selections = {}; assert.throws(() => sourceState.input(), /source instance and environment/, 'Even one configured connector must be selected explicitly');
sourceState.sources = ['documents']; sourceState.settingsDirty = true; assert.throws(() => sourceState.input(), /Save or discard/);
sourceState.settingsDirty = false; sourceState.limit = 0; assert.throws(() => sourceState.input(), /1 to 100/);
sourceState.limit = 50; sourceState.editing = { payload: { capture: { lookback_months: 6 } } }; assert.equal(sourceState.input().capture.lookback_months, 6, 'Editing preserves a previously explicit schedule window');
assert.match(intake, /useState\(1440\)/, 'New schedule starts with a daily interval');
assert.match(intake, /interval_seconds: intervalMinutes \* 60/);
assert.match(intake, /expected_revision: editing\.revision/);
assert.match(intake, /fingerprint, key: crypto\.randomUUID\(\)/, 'Retries preserve the request idempotency key');
assert.match(intake, /generation === getSessionGeneration\(\)/, 'Late job and settings responses cannot cross project context');
assert.match(intake, /Nothing is approved automatically/);
console.log('Structured knowledge, real topic counts, review hashes, saved settings and scoped intake contracts passed');
