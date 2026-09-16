import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/pages/Chat.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('Chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['stageLabels', 'readable'].includes(node.name.getText(parsed))) declarations.push(`const ${node.getText(parsed)};`);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'splitSourceFields') declarations.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const context = {};
vm.createContext(context);
vm.runInContext(ts.transpileModule(`${declarations.join('\n')}\nglobalThis.label = readable; globalThis.split = splitSourceFields;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (const [raw, expected] of Object.entries({ request_orchestrator: 'Understanding your question', 'agent:request_orchestrator': 'Understanding your question', 'agent:rca_synthesizer': 'Preparing the answer', context: 'Relevant project context', 'model:provider/model-version': 'Model response', 'workflow:context': 'Relevant project context', 'tool:get_ticket': 'Read a ticket' })) assert.equal(context.label(raw), expected);
assert.equal(context.label('unrecognized_stage'), 'unrecognized stage', 'Unknown stages remain readable without claiming a known step');

// Even a short source must not promote storage metadata into the visible evidence.
const sourceEntries = [['content_hash', 'sha256:123'], ['doc_id', 'kb-1'], ['excerpt_start', 0], ['ReviewedAt', 123456789], ['Title', 'Checkout runbook'], ['Excerpt', 'Retry after checking the pool'], ['status', 'approved'], ['key', 'INC-21']];
const sections = context.split(sourceEntries);
assert.deepEqual(Array.from(sections.primary, ([key]) => key), ['Title', 'key', 'status', 'Excerpt']);
assert.deepEqual(Array.from(sections.details, ([key]) => key), ['content_hash', 'doc_id', 'excerpt_start', 'ReviewedAt']);
assert.equal(sourceEntries[0][0], 'content_hash', 'Presentation must not mutate persisted evidence order');
const short = context.split([['Title', 'Runbook'], ['ContentHash', 'hash'], ['DocId', 'id']]);
assert.equal(short.primary.length, 1);
assert.equal(short.details.length, 2);
const content = context.split([['body', 'Original text'], ['service', 'checkout'], ['host', 'node-1']]);
assert.equal(content.primary.length, 3, 'Relevant unrecognized source fields remain visible');
assert.equal(context.split([]).primary.length, 0);
console.log('Chat prioritizes readable source content and labels internal activity steps plainly');
