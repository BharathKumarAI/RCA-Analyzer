import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove } }).outputText;
const storage = new Map([['rca_auth_token', 'legacy-token']]);
globalThis.window = { sessionStorage: { removeItem: key => storage.delete(key) }, localStorage: { removeItem: key => storage.delete(key) } };
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(api.getSessionToken(), null);
assert.equal(storage.has('rca_auth_token'), false);
let calls = [];
globalThis.fetch = async (path, init = {}) => {
  calls.push({ path, init });
  if (path.endsWith('/invalid')) return responseError(422, [{ loc: ['body', 'prompt'], msg: 'String should have at least 1 character' }]);
  if (path.endsWith('/network')) throw new Error('offline');
  const body = init.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : undefined;
  if (path === '/api/v1/me') return response({ subject: 'operator@example.test', roles: ['OPERATOR'], tenant_id: 't1', project_id: 'p1' });
  if (path.startsWith('/api/v1/runs?')) return response([]);
  if (path === '/api/v1/runs') { assert.deepEqual(body, { capability: 'incident_triage', prompt: 'Inspect', incident_id: 'INC-1', chat_id: 'chat_' + 'b'.repeat(32), attachment_ids: ['att_1'] }); return response({ run_id: 'run_SUCCEEDED', capability: 'incident_triage', status: 'SUCCEEDED', created_at: 10, updated_at: 12 }); }
  if (path === '/api/v1/agent-configurations') return response([{ draft_id: 'draft_1', author_subject: 'operator@example.test', content_hash: 'sha256:' + 'a'.repeat(64), status: 'PENDING', created_at: 10, definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: 'test', instruction: 'inspect', capability: 'incident_triage', model_profile: 'balanced-investigation', tools: ['itsm.get_ticket'] } }]);
  if (path.endsWith('/approve')) { assert.deepEqual(body, { expected_hash: 'sha256:' + 'a'.repeat(64), reason: 'reviewed' }); return response({ draft_id: 'draft_1', status: 'APPROVED', content_hash: 'sha256:' + 'a'.repeat(64), created_at: 10, author_subject: 'operator@example.test', definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: '', instruction: '', capability: 'incident_triage' } }); }
  if (path.endsWith('/revoke')) { assert.deepEqual(body, { reason: 'retired' }); return response({ draft_id: 'draft_1', status: 'REVOKED', content_hash: 'sha256:' + 'a'.repeat(64), created_at: 10, author_subject: 'operator@example.test', definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: '', instruction: '', capability: 'incident_triage' } }); }
  if (path.startsWith('/api/v1/runs/run_')) { const status = path.endsWith('run_1') ? 'BLOCKED' : path.split('_').at(-1); return response({ run_id: path.split('/').at(-1), capability: 'incident_triage', status, created_at: 10, updated_at: 12, stage: 'triage', evidence_count: 2, reason: 'policy' }); }
  if (path === '/api/v1/files') { assert.ok(init.body instanceof FormData); assert.equal(init.body.get('chat_id'), 'chat_' + 'b'.repeat(32)); return response({ chat_id: 'chat_' + 'b'.repeat(32), attachments: [{ attachment_id: 'att_1' }] }); }
  if (path === '/api/v1/audit') return responseError(403, 'denied');
  return responseError(500, 'server failure');
};

function response(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function responseError(status, detail) { return new Response(JSON.stringify({ detail }), { status, headers: { 'content-type': 'application/json' } }); }

for (const invalid of ['token\nsecond-line', 'token\rheader', 'token\u0000', 'token\u200b', '“token”', 'token extra']) {
  assert.throws(() => api.setSessionToken(invalid), error => error instanceof api.ApiError && error.status === 400 && /one line/.test(error.message));
  assert.equal(api.getSessionToken(), null);
}
api.setSessionToken(' Bearer token-123 ');
assert.equal(api.getSessionToken(), 'token-123');
assert.doesNotThrow(() => new Headers({ Authorization: `Bearer ${api.getSessionToken()}` }));
api.setSessionToken(null);
api.setSessionToken('  token-123  ');
assert.equal(storage.has('rca_auth_token'), false);
const principal = await api.fetchPrincipal();
assert.equal(principal.subject, 'operator@example.test');
assert.equal(calls.at(-1).init.headers.get('Authorization'), 'Bearer token-123');
assert.deepEqual(await api.fetchRuns(), []);
const [agent] = await api.fetchAgents();
assert.equal(agent.id, 'draft_1');
assert.equal(agent.status, 'pending');
assert.equal(agent.prompt, 'inspect');
assert.deepEqual(agent.tools, ['itsm.get_ticket']);
assert.equal((await api.approveAgent('draft_1', 'sha256:' + 'a'.repeat(64), 'reviewed')).status, 'active');
assert.equal((await api.revokeAgent('draft_1', 'retired')).status, 'deprecated');
for (const status of ['BLOCKED', 'PARTIAL', 'CANCELLED', 'SIMULATED', 'FAILED']) assert.equal((await api.fetchRun(`run_${status}`)).status, status);
await api.uploadInvestigationFiles([new File(['log'], 'incident.log')], 'chat_' + 'b'.repeat(32));
const triggered = await api.triggerRun('incident_triage', 'Inspect', 'INC-1', ['att_1'], 'chat_' + 'b'.repeat(32));
assert.equal(triggered.id, 'run_SUCCEEDED');
await assert.rejects(() => api.fetchRun('invalid'), error => error.status === 422 && error.message === 'body.prompt: String should have at least 1 character');
await assert.rejects(() => api.fetchRun('network'), error => error.status === 0 && error.message === 'offline');
await assert.rejects(() => api.fetchAuditLogs(), error => error.status === 403 && error.message === 'denied');
await assert.rejects(() => api.fetchSystemDiagnostics(), error => error.status === 500);

api.setSessionToken(null);
assert.equal(api.hasSessionToken(), false);
await api.fetchPrincipal();
assert.equal(calls.at(-1).init.headers.has('Authorization'), false);
console.log('frontend API contract checks passed');
