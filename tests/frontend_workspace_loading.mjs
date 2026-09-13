import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const load = source.slice(source.indexOf('  const loadData ='), source.indexOf('  const clearScopedData ='));
const output = ts.transpileModule(`${load}\nglobalThis.loadData = loadData;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const principal = { subject: 'analyst', tenant_id: 'tenant', project_id: 'project' };
const state = {};
const context = {
  principal, ApiError, Error,
  getSessionToken: () => 'test-session',
  fetchPrincipal: async () => principal,
  fetchHealth: async () => ({ status: 'ok' }),
  fetchAgents: async () => { throw new ApiError(403, 'Agent access denied'); },
  fetchRuns: async () => [{ id: 'run-1' }],
  fetchTools: async () => [],
  fetchAuditLogs: async () => [],
  fetchNotifications: async () => ({ items: [], unread_count: 0 }),
  clearScopedData: reason => { state.signedOut = reason; },
};
for (const name of ['Health', 'Agents', 'Runs', 'Tools', 'AuditLogs', 'UnreadNotificationsCount', 'LoadingData', 'LoadError']) context[`set${name}`] = value => { state[name] = value; };
vm.createContext(context);
vm.runInContext(output, context);
await context.loadData();
assert.equal(state.Runs[0].id, 'run-1', 'A restricted section must not hide permitted run data');
assert.equal(state.Health.status, 'ok');
assert.equal(state.LoadError, 'Agent access denied');
assert.equal(state.signedOut, undefined);
assert.equal(state.LoadingData, false);
context.fetchPrincipal = async () => { throw new ApiError(401, 'Session expired'); };
await context.loadData();
assert.equal(state.signedOut, 'Session expired');
console.log('frontend partial workspace loading checks passed');
