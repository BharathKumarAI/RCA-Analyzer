import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(source, overrides = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: id => overrides[id] || require(id) });
  return module.exports;
}
const bindingSource = await fs.readFile(new URL('../frontend/src/features/harness-studio/inspector/EnvironmentBindings.tsx', import.meta.url), 'utf8');
const binding = load(bindingSource);
const source = await fs.readFile(new URL('../frontend/src/features/harness-studio/inspector/InspectorPanel.tsx', import.meta.url), 'utf8');
const { InspectorPanel } = load(source, { './EnvironmentBindings': binding, '../compiler/registry': { COMPONENT_REGISTRY: {} } });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree == null || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props.children)];
}
const component = { id: 'source', kind: 'agent', name: 'Source investigator', origin: { editable: true, source: 'yaml' }, stageModel: 'logs', model: 'previous-model', tools: [] };
const harness = { harness: { tools: [], connectors: [] } };
let updated;
const props = { component, harness, onUpdateComponent: value => { updated = value; } };
const tree = InspectorPanel(props);
const field = nodes(tree).find(node => node.props['aria-label'] === 'Model stage');
assert.equal(field.props.disabled, false);
field.props.onChange({ target: { value: 'oracle_diagnostics' } });
assert.equal(updated.stageModel, 'oracle_diagnostics');
assert.equal(updated.model, undefined, 'a newly chosen stage resolves its model on the backend');
const readonly = InspectorPanel({ ...props, component: { ...component, origin: { ...component.origin, editable: false } } });
assert.equal(nodes(readonly).find(node => node.props['aria-label'] === 'Model stage').props.disabled, true);

const tool = { id: 'oracle.read_evidence', name: 'Read Oracle evidence', scope: 'project', requiredConnectorId: 'oracle' };
const render = connector => renderToStaticMarkup(React.createElement(binding.EnvironmentBindings, { tool, connector }));
assert.match(render({ connectorId: 'oracle', projectEnvironment: 'payments-prod' }), /payments-prod/);
assert.match(render(undefined), /Selected when running/);
assert.doesNotMatch(render(undefined), /<select|<button|Primary Quality Lab|Pre-Prod Mirror/);
console.log('Harness model stage editing and real binding display passed');
