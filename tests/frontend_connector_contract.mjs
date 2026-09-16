import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
// Exercise the persistence-column/public-payload boundary and invalidate test evidence on edit.
const normalized = api.normalizeEnvironmentConnection({ connection_id: 'qa', connection_name: 'QA', environment_name: 'qa', routing_mode: 'direct', target_json: { endpoint: 'https://qa.example.test' }, credentials_json: { token_secret_ref: 'env://QA_TOKEN' }, resource_scope_json: ['QA'], mcp_configuration_json: {}, enabled: true, status: 'active', test_status: 'PASSED', last_tested_at: 123 });
assert.deepEqual(normalized.target, { endpoint: 'https://qa.example.test' });
assert.equal(normalized.credentials.token_secret_ref, 'env://QA_TOKEN');
assert.equal(normalized.test_status, 'passed');
const draft = api.environmentConnectionDraft(normalized);
assert.equal(draft.enabled, false);
assert.equal(draft.status, 'draft');
assert.equal(draft.test_status, 'not_tested');
assert.equal(draft.last_tested_at, null);
assert.deepEqual(draft.resource_scope, ['QA']);
assert.ok(!('target_json' in draft));
assert.ok(!('updated_at' in draft));
assert.deepEqual(api.environmentConnectionDraft({}).resource_scope, []);

// Existing instances keep their reviewed template identity through candidate and save.
const vm = await import('node:vm');
const { createRequire } = await import('node:module');
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const editorSource = await fs.readFile(new URL('../frontend/src/components/ConnectorInstanceEditor.tsx', import.meta.url), 'utf8');
const editorAst = ts.createSourceFile('ConnectorInstanceEditor.tsx', editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = {};
function locate(node) {
  if (ts.isVariableDeclaration(node) && ['currentCandidate', 'ConnectorInstanceEditor'].includes(node.name.getText(editorAst))) nodes[node.name.getText(editorAst)] = node;
  if (ts.isCallExpression(node) && node.expression.getText(editorAst) === 'saveProjectConnector') nodes.save = node.arguments[1];
  ts.forEachChild(node, locate);
}
locate(editorAst);
let candidateObject;
function findCandidate(node) { if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) candidateObject = node.expression; ts.forEachChild(node, findCandidate); }
findCandidate(nodes.currentCandidate.initializer.arguments[0]);
const fieldExpression = (object, key) => object.properties.find(property => property.name?.getText(editorAst) === key)?.initializer.getText(editorAst);
for (const field of ['template_id', 'template_version']) assert.ok(fieldExpression(candidateObject, field));
const candidateIdentity = context => Object.fromEntries(['template_id', 'template_version'].map(field => [field, vm.runInNewContext(fieldExpression(candidateObject, field), context)]));
const savedInstance = { template_id: 'jira-reviewed', template_version: '1.2.0' };
const latestTemplate = { template_id: 'jira-reviewed', system_name: 'jira-reviewed', version: '2.0.0' };
const pinned = candidateIdentity({ savedInstance, template: latestTemplate });
assert.deepEqual(pinned, savedInstance, 'Editing an existing connection cannot silently select the catalog latest version');
assert.deepEqual(candidateIdentity({ savedInstance: undefined, template: latestTemplate }), { template_id: 'jira-reviewed', template_version: '2.0.0' });
for (const field of ['template_id', 'template_version']) assert.equal(vm.runInNewContext(fieldExpression(nodes.save, field), { currentCandidate: pinned, template: latestTemplate, savedInstance }), pinned[field], 'The persisted identity must match the tested candidate');

let templateRequest;
globalThis.fetch = async (url, init) => { templateRequest = { url, ...init }; return Response.json({ template_id: 'jira/reviewed', version: '1.2.0+approved' }); };
await api.fetchConnectorTemplate('jira/reviewed', '1.2.0+approved');
assert.equal(templateRequest.url, '/api/v1/connectors/templates/jira%2Freviewed?version=1.2.0%2Bapproved');

const wrapperCode = ts.transpileModule(`export {}; const ${nodes.ConnectorInstanceEditor.getText(editorAst)}; globalThis.Editor = ConnectorInstanceEditor;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function mountWrapper(props) {
  const values = [], effects = [], requests = [], forms = [];
  let cursor = 0;
  const context = { exports: {}, require, Error,
    useState: initial => { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useEffect: effect => effects.push(effect),
    fetchConnectorTemplate: (id, version) => new Promise((resolve, reject) => requests.push({ id, version, resolve, reject })),
    ConnectorInstanceEditorForm: formProps => { forms.push(formProps); return React.createElement('div', { 'data-editor-version': formProps.template.version }); },
  };
  vm.runInNewContext(wrapperCode, context);
  return { requests, effects, values, forms, render(next = props) { cursor = 0; return renderToStaticMarkup(context.Editor(next)); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const props = { projectId: 'payments', instance: savedInstance, template: latestTemplate, templateDefaults: 'Latest-only defaults' };
const wrapper = mountWrapper(props);
assert.match(wrapper.render(), /Loading the saved template version/); assert.equal(wrapper.forms.length, 0);
wrapper.effects.pop()();
assert.deepEqual([wrapper.requests[0].id, wrapper.requests[0].version], ['jira-reviewed', '1.2.0']);
wrapper.requests[0].resolve({ template_id: 'jira-reviewed', version: '1.2.0', default_config: { reviewed: true } }); await settle();
assert.match(wrapper.render(), /data-editor-version="1.2.0"/);
assert.equal(wrapper.forms[0].templateDefaults, undefined, 'Latest-version defaults cannot leak into the pinned form');
assert.equal(wrapper.forms[0].template.default_config.reviewed, true);
assert.match(wrapper.render({ ...props, projectId: 'other-project' }), /Loading the saved template version/);
assert.equal(wrapper.forms.length, 1, 'A template loaded under another scope cannot initialize this editor');

const stale = mountWrapper(props); stale.render(); const cancel = stale.effects.pop()(); cancel();
stale.requests[0].resolve({ template_id: 'jira-reviewed', version: '1.2.0' }); await settle();
assert.equal(stale.values[0], null, 'A stale template response is discarded after cleanup');
assert.equal(stale.forms.length, 0);
const failure = mountWrapper(props); failure.render(); failure.effects.pop()();
failure.requests[0].reject(new Error('Pinned version unavailable')); await settle();
assert.match(failure.render(), /Pinned version unavailable/); assert.equal(failure.forms.length, 0);
assert.match(failure.render(), /Retry template/);
const matched = mountWrapper({ ...props, template: { template_id: savedInstance.template_id, version: savedInstance.template_version } });
assert.match(matched.render(), /data-editor-version="1.2.0"/); matched.effects.pop()(); assert.equal(matched.requests.length, 0, 'Already matching pinned templates do not require a redundant request');
console.log('Saved connector template identity, exact-version loading, failed loads and stale scope isolation pass');
