import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const page = await fs.readFile(new URL('../frontend/src/pages/Overview.tsx', import.meta.url), 'utf8');
const helper = page.slice(page.indexOf('export function overviewCapabilityState'), page.indexOf('export function Overview('));
const output = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { overviewCapabilityState } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const enabled = { enabled: true, project_enabled: true, is_authorized: true, runtime_supported: true };
const capabilities = [
  { ...enabled, id: 'file-review', required_connectors: [] },
  { ...enabled, id: 'ticket-review', required_connectors: ['jira'] },
  { ...enabled, id: 'logs', requires: { connectors: ['splunk'] } },
  { ...enabled, id: 'disabled', enabled: false },
  { ...enabled, id: 'project-disabled', project_enabled: false },
  { ...enabled, id: 'unauthorized', is_authorized: false },
  { ...enabled, id: 'unsupported', runtime_supported: false },
  { ...enabled, id: 'unknown-runtime', runtime_supported: undefined },
];
const state = overviewCapabilityState(capabilities, { connector_health: { jira: { overall: 'HEALTHY' }, splunk: { overall: 'DEGRADED' } } });
assert.deepEqual(state.enabled.map(item => item.id), ['file-review', 'ticket-review', 'logs']);
assert.deepEqual(state.available.map(item => item.id), ['file-review', 'ticket-review']);
assert.deepEqual(overviewCapabilityState(capabilities, undefined).available.map(item => item.id), ['file-review'], 'missing checks never certify a required connector');
assert.match(page, /No pending reviews in these queues/, 'empty queues do not imply all components are approved');
assert.doesNotMatch(page, /platformAgentsCount|Zero latency degradation|All systems nominal/, 'removed speculative operational claims');
console.log('Overview configuration checks exclude disabled, unverified and unhealthy paths');
