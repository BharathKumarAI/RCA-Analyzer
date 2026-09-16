import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(transpile(source)).toString('base64')}`;
const apiUrl = moduleUrl(await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8'));
const api = await import(apiUrl);
const harnessSource = await fs.readFile(new URL('../frontend/src/features/harness-studio/harnessApi.ts', import.meta.url), 'utf8');
const harness = await import(moduleUrl(harnessSource.replace("from '../../services/api'", `from '${apiUrl}'`)));
const session = { authentication: 'sso', csrf_token: 'csrf-test-value', expires_at: 10_000, principal: { subject: 'reviewer', roles: ['PLATFORM_ADMIN'], tenant_id: 'tenant', project_id: 'project' } };
let latest;
globalThis.fetch = async (path, init) => {
  latest = { path, ...init };
  if (path === '/api/v1/auth/session') return Response.json(session);
  if (path.includes('stream=true')) return new Response('event: complete\ndata: {"summary":"done"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 });
  return Response.json({});
};

assert.equal(api.hasSessionAuthentication(), false);
await api.fetchAuthSession();
assert.equal(api.hasSessionAuthentication(), true, 'a verified cookie session unlocks the workspace');
assert.equal(api.getSessionToken(), null, 'cookie credentials never become readable bearer tokens');
assert.equal(api.authHeaders({}, 'GET').has('X-CSRF-Token'), false);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  await api.request('/api/v1/protected-action', { method, body: { value: 1 } });
  assert.equal(latest.headers.get('X-CSRF-Token'), session.csrf_token);
  assert.equal(latest.headers.has('Authorization'), false);
  assert.equal(latest.credentials, 'same-origin');
}
await harness.streamStudioRun('attachment_review', 'Inspect', () => {});
assert.equal(latest.headers.get('X-CSRF-Token'), session.csrf_token, 'streamed chat uses the same cookie CSRF protection');
assert.equal(latest.credentials, 'same-origin');
await api.logoutSession();
assert.equal(latest.headers.get('X-CSRF-Token'), session.csrf_token, 'logout itself is protected');
assert.equal(api.hasSessionAuthentication(), false);
assert.equal(api.authHeaders({}, 'POST').has('X-CSRF-Token'), false);

let resolveSession;
globalThis.fetch = () => new Promise(resolve => { resolveSession = resolve; });
const pending = api.fetchAuthSession();
const previousGeneration = api.getSessionGeneration();
api.setSessionToken(null);
assert.ok(api.getSessionGeneration() > previousGeneration);
resolveSession(Response.json(session));
await pending;
assert.equal(api.hasSessionAuthentication(), false, 'a late session probe cannot restore a signed-out session');

api.setSessionToken('test-only-bearer');
assert.equal(api.authHeaders({}, 'POST').get('Authorization'), 'Bearer test-only-bearer');
assert.equal(api.authHeaders({}, 'POST').has('X-CSRF-Token'), false);
console.log('Cookie session, CSRF, streamed request, logout, and stale probe contracts passed');
