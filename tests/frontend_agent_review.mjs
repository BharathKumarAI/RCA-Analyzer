import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const page = await fs.readFile(new URL('../frontend/src/pages/Agents.tsx', import.meta.url), 'utf8');
const expression = page.match(/const canReview = (.*);/)[1];
const compiled = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const eligible = (isAdmin, subject, reason = 'Reviewed', submitting = false) => new Function('isAdmin', 'principal', 'reviewReason', 'submitting', compiled)(isAdmin, { subject }, reason, submitting);
const agent = { author: 'author', status: 'pending', content_hash: 'sha256:known' };
assert.equal(eligible(true, 'author')(agent), false, 'authors cannot review their own agent');
assert.equal(eligible(false, 'peer')(agent), false, 'review requires an administrator');
assert.equal(eligible(true, 'peer', '   ')(agent), false, 'review requires a nonblank reason');
assert.equal(eligible(true, 'peer', 'Reviewed', true)(agent), false, 'busy state prevents duplicate review');
assert.equal(eligible(true, 'peer')(agent), true, 'a peer administrator with a reason may review a pending agent');
assert.equal(eligible(true, 'peer')({ ...agent, content_hash: null }), false, 'review requires a loaded content hash');
assert.equal(eligible(true, 'peer')({ ...agent, status: 'active' }), false, 'only pending agents are reviewable');
console.log('Agent reviewer eligibility checks passed');
