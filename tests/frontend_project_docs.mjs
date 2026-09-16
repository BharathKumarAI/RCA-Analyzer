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
const source = await read('pages/ProjectDocs.tsx');
const ast = ts.createSourceFile('ProjectDocs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
const topicModule = { exports: {}, require };
vm.runInNewContext(compile(await read('components/KnowledgeTopicFilter.tsx')), topicModule);
const helpersContext = { documentTopic: topicModule.exports.documentTopic };
vm.runInNewContext(compile(helpers + '\nglobalThis.publishedDocuments=publishedDocuments;globalThis.matchingDocuments=matchingDocuments;'), helpersContext);
const approved = { id: 'ops', title: 'Service restart', category: 'Playbook', tags: ['operations'], content: '# Approved\nInspect saturation before restarting.', status: 'approved', content_hash: 'sha256:recorded', revision: 3, reviewed_at: 1234567890 };
const documents = [approved, { ...approved, id: 'guide', title: 'Service architecture', category: 'Guide', tags: ['database'], content: 'Connection pools connect workers.' }];
const unpublished = [
  { ...approved, id: 'draft', status: 'draft' }, { ...approved, id: 'review', status: 'pending_review' },
  { ...approved, id: 'revoked', status: 'revoked' }, { ...approved, id: 'legacy', content_hash: '' },
  { ...approved, id: 'changed', needs_revision: true }, { ...approved, id: 'ineligible', okf_eligibility: { eligible: false } }, { ...approved, id: 'outdated', capture_eligibility: { eligible: false, reasons: ['Source changed'] } },
];
assert.deepEqual(Array.from(helpersContext.publishedDocuments([...documents, ...unpublished]), item => item.id), ['ops', 'guide']);
assert.equal(helpersContext.matchingDocuments(documents, '  SATURATION  ', '', '')[0].id, 'ops', 'Search includes body content, trims whitespace and ignores case');
assert.equal(helpersContext.matchingDocuments(documents, 'service', 'Guide', 'database')[0].id, 'guide');
assert.equal(helpersContext.matchingDocuments(documents, '', 'Playbook', 'database').length, 0, 'Category and tag filters intersect');

let openDocumentLink;
function findLinkHandler(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openDocumentLink') openDocumentLink = node.initializer.getText(ast); ts.forEachChild(node, findLinkHandler); }
findLinkHandler(ast);
let scrolled = 0, targetId;
const link = { article: { current: { contains: () => true } }, document: { getElementById: value => { targetId = value; return { scrollIntoView: () => { scrolled++; } }; } } };
vm.runInNewContext(compile(`globalThis.open = ${openDocumentLink};`), link);
link.open('#restart'); assert.equal(targetId, 'guide-restart'); assert.equal(scrolled, 1);
link.open('project.md#deployment'); assert.equal(scrolled, 1, 'Project document links cannot resolve to the platform handbook');
link.article.current.contains = () => false; link.open('#outside'); assert.equal(scrolled, 1, 'Anchors cannot target outside the active document');

// Run the actual request effect, including stale-project, aborted and failure paths.
let effect;
function findEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, findEffect);
}
findEffect(ast);
let generation = 1, rows = [], loading = false, error = '', resolve, reject, signal;
const state = {
  version: { current: 0 }, AbortController, Error,
  getSessionGeneration: () => generation,
  publishedDocuments: helpersContext.publishedDocuments,
  setDocuments: value => { rows = value; }, setLoading: value => { loading = value; }, setError: value => { error = value; },
  fetchKnowledge: value => { signal = value; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
};
vm.runInNewContext(compile(`globalThis.load = ${effect};`), state);
const flush = () => new Promise(resolve => setImmediate(resolve));
let cleanup = state.load(); assert.equal(loading, true);
resolve([...documents, ...unpublished]); await flush();
assert.equal(rows.length, 2); assert.equal(loading, false); assert.equal(error, '');
cleanup(); assert.equal(signal.aborted, true);
cleanup = state.load(); generation++; resolve(documents); await flush();
assert.equal(rows.length, 0, 'Previous project results cannot populate the new project'); cleanup();
cleanup = state.load(); reject(new Error('Project library is unavailable')); await flush();
assert.equal(error, 'Project library is unavailable'); assert.equal(loading, false); assert.equal(rows.length, 0); cleanup();
cleanup = state.load(); cleanup(); reject(new Error('Aborted')); await flush(); assert.equal(error, '', 'An aborted request does not become a visible error');

function render(values, props = {}) {
  let index = 0;
  const react = { ...React, useState: value => [values[index++] ?? value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }) };
  const context = { exports: {}, require: id => {
    if (id === 'react') return react;
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id.endsWith('/KnowledgeTopicFilter')) return topicModule.exports;
    if (id.endsWith('/KnowledgeCaptureSource')) return { KnowledgeCaptureSource: () => null };
    if (id.endsWith('/AnswerMarkdown')) return { AnswerMarkdown: ({ text }) => React.createElement('div', { 'data-markdown': true }, text) };
    if (id.endsWith('/api') || id.endsWith('.css')) return {};
    return require(id);
  } };
  vm.runInNewContext(compile(source), context);
  return renderToStaticMarkup(React.createElement(context.exports.ProjectDocs, { projectId: 'payments', onOpenHandbook() {}, ...props }));
}
const ready = render([documents, '', '', '', '', false, '', 0]);
assert.match(ready, /Approved guidance for payments/); assert.match(ready, /data-markdown="true"/);
assert.match(ready, /Approved · revision 3/); assert.match(ready, /Platform handbook/);
assert.doesNotMatch(ready, /Manage documents|Open Knowledge/);
assert.match(render([[], '', '', '', '', false, '', 0], { onManage() {} }), /No approved project documents[\s\S]*Open Knowledge/);
assert.match(render([documents, '', 'no match', '', '', false, '', 0]), /No matching documents/);
const failure = render([[], '', '', '', '', false, 'Library failed', 0]);
assert.match(failure, /role="alert"/); assert.doesNotMatch(failure, /No approved project documents/);

