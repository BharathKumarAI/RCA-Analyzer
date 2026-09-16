import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
let latest;
globalThis.fetch = async (path, init = {}) => {
  latest = { path, ...init };
  return path.endsWith('/download') ? new Response('retained original', { status: 200 }) : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
api.setSessionToken('test-only-token');
const hash = 'sha256:' + 'a'.repeat(64);
for (const action of ['submit', 'approve', 'reject', 'revoke']) {
  await api.reviewKnowledgeDoc('document/with spaces', action, hash, 'Reviewed the document content');
  assert.equal(latest.path, `/api/v1/knowledge/document%2Fwith%20spaces/${action}`);
  assert.equal(latest.headers.get('Authorization'), 'Bearer test-only-token');
  assert.deepEqual(JSON.parse(latest.body), { expected_hash: hash, reason: 'Reviewed the document content' });
}
await api.uploadKnowledgeDoc(new File(['document content'], 'runbook.txt'), 'Runbook', 'Operations', { doc_id: 'doc_1', expected_hash: hash }, ['reviewed-source']);
assert.ok(latest.body instanceof FormData);
assert.equal(latest.headers.has('Content-Type'), false, 'browser sets multipart boundary');
assert.equal(latest.body.get('doc_id'), 'doc_1');
assert.equal(latest.body.get('expected_hash'), hash, 'replacement carries the version being edited');
assert.deepEqual(JSON.parse(latest.body.get('tags')), ['reviewed-source']);
assert.equal(await (await api.downloadKnowledgeDoc('doc_1')).text(), 'retained original');
assert.equal(latest.headers.get('Authorization'), 'Bearer test-only-token', 'original file download requires the session credential');
globalThis.fetch = async () => new Response('denied', { status: 403 });
await assert.rejects(api.downloadKnowledgeDoc('doc_1'), error => error.status === 403);
console.log('Knowledge upload, review and authenticated download contracts passed');
