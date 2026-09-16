import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let load;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'loadData') load = `const ${node.getText(parsed)};`;
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(load);
const output = ts.transpileModule(`${load}\nglobalThis.loadData = loadData;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const principal = { subject: 'analyst', tenant_id: 'tenant', project_id: 'project', roles: ['PROJECT_ANALYST'] };
function workspace(activePage = 'overview') {
  const state = {}, calls = [];
  let generation = 1;
  const context = {
    principal, activePage, ApiError, Error,
    getSessionGeneration: () => generation,
    clearScopedData: reason => { state.signedOut = reason ?? true; },
    handleAuthenticated: value => { state.reauthenticated = value; },
  };
  for (const [name, value] of Object.entries({ Principal: principal, Health: { status: 'ok' }, Agents: [], Runs: [{ id: 'run-1' }], Tools: [], AuditLogs: [], Notifications: { items: [], unread_count: 0 } })) {
    context[`fetch${name}`] = async () => { calls.push(name); return value; };
  }
  for (const name of ['Health', 'HealthUpdatedAt', 'HealthError', 'Agents', 'Runs', 'Tools', 'AuditLogs', 'UnreadNotificationsCount', 'NotificationsUnavailable', 'LoadingData', 'LoadError']) context[`set${name}`] = value => { state[name] = value; };
  vm.createContext(context); vm.runInContext(output, context);
  return { context, state, calls, changeScope: () => generation++ };
}
const partial = workspace();
partial.context.fetchAgents = async () => { throw new ApiError(403, 'Agent access denied'); };
await partial.context.loadData();
assert.equal(partial.state.Runs[0].id, 'run-1', 'A restricted section must not hide permitted run data');
assert.equal(partial.state.Health.status, 'ok');
assert.equal(partial.state.LoadError, 'Agent access denied');
assert.equal(partial.state.signedOut, undefined);
assert.equal(partial.state.LoadingData, false);
for (const [page, requested] of Object.entries({ chat: [], knowledge: [], agents: ['Agents'], runs: ['Runs'], tools: ['Tools'], governance: ['AuditLogs'], overview: ['Agents', 'Runs'] })) {
  const { context, state, calls } = workspace(page);
  await context.loadData();
  assert.deepEqual(calls.sort(), ['Principal', 'Health', 'Notifications', ...requested].sort(), `${page} loads its permitted sections only`);
  for (const name of ['Agents', 'Runs', 'Tools', 'AuditLogs'].filter(name => !requested.includes(name))) assert.equal(name in state, false, `Skipped ${name} data must not overwrite existing state with null`);
}
const expired = workspace();
expired.context.fetchPrincipal = async () => { throw new ApiError(401, 'Session expired'); };
await expired.context.loadData();
assert.equal(expired.state.signedOut, 'Session expired');
assert.equal(expired.state.Health, undefined);
const changed = workspace();
changed.context.fetchPrincipal = async () => ({ ...principal, project_id: 'different-project' });
await changed.context.loadData();
assert.equal(changed.state.signedOut, true);
assert.equal(changed.state.Runs, undefined, 'Changed membership cannot render data under the previous project');
const roles = workspace();
roles.context.fetchPrincipal = async () => ({ ...principal, roles: ['PROJECT_VIEWER'] });
await roles.context.loadData();
assert.deepEqual(roles.state.reauthenticated.roles, ['PROJECT_VIEWER']);
assert.equal(roles.state.Runs, undefined);
const stale = workspace();
let finish;
stale.context.fetchHealth = () => new Promise(resolve => { finish = resolve; });
const pending = stale.context.loadData();
stale.changeScope();
finish({ status: 'old-project' });
await pending;
assert.equal(stale.state.Health, undefined);
assert.equal(stale.state.Runs, undefined, 'Late requests cannot leak data into a new project');
assert.equal(stale.state.LoadingData, true, 'An old request cannot clear the new scope loading state');
console.log('Workspace loading respects active pages, partial permissions, membership and project changes');