// Existing API helper carries authenticated project scope and cancellation.
const apiSource = await read('services/api.ts');
const api = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(apiSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`);
api.setSessionToken('test-only'); api.setProjectContext('payments');
let request;
globalThis.fetch = async (url, init) => { request = { url, ...init }; return Response.json(documents); };
const controller = new AbortController(); await api.fetchKnowledge(controller.signal);
assert.equal(request.url, '/api/v1/knowledge'); assert.equal(request.headers.get('X-RCA-Project'), 'payments'); assert.equal(request.signal, controller.signal);

// Exercise route parsing rather than assuming both docs URLs resolve identically.
const app = await read('App.tsx');
const appAst = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const routeDeclarations = appAst.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['pageFromSegment', 'readLocationRoute'].includes(declaration.name.getText(appAst)))).map(node => node.getText(appAst)).join('\n');
const route = { window: { location: { pathname: '', hash: '' } }, isActivePage: value => ['docs', 'platform-docs', 'chat'].includes(value) };
vm.runInNewContext(compile(routeDeclarations + '\nglobalThis.readLocationRoute=readLocationRoute;'), route);
for (const [pathname, projectKey, page] of [['/p/payments/docs', 'payments', 'docs'], ['/admins/platform-docs', null, 'platform-docs'], ['/admins/docs', null, 'platform-docs']]) {
  route.window.location.pathname = pathname;
  assert.equal(route.readLocationRoute().projectKey, projectKey); assert.equal(route.readLocationRoute().page, page);
}
assert.match(app, /activePage === 'platform-docs' && !isAuthorizedAdmin \? principal\.project_id : null/, 'Readers keep project navigation when opening the handbook');
assert.match(app, /!routeProjectKey && !isAuthorizedAdmin && activePage !== 'platform-docs'/, 'The handbook does not require administrator access');

// The project module navigator includes both distinct libraries, while admin navigation excludes project docs.
const topbar = await read('components/Topbar.tsx');
const topAst = ts.createSourceFile('Topbar.tsx', topbar, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let navExpression;
function findNav(node) { if (ts.isVariableDeclaration(node) && node.name.getText(topAst) === 'visibleNavItems') navExpression = node.initializer.getText(topAst); ts.forEachChild(node, findNav); }
findNav(topAst);
const nav = { settings: { navigation: ['docs', 'platform-docs', 'settings'].map(page => ({ page, visible: true })) }, projectKey: 'payments', canAdmin: false, isPlatformAdmin: false };
vm.runInNewContext(compile(`globalThis.visible = () => ${navExpression};`), nav);
assert.deepEqual(Array.from(nav.visible(), item => item.page), ['docs', 'platform-docs']);
nav.projectKey = null; assert.deepEqual(Array.from(nav.visible(), item => item.page), ['platform-docs']);
nav.settings.navigation[1].visible = false; assert.equal(nav.visible().length, 0, 'Saved page visibility remains effective');

const palette = await read('components/CommandPalette.tsx');
const paletteAst = ts.createSourceFile('CommandPalette.tsx', palette, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let filterExpression;
function findFilter(node) { if (ts.isVariableDeclaration(node) && node.name.getText(paletteAst) === 'filtered') filterExpression = node.initializer.getText(paletteAst); ts.forEachChild(node, findFilter); }
findFilter(paletteAst);
const search = { query: 'docs', items: [
  { page: 'docs', title: 'Team runbooks', description: 'Approved project guidance', category: 'Workspace' },
  { page: 'platform-docs', title: 'Platform handbook', description: 'Deployment and operating guides', category: 'Help' },
] };
vm.runInNewContext(compile(`globalThis.filter = () => ${filterExpression};`), search);
assert.equal(search.filter().length, 2, 'Searching docs finds both distinct pages even when labels are customized');
search.query = 'deployment'; assert.equal(search.filter()[0].page, 'platform-docs', 'Descriptions are searchable');
console.log('Project library approval, search, scope, request races, rendering and handbook routing passed');
