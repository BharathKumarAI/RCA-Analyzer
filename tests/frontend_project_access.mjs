import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;
const apiUrl = moduleUrl(await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8'));
const api = await import(apiUrl);
const source = await fs.readFile(new URL('../frontend/src/services/projectAccess.ts', import.meta.url), 'utf8');
const access = await import(moduleUrl(source.replace("from './api'", `from '${apiUrl}'`)));
api.setSessionToken('test-only-token');
let latest;
globalThis.fetch = async (path, init) => { latest = { path, ...init }; return Response.json({}); };
await access.createProjectAccessRequest('target-project', 'PROJECT_ANALYST', 'Investigate customer incidents');
assert.deepEqual(JSON.parse(latest.body), { project_id: 'target-project', requested_role: 'PROJECT_ANALYST', reason: 'Investigate customer incidents' });
assert.equal(latest.headers.get('Authorization'), 'Bearer test-only-token');
const hash = 'sha256:' + '1'.repeat(64);
for (const action of ['approve', 'reject']) {
  await access.reviewProjectAccessRequest('request/id', action, hash, 'Reviewed scope and role');
  assert.equal(latest.path, `/api/v1/project-access-requests/request%2Fid/${action}`);
  assert.deepEqual(JSON.parse(latest.body), { expected_hash: hash, reason: 'Reviewed scope and role' });
}
globalThis.fetch = async () => Response.json({ detail: 'Request changed. Reload before reviewing.' }, { status: 409 });
await assert.rejects(access.reviewProjectAccessRequest('r', 'approve', hash, 'Ready'), error => error.status === 409 && /Reload/.test(error.message));
console.log('Project access requests preserve exact roles and expected-version review checks');
