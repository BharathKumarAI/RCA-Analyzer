import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const sidebar = await readFile(new URL('../frontend/src/components/Sidebar.tsx', import.meta.url), 'utf8');
const palette = await readFile(new URL('../frontend/src/components/CommandPalette.tsx', import.meta.url), 'utf8');

// Keep the shell contract tied to persisted navigation settings: order is the
// server array order, while hidden entries must never render or become commands.
assert.match(sidebar, /settings\.navigation\s*\.filter\(item =>\s*item\.visible &&/);
assert.match(sidebar, /navigation\s*\.filter\(\(?item\)? => item\.group === group\)/);
assert.match(sidebar, /<span>\{item\.label\}<\/span>/);
assert.match(palette, /if \(!item\.visible \|\| !isActivePage\(item\.page\)\) return \[\]/);
assert.match(palette, /title: item\.label/);
assert.match(palette, /category: item\.group/);
console.log('shell navigation persistence checks passed');

const app = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const topbar = await readFile(new URL('../frontend/src/components/Topbar.tsx', import.meta.url), 'utf8');
const connectorEditor = await readFile(new URL('../frontend/src/components/ConnectorInstanceEditor.tsx', import.meta.url), 'utf8');
// Exercise the real route functions instead of asserting their local variable names.
const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = `const ${node.getText(parsed)};`;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found, `${name} remains available for route contract checks`);
  return found;
}
const state = { url: '', page: '', navigations: 0 };
let allowNavigation = true;
const location = { pathname: '/admins/overview', search: '?stale=old', hash: '' };
const context = {
  principal: { project_id: 'team-a' }, routeProjectKey: null,
  Event, PopStateEvent: class extends Event {},
  isActivePage: value => ['overview', 'settings', 'chat', 'knowledge', 'insights', 'skills', 'runs', 'project-setup'].includes(value),
  setActivePage: page => { state.page = page; },
  window: { location, history: { pushState: (_state, _unused, url) => { state.url = url; } }, dispatchEvent: event => {
    if (event.type === 'rca:before-navigation') return allowNavigation;
    state.navigations++; return true;
  } },
};
const code = ['pageFromSegment', 'readLocationRoute', 'projectPath', 'handleSelectPage'].map(declaration).join('\n');
vm.createContext(context);
vm.runInContext(ts.transpileModule(`${code}\nglobalThis.navigate = handleSelectPage; globalThis.route = readLocationRoute;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
context.navigate('settings', 'section=company-sign-in');
assert.equal(state.url, '/admins/settings?section=company-sign-in', 'admin settings stay in administration and use the requested section');
context.navigate('skills');
assert.equal(state.url, '/admins/skills', 'unrelated query parameters do not leak between pages');
for (const page of ['chat', 'knowledge', 'insights', 'project-setup']) {
  context.navigate(page);
  assert.equal(state.url, `/p/team-a/${page}`, 'team workflows open the assigned project from administration');
}
context.routeProjectKey = 'team-b';
context.navigate('runs', '?run=selected');
assert.equal(state.url, '/p/team-b/runs?run=selected', 'project history remains in the route project context');
const before = { ...state };
allowNavigation = false;
context.navigate('settings');
assert.deepEqual(state, before, 'an unsaved work guard prevents both URL and page changes');
location.pathname = '/p/team%20a/chat';
assert.equal(context.route().projectKey, 'team a');
assert.equal(context.route().page, 'chat');
location.pathname = '/p/%E0%A4%A/chat';
assert.equal(context.route().invalidProjectKey, true, 'malformed project keys fail closed');
location.pathname = '/admins/settings';
assert.equal(context.route().projectKey, null);
assert.equal(context.route().page, 'settings');
assert.doesNotMatch(connectorEditor, /payments-prod/);
assert.match(topbar, /projectSelector/, 'the topbar receives the server-backed project selector');
console.log('admin and project navigation separation, deep links, and draft guards passed');
