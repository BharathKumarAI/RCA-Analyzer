import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

let calls = [];
globalThis.fetch = async (path, init = {}) => {
  calls.push({ path, init });
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (path === '/api/v1/me') return response({ subject: 'operator@example.test', roles: ['OPERATOR'], tenant_id: 't1', project_id: 'p1' });
  if (path.startsWith('/api/v1/runs?')) return response([]);
  if (path === '/api/v1/agent-configurations') return response([{ draft_id: 'draft_1', author_subject: 'operator@example.test', content_hash: 'sha256:' + 'a'.repeat(64), status: 'PENDING', created_at: 10, definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: 'test', instruction: 'inspect', capability: 'incident_triage', model_profile: 'balanced-investigation', tools: ['itsm.get_ticket'] } }]);
  if (path.endsWith('/approve')) { assert.deepEqual(body, { expected_hash: 'sha256:' + 'a'.repeat(64), reason: 'reviewed' }); return response({ draft_id: 'draft_1', status: 'APPROVED', content_hash: 'sha256:' + 'a'.repeat(64), created_at: 10, author_subject: 'operator@example.test', definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: '', instruction: '', capability: 'incident_triage' } }); }
  if (path.endsWith('/revoke')) { assert.deepEqual(body, { reason: 'retired' }); return response({ draft_id: 'draft_1', status: 'REVOKED', content_hash: 'sha256:' + 'a'.repeat(64), created_at: 10, author_subject: 'operator@example.test', definition: { id: 'agent_one', version: '1.0.0', name: 'Agent One', description: '', instruction: '', capability: 'incident_triage' } }); }
  if (path === '/api/v1/runs/run_1') return response({ run_id: 'run_1', capability: 'incident_triage', status: 'BLOCKED', created_at: 10, updated_at: 12, stage: 'triage', evidence_count: 2, reason: 'policy' });
  if (path === '/api/v1/audit') return responseError(403, 'denied');
  return responseError(500, 'server failure');
};

function response(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function responseError(status, detail) { return new Response(JSON.stringify({ detail }), { status, headers: { 'content-type': 'application/json' } }); }

api.setSessionToken('token-123');
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
assert.equal((await api.fetchRun('run_1')).status, 'BLOCKED');
await assert.rejects(() => api.fetchAuditLogs(), error => error.status === 403 && error.message === 'denied');
await assert.rejects(() => api.fetchSystemDiagnostics(), error => error.status === 500);

console.log('frontend API contract checks passed');
