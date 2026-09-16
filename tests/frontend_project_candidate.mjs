import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const read = path => fs.readFile(new URL(`../frontend/src/${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;
const apiUrl = moduleUrl(await read('services/api.ts')); const api = await import(apiUrl);
const service = await import(moduleUrl((await read('services/projectCandidate.ts')).replace("from './api'", `from '${apiUrl}'`)));
api.setSessionToken('test-only-token'); api.setProjectContext('scope-a');
let request; globalThis.fetch = async (path, init) => { request = { path, ...init }; return Response.json({ run: { run_id: 'candidate-1' }, receipt: { passed: true } }); };
const input = { yaml: 'environments: []', expected_project_revision: 'revision-1', expected_editor_version: 4, run: { capability: 'attachment_review', prompt: 'Inspect actual evidence', connector_selections: {}, knowledge_document_ids: [] } };
await service.testProjectCandidate(input, 'stable-key');
assert.equal(request.path, '/api/v1/project/test'); assert.equal(request.headers.get('Idempotency-Key'), 'stable-key'); assert.equal(request.headers.get('X-RCA-Project'), 'scope-a'); assert.deepEqual(JSON.parse(request.body), input);
await api.saveProjectSetup(input.yaml, 'revision-1', 4, 'candidate-1');
assert.deepEqual(JSON.parse(request.body), { yaml: input.yaml, expected_project_revision: 'revision-1', expected_editor_version: 4, candidate_run_id: 'candidate-1' });
const source = await read('components/ProjectCandidateTest.tsx'); const ast = ts.createSourceFile('ProjectCandidateTest.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let code; function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'run') code = `const ${node.getText(ast)};globalThis.execute=run;`; ts.forEachChild(node, visit); } visit(ast); assert.ok(code);
let requests = [], uploads = 0, receipt = null, error = null;
const context = { running: { current: false }, pending: { current: null }, version: { current: 1 }, callback: { current: value => { receipt = value; } },
  canEdit: true, validated: true, source: { ready: true, selections: { itsm: { instance_id: 'saved-instance', environment_id: 'prod' } } }, capability: 'attachment_review', prompt: 'Inspect supplied evidence', incident: '', mode: 'live', yaml: 'saved candidate', projectRevision: 'revision-1', editorVersion: 4, knowledge: { environmentId: 'prod', documentIds: ['reviewed-document'] }, files: [{}], snapshot: 'snapshot-1',
  ApiError: api.ApiError, Error, crypto: { randomUUID: () => `attempt-${requests.length}` }, setBusy: () => {}, onBusy: () => {}, setError: value => { error = value; }, setResult: () => {},
  uploadInvestigationFiles: async () => { uploads++; return { chat_id: 'owned-chat', attachments: [{ attachment_id: 'owned-file' }] }; },
  testProjectCandidate: async (value, key) => { requests.push({ value, key }); if (requests.length === 1) throw new api.ApiError(0, 'Network lost'); return { run: { run_id: 'candidate-1', status: 'SUCCEEDED' }, receipt: { passed: true } }; },
};
vm.runInNewContext(compile(code), context);
await context.execute(); assert.equal(error.retryable, true); assert.equal(uploads, 1);
await context.execute(true); assert.equal(uploads, 1, 'Uncertain retries reuse already uploaded evidence'); assert.equal(requests[0].key, requests[1].key); assert.equal(requests[0].value, requests[1].value); assert.equal(receipt.receipt.passed, true);
assert.equal(requests[1].value.run.attachment_ids[0], 'owned-file'); assert.equal(requests[1].value.run.connector_selections.itsm.instance_id, 'saved-instance'); assert.equal(requests[1].value.run.knowledge_document_ids[0], 'reviewed-document');
context.mode = 'demo'; await context.execute(); assert.equal(requests.length, 2);
context.mode = 'live'; context.canEdit = false; await context.execute(); assert.equal(requests.length, 2);
context.canEdit = true; context.testProjectCandidate = async () => { context.version.current++; return { run: {}, receipt: { passed: true } }; }; receipt = null;
await context.execute(); assert.equal(receipt, null, 'A result from an older candidate cannot authorize apply');
const setup = await read('pages/ProjectSetup.tsx');
assert.match(setup, /candidateResult\.snapshot === candidateSnapshot/);
assert.match(setup, /saveProjectSetup\(backendSaveYaml, payload\?\.project_revision, editorVersion, candidateRunId\)/);
console.log('Candidate investigation uses real request inputs, exact receipt apply, stable retries and stale-result protection');
