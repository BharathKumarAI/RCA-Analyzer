import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/utils/projectSetupConfig.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { buildProjectConfiguration } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const existing = {
  tenant_id: 'old', project_id: 'old-project', allow_user_preferences: ['detail'], allow_user_overrides: [],
  capabilities: { incident_triage: { enabled: false, model_profile: 'old', allowed_roles: ['PROJECT_OWNER'], allowed_actions: ['itsm.get_ticket'] }, new_capability: { enabled: true, allowed_roles: ['PROJECT_ANALYST'] } },
  skills: { 'incident-triage': { enabled: true, instruction: 'old\nline', actions: ['itsm.get_ticket'] }, 'future-skill': { enabled: true, instruction: 'keep', actions: [] } },
  limits: { max_evidence_items: 77, max_evidence_chars: 9000 }, prompts: { triage: 'first\nsecond' }, environments: [{ id: 'prod' }],
};
const next = buildProjectConfiguration(existing, {
  tenantId: 'tenant', projectId: 'project', allowUserPreferences: [], allowUserOverrides: [], presentation: 'summary', detail: 'standard', disabledConnectors: [],
  capProfiles: { incident_triage: 'new-profile' }, maxLlmCalls: 12, maxToolCalls: 4, maxContextChars: 64000, runTimeoutSeconds: 120,
  workflow: { planning: true }, prompts: { triage: 'updated\nmultiline' }, skills: { 'incident-triage': { enabled: false, instruction: 'updated\ntext' } }, environments: [],
});
assert.equal(next.capabilities.incident_triage.model_profile, 'new-profile');
assert.deepEqual(next.capabilities.incident_triage.allowed_roles, ['PROJECT_OWNER']);
assert.ok(next.capabilities.new_capability);
assert.deepEqual(next.skills['incident-triage'].actions, ['itsm.get_ticket']);
assert.equal(next.skills['future-skill'].instruction, 'keep');
assert.equal(next.prompts.triage, 'updated\nmultiline');
assert.equal(next.limits.max_evidence_items, 77);
assert.deepEqual(next.allow_user_preferences, []);
assert.deepEqual(next.environments, []);
console.log('frontend project setup round-trip checks passed');

const firstSave = buildProjectConfiguration(null, {
  tenantId: 'tenant', projectId: 'project', allowUserPreferences: [], allowUserOverrides: [], presentation: 'summary', detail: 'standard', disabledConnectors: [],
  capProfiles: { new_capability: 'balanced-investigation' }, maxLlmCalls: 12, maxToolCalls: 4, maxContextChars: 64000, runTimeoutSeconds: 120,
  workflow: { planning: true }, prompts: {}, skills: { 'new-skill': { enabled: true, instruction: 'keep this instruction' } }, environments: [],
});
assert.equal(firstSave.capabilities.new_capability.model_profile, 'balanced-investigation');
assert.equal(firstSave.skills['new-skill'].instruction, 'keep this instruction');
console.log('frontend project setup first-save checks passed');

const emptyInstruction = buildProjectConfiguration(firstSave, {
  tenantId: 'tenant', projectId: 'project', allowUserPreferences: [], allowUserOverrides: [], presentation: 'summary', detail: 'standard', disabledConnectors: [],
  capProfiles: {}, maxLlmCalls: 12, maxToolCalls: 4, maxContextChars: 64000, runTimeoutSeconds: 120,
  workflow: {}, prompts: {}, skills: { 'new-skill': { enabled: false, instruction: '' } }, environments: [],
});
assert.equal(emptyInstruction.skills['new-skill'].instruction, null);
assert.equal(emptyInstruction.skills['new-skill'].enabled, false);
const pageSource = await fs.readFile(new URL('../frontend/src/pages/ProjectSetup.tsx', import.meta.url), 'utf8');
assert.match(pageSource, /fetchProjectSetup\(\)/);
assert.match(pageSource, /fetchProjectEditor\(\)/);
assert.match(pageSource, /saveProjectEditor\(/);
assert.match(pageSource, /const \{ connectors: _connectors, \.\.\.authoringDocument \}/);
assert.match(pageSource, /Reload Saved Configuration/);
assert.match(pageSource, /useState<ProjectEnvironment\[\]>\(\[\]\)/);

const restricted = buildProjectConfiguration({ ...existing, environments: [], harness: { agents: [], skills: [], tools: [] } }, {
  tenantId: 'tenant', projectId: 'project', allowUserPreferences: [], allowUserOverrides: [], presentation: 'summary', detail: 'standard', disabledConnectors: [],
  capProfiles: {}, maxLlmCalls: 12, maxToolCalls: 4, maxContextChars: 64000, runTimeoutSeconds: 120,
  workflow: {}, prompts: {}, skills: {}, environments: [{ id: 'not-delegated' }],
  delegatedSections: ['capabilities', 'disabled_connectors', 'limits', 'preferences', 'prompts', 'skills', 'workflow'],
});
assert.equal('environments' in restricted, false);
assert.equal('harness' in restricted, false);
assert.deepEqual(restricted.capabilities, existing.capabilities);
assert.equal(restricted.limits.max_evidence_items, 77);

console.log('frontend project setup delegation checks passed');
