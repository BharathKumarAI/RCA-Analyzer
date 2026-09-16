import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = await fs.readFile(new URL('../frontend/src/components/chat/ChatAnswerVisuals.tsx', import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const observed = { basis: 'observed', evidence_ids: ['ev_saved'] };
const chart = { id: 'chart', kind: 'chart', title: 'Measured errors', description: 'Saved observations', chart_type: 'line', x_label: 'Window', y_label: 'Errors', unit: 'count', points: [{ label: 'First', value: 0, ...observed }, { label: 'Missing', value: null, ...observed }, { label: 'Last', value: 4, ...observed, basis: 'inferred' }] };
const table = { id: 'table', kind: 'table', title: 'Saved measurements', description: '', columns: [{ id: 'service', label: 'Service', data_type: 'text' }, { id: 'latency', label: 'Latency', data_type: 'number', unit: 'ms' }], rows: [{ cells: ['Slow service', 10], ...observed }, { cells: ['Fast service', 2], ...observed }, { cells: ['Unknown service', null], ...observed }] };
const graph = { id: 'graph', kind: 'blast_radius', title: 'Reported scope', description: 'Inferences need verification', nodes: [{ id: 'api', label: 'API', node_type: 'service', status: 'affected', ...observed }, { id: 'db', label: 'Database', node_type: 'database', status: 'unknown', ...observed }], edges: [{ id: 'edge', source: 'api', target: 'db', label: 'Queries database', ...observed, basis: 'inferred' }], focus_node_ids: ['api'] };
const code = { id: 'code', kind: 'code', title: 'Source excerpt', description: '', language: 'text', code: '<script>alert("untrusted")</script>\n<img src="https://example.test/track">', ...observed };

function mount(visuals) {
  const state = [];
  let index = 0;
  const sources = [], copied = [];
  const module = { exports: {} };
  const hooks = { ...React, useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; }, useId: () => `visual-${index++}` };
  vm.runInNewContext(compile(source + '\nmodule.exports.chartGeometry = chartGeometry;'), { module, exports: module.exports, Intl, navigator: { clipboard: { writeText: async text => copied.push(text) } }, require: id => id === 'react' ? hooks : id === '../MarkdownCodeBlock' ? { MarkdownCodeBlock: ({ language, source }) => React.createElement('div', { 'data-language': language }, source) } : id.endsWith('.css') ? {} : require(id) });
  const element = () => React.createElement(module.exports.ChatAnswerVisuals, { visuals, onInspectSources: id => sources.push(id) });
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return { module: module.exports, sources, copied, render: () => { index = 0; return renderToStaticMarkup(element()); }, tree: () => { index = 0; return expand(element()); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree == null || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props.children)];
}
function content(tree) { if (Array.isArray(tree)) return tree.map(content).join(''); return typeof tree === 'object' && tree ? content(tree.props.children) : String(tree ?? ''); }
function button(tree, label) { return nodes(tree).find(node => node.type === 'button' && content(node).includes(label)); }

const chartView = mount([chart]);
let markup = chartView.render();
assert.match(markup, /0 count/);
assert.match(markup, /Missing: Unknown/);
assert.doesNotMatch(markup, /class="answer-chart-line/); // Never bridge a missing measurement.
assert.ok(Number.isFinite(chartView.module.chartGeometry(chart.points).y(0)));
const extremes = chartView.module.chartGeometry([{ value: -Number.MAX_VALUE }, { value: Number.MAX_VALUE }]);
assert.equal(extremes.y(-Number.MAX_VALUE), 210);
assert.equal(extremes.y(Number.MAX_VALUE), 20);
let point = nodes(chartView.tree()).find(node => node.props['aria-label']?.startsWith('Last:'));
point.props.onKeyDown({ key: 'Enter', preventDefault() {} });
button(chartView.tree(), 'Source 1').props.onClick();
assert.deepEqual(chartView.sources, ['ev_saved']);
button(chartView.tree(), 'Data table').props.onClick();
markup = chartView.render();
assert.match(markup, /<table>/);
assert.match(markup, /<td>Unknown<\/td>/);
assert.match(markup, /<td>inferred<\/td>/);

const tableView = mount([table]);
button(tableView.tree(), 'Latency').props.onClick();
markup = tableView.render();
assert.ok(markup.indexOf('Fast service') < markup.indexOf('Slow service'));
assert.ok(markup.indexOf('Unknown service') > markup.indexOf('Slow service'));
assert.match(markup, /aria-sort="ascending"/);
button(tableView.tree(), 'Latency').props.onClick();
markup = tableView.render();
assert.ok(markup.indexOf('Slow service') < markup.indexOf('Fast service'));
assert.ok(markup.indexOf('Unknown service') > markup.indexOf('Fast service'));

const graphView = mount([graph]);
markup = graphView.render();
assert.match(markup, /Queries database/);
assert.match(markup, /Database, database, unknown, observed/);
assert.match(markup, /answer-graph-edge is-inferred is-active/);
const checkbox = nodes(graphView.tree()).find(node => node.type === 'input' && node.props.type === 'checkbox');
checkbox.props.onChange({ target: { checked: true } });
markup = graphView.render();
assert.doesNotMatch(markup, /Queries database/);
assert.match(markup, /2 nodes and 0 relationships/);
assert.match(markup, /No recorded relationships match this selection/);
const node = nodes(graphView.tree()).find(item => item.props['aria-label']?.startsWith('Database, '));
node.props.onKeyDown({ key: ' ', preventDefault() {} });
assert.match(graphView.render(), /Relationships involving Database/);

const codeView = mount([code]);
markup = codeView.render();
assert.match(markup, /&lt;script&gt;/);
assert.match(markup, /&lt;img/);
assert.doesNotMatch(markup, /<script>|<img|<iframe/);
await button(codeView.tree(), 'Copy text').props.onClick();
assert.equal(codeView.copied[0], code.code);
assert.match(codeView.render(), /Copied/);
const mermaidView = mount([{ ...code, language: 'mermaid', code: 'flowchart LR\nA --> B' }]);
assert.match(mermaidView.render(), /data-language="mermaid"/);
assert.match(mermaidView.render(), /Source 1/);

const cardSource = await fs.readFile(new URL('../frontend/src/components/chat/ChatVisualCard.tsx', import.meta.url), 'utf8');
const cardModule = { exports: {} };
vm.runInNewContext(compile(cardSource), { module: cardModule, exports: cardModule.exports, require: id => id === './ChatAnswerVisuals' ? { ChatAnswerVisuals: ({ visuals }) => React.createElement('p', null, `Saved visual: ${visuals[0].title}`) } : id === '../AnswerMarkdown' ? {} : require(id) });
assert.match(renderToStaticMarkup(React.createElement(cardModule.exports.ChatVisualCard, { run: { result: { visuals: [chart] } } })), /Saved visual: Measured errors/);
console.log('Saved charts, sortable tables, topology, source interactions and code render safely without fabricated values');
