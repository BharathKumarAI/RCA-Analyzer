import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const page = await fs.readFile(new URL('../frontend/src/pages/Skills.tsx', import.meta.url), 'utf8');
const source = page.slice(page.indexOf('function availableSkillActions'), page.indexOf('export const Skills:')) + '\nexport { availableSkillActions };';
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { availableSkillActions } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const capabilities = [
  { id: 'incident-triage', enabled: true, is_authorized: true, project_enabled: true, permissions: { allowed_actions: ['itsm.get_ticket', 'files.read', 'itsm.get_ticket'] } },
  { id: 'log-correlation', enabled: true, is_authorized: true, project_enabled: true, permissions: { allowed_actions: ['logs.search', 'files.read'] } },
];
assert.deepEqual(availableSkillActions(capabilities, []), [], 'no investigation means no granted actions');
assert.deepEqual(availableSkillActions(capabilities, ['incident-triage']), ['files.read', 'itsm.get_ticket'], 'available actions are deduplicated');
assert.deepEqual(availableSkillActions(capabilities, ['incident-triage', 'log-correlation']), ['files.read'], 'only common actions can be attached to multiple investigations');
assert.deepEqual(availableSkillActions(capabilities, ['incident-triage', 'unknown']), [], 'a missing capability fails closed');
for (const field of ['enabled', 'is_authorized', 'project_enabled']) {
  const unavailable = capabilities.map(cap => ({ ...cap, [field]: false }));
  assert.deepEqual(availableSkillActions(unavailable, ['incident-triage']), [], `${field} prevents granting actions`);
}
assert.deepEqual(availableSkillActions([{ ...capabilities[0], permissions: undefined }], ['incident-triage']), [], 'missing grants do not invent tools');
console.log('Skill action eligibility checks passed');
