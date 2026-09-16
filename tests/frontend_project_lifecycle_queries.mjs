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
const loadService = async path => import(moduleUrl((await read(path)).replace("from './api'", `from '${apiUrl}'`)));
const projects = await loadService('services/projects.ts');
const jira = await loadService('services/jiraQueries.ts');
const kafka = await loadService('services/kafkaTopics.ts');
api.setSessionToken('test-only-token'); api.setProjectContext('project-a');
const calls = [];
globalThis.fetch = async (path, init) => { calls.push({ path, ...init, payload: init.body ? JSON.parse(init.body) : null }); return Response.json({ items: [], status: 'inactive', issues: [], topics: [] }); };
await projects.changeProjectLifecycle({ project_id: 'project/a', content_hash: 'sha256:reviewed' }, 'deactivate', 'Retain records');
assert.equal(calls.at(-1).path, '/api/v1/projects/project%2Fa/lifecycle');
assert.deepEqual(calls.at(-1).payload, { action: 'deactivate', expected_hash: 'sha256:reviewed', reason: 'Retain records' });
const query = { match: 'any', filters: [], groups: [{ match: 'all', filters: [{ field: 'status', operator: '=', value: 'Open' }], groups: [] }], order_by: [], assignees: { member_ids: ['person-a'], role_ids: ['PROJECT_ANALYST'] } };
assert.equal(jira.jiraConditionCount(query), 2);
await jira.discoverJiraQueryFields('project/a', 'jira/main', 'env/a');
assert.equal(calls.at(-1).path, '/api/v1/projects/project%2Fa/connectors/jira%2Fmain/fields?environment_id=env%2Fa&include_schema=true');
await jira.previewJiraQuery('project-a', 'jira', query, 'prod');
assert.deepEqual(calls.at(-1).payload, query);
await jira.testJiraQuery('project-a', 'jira', { query }, 12, 'prod');
assert.deepEqual(calls.at(-1).payload, { query, max_results: 12 });
await jira.testJiraQuery('project-a', 'jira', { custom_jql: 'status = Open' }, 8);
assert.deepEqual(calls.at(-1).payload, { custom_jql: 'status = Open', max_results: 8 });
const selection = { mode: 'filters', topics: [], include: [{ operator: 'starts_with', value: 'orders' }], exclude: [{ operator: 'glob', value: '*-test' }], max_matched_topics: 5 };
await kafka.fetchKafkaTopicScope('project-a', 'kafka', 'prod');
assert.equal(calls.at(-1).path, '/api/v1/projects/project-a/connectors/kafka/kafka/topics?environment_id=prod');
await kafka.previewKafkaTopics('project-a', 'kafka', selection, 'prod');
assert.deepEqual(calls.at(-1).payload, selection);
for (const call of calls) assert.equal(call.headers.get('X-RCA-Project'), 'project-a');

function render(source, props, states, services) {
  let index = 0; const module = { exports: {} };
  vm.runInNewContext(compile(source), { module, exports: module.exports, require: id => id === 'react' ? { ...React, useState: initial => [states?.[index++] ?? initial, () => {}], useEffect: () => {}, useRef: value => ({ current: value }) } : services[id] || require(id) });
  return renderToStaticMarkup(React.createElement(Object.values(module.exports)[0], props));
}
const jiraSource = await read('components/connectors/JiraQueryBuilder.tsx');
const jiraProps = { projectId: 'project-a', instanceId: 'jira', revision: 3, environments: [], query, mapping: {}, savedMapping: {}, onQueryChange: () => {}, onMappingChange: () => {}, customJql: '', readOnly: false };
const matches = { instance_revision: 3, tested_at: 100, returned_count: 1, possibly_truncated: true, jql: 'project = SAVED', issues: [{ key: 'SAVED-1', summary: '<script>untrusted</script>', status: null, priority: null }] };
const html = render(jiraSource, jiraProps, ['', null, null, matches, 20, false, null], { '../../services/jiraQueries': jira });
assert.ok(html.includes('SAVED-1') && html.includes('bounded sample') && html.includes('Unknown'));
assert.ok(html.includes('&lt;script&gt;untrusted&lt;/script&gt;') && !html.includes('<script>'));
const empty = render(jiraSource, { ...jiraProps, instanceId: undefined }, null, { '../../services/jiraQueries': jira });
assert.ok(empty.includes('Save this connection before loading fields'));
assert.match(empty, /disabled=""[^>]*>Test builder matches/);
const kafkaSource = await read('components/connectors/KafkaTopicSelector.tsx');
const kafkaHtml = render(kafkaSource, { projectId: 'project-a', instanceId: 'kafka', environments: [], selection, onChange: () => {}, readOnly: false }, ['', null, { instance_revision: 2, selected_topics: [], topics: [], partial: false, possibly_truncated: false, tested_at: 100 }, false, null], { '../../services/kafkaTopics': kafka });
assert.ok(kafkaHtml.includes('No authorized topics matched') && kafkaHtml.includes('Excludes always win'));

// An aborted request cannot restore evidence from an older editor/environment.
const ast = ts.createSourceFile('JiraQueryBuilder.tsx', jiraSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let perform;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'perform') perform = `const ${node.getText(ast)};globalThis.perform=perform;`; ts.forEachChild(node, visit); }
visit(ast);
let resolve; const changes = [];
const context = { unavailable: false, mappingChanged: false, request: { current: null }, AbortController, projectId: 'project-a', instanceId: 'jira', environment: 'prod', query, limit: 20, customJql: '', Error,
  setBusy: () => {}, setError: () => {}, setPreview: () => {}, setMatches: value => { if (value) changes.push(value); }, setMetadata: value => changes.push(value), discoverJiraQueryFields: () => new Promise(yes => { resolve = yes; }) };
vm.runInNewContext(compile(perform), context);
const pending = context.perform('metadata'); context.request.current.abort(); resolve({ instance_revision: 1 }); await pending;
assert.equal(changes.length, 0);
console.log('Lifecycle optimistic concurrency, authenticated source query wiring, bounded-result rendering and stale-response protection pass');
