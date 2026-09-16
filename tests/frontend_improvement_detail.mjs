import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/pages/Improvement.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('Improvement.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'choose') handler = node.initializer.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(handler);
const code = ts.transpileModule(`globalThis.choose = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(fetchDetail) {
  const state = { Error, active: { current: false }, alive: { current: true }, candidateVersion: { current: 0 }, generation: 1, fetchImprovementCandidate: fetchDetail };
  state.getSessionGeneration = () => state.generation;
  for (const key of ['candidateId', 'selected', 'candidateError', 'candidateLoading', 'outcome', 'facts', 'reason', 'knowledgeTitle']) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  vm.createContext(state); vm.runInContext(code, state);
  return state;
}
const detail = id => ({ candidate_id: id, payload: { evidence: [{ source: id }] }, verification: null });

test('candidate detail race keeps only the latest selected evidence', async () => {
  const pending = new Map();
  const state = harness(id => new Promise(resolve => pending.set(id, resolve)));
  const first = state.choose('first');
  const second = state.choose('second');
  assert.equal(state.selected, null); assert.equal(state.candidateLoading, true);
  pending.get('second')(detail('second')); await second;
  pending.get('first')(detail('first')); await first;
  assert.equal(state.selected.candidate_id, 'second');
  assert.equal(state.candidateLoading, false);
});

test('candidate loading respects action locks, project changes and close', async () => {
  let resolve, requests = 0;
  const state = harness(() => { requests++; return new Promise(done => { resolve = done; }); });
  state.active.current = true; await state.choose('locked'); assert.equal(requests, 0);
  state.active.current = false;
  const pending = state.choose('old-project');
  state.generation++; resolve(detail('old-project')); await pending;
  assert.equal(state.selected, null);
  const closing = state.choose('closing');
  await state.choose(''); resolve(detail('closing')); await closing;
  assert.equal(state.candidateId, ''); assert.equal(state.selected, null); assert.equal(state.candidateLoading, false);
});

test('candidate failure leaves an explicit retry and loads verified facts only from detail', async () => {
  let fail = true;
  const state = harness(async () => {
    if (fail) throw new Error('Evidence unavailable');
    return { ...detail('reviewed'), verification: { expected_outcome: 'FINDINGS', expected_facts: ['Verified observation'] } };
  });
  await state.choose('reviewed');
  assert.equal(state.candidateError, 'Evidence unavailable'); assert.equal(state.candidateLoading, false); assert.equal(state.selected, null);
  fail = false; await state.choose('reviewed');
  assert.equal(state.candidateError, ''); assert.equal(state.facts, 'Verified observation'); assert.equal(state.outcome, 'FINDINGS');
});
