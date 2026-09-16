import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/components/RunConnectorSelectors.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const capability = { id: 'incident_triage', is_authorized: true, required_connectors: ['jira'], optional_connectors: ['splunk'] };
const template = (overrides = {}) => ({ system_name: 'jira-enterprise', type: 'jira', provider_adapter_id: 'jira', version: '2.0.0', status: 'published', platform_enabled: true, is_enabled_by_policy: true, ...overrides });
const instance = (overrides = {}) => ({ instance_id: 'support', template_id: 'jira-enterprise', template_version: '2.0.0', status: 'enabled', enabled: true, definition_json: {}, bindings: [], ...overrides });
const binding = (id, status = 'active') => ({ project_env_id: id, status, external_resource: 'SUPPORT' });
const normal = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

let projectId = 'alpha', generation = 1, calls = [];
const api = {
  getProjectContext: () => projectId,
  getSessionGeneration: () => generation,
  fetchPrincipal: async () => ({ project_id: 'alpha' }),
  fetchCapabilities: async () => [capability, { ...capability, id: 'timeline' }],
  fetchProjectConnectors: async project => { calls.push(project); return [instance(), instance({ instance_id: 'support-secondary' })]; },
  fetchConnectorTemplates: async status => { assert.equal(status, 'published'); return [template()]; },
};
let slots = [], effects = [], stateIndex = 0, effectIndex = 0, pending = [];
const exports = {};
vm.runInNewContext(output, {
  exports, Error,
  require(name) {
    if (name === 'react') return {
      useId: () => 'sources',
      useState(initial) { const index = stateIndex++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
      useEffect(callback, dependencies) { const index = effectIndex++; if (!effects[index] || dependencies.some((value, at) => !Object.is(value, effects[index].dependencies[at]))) { pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); } },
    };
    if (name.includes('jsx-runtime')) return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.includes('services/api')) return api;
    throw new Error(`Unexpected import ${name}`);
  },
});
function render(id = capability.id) {
  stateIndex = 0; effectIndex = 0;
  const result = exports.useRunConnectorSelections(id);
  const commit = pending; pending = []; commit.forEach(effect => effect());
  return result;
}
function reset() { effects.forEach(effect => effect.cleanup?.()); slots = []; effects = []; pending = []; }
const groupsFor = (instances, templates = [template()], selectedCapability = capability) => exports.connectorChoices(selectedCapability, instances, templates);

let groups = groupsFor([instance()]);
assert.deepEqual(normal(groups[0].choices), [{ label: 'support', value: { instance_id: 'support' } }]);
assert.equal(exports.connectorSelectionsReady(groups, {}), true, 'A unique configured instance permits runtime automatic selection');
groups = groupsFor([instance(), instance({ instance_id: 'support-secondary' })]);
assert.equal(exports.connectorSelectionsReady(groups, {}), false);
assert.equal(exports.connectorSelectionsReady(groups, { jira: { instance_id: 'support' } }), true);
assert.equal(exports.connectorSelectionsReady(groups, { jira: { instance_id: 'foreign' } }), false);
assert.equal(exports.connectorSelectionsReady(groups, { oracle: { instance_id: 'db' } }), false);
assert.equal(exports.connectorSelectionsReady(groupsFor([instance(), instance({ instance_id: 'support-secondary' })], [template()], { ...capability, required_connectors: [], optional_connectors: ['jira'] }), {}), true);

for (const overrides of [{ enabled: false }, { status: 'draft' }, { status: 'archived' }, { template_version: '1.0.0' }]) assert.deepEqual(normal(groupsFor([instance(overrides)])), []);
for (const overrides of [{ status: 'deprecated' }, { status: undefined, availability: 'draft' }, { platform_enabled: false }, { is_enabled_by_policy: false }]) assert.deepEqual(normal(groupsFor([instance()], [template(overrides)])), []);
assert.deepEqual(normal(groupsFor([instance()], [template({ template_id: 'jira-enterprise', system_name: 'other', type: 'other' })])), [], 'Display template_id is not a runtime identity alias');
assert.equal(groupsFor([instance({ template_id: 'jira' })])[0].adapter, 'jira', 'Runtime accepts the template type as identity');
assert.equal(groupsFor([instance()], [template({ provider_adapter_id: undefined, type: 'unrelated-type' })], { ...capability, required_connectors: ['jira-enterprise'] })[0].adapter, 'jira-enterprise', 'Adapter fallback is the instance template ID');
groups = groupsFor([instance(), instance({ instance_id: 'old-version', template_id: 'jira', template_version: '1.0.0' })]);
assert.equal(groups[0].choices.length, 1);
assert.equal(exports.connectorSelectionsReady(groups, {}), false, 'A second enabled instance with an unavailable version still prevents automatic runtime selection');

groups = groupsFor([instance({ environment_dependency: 'dependent', bindings: [binding('prod'), binding('qa'), binding('retired', 'inactive')] })]);
assert.deepEqual(normal(groups[0].choices.map(choice => choice.value)), [{ instance_id: 'support', environment_id: 'prod' }, { instance_id: 'support', environment_id: 'qa' }]);
assert.equal(exports.connectorSelectionsReady(groups, {}), false);
assert.equal(exports.connectorSelectionsReady(groups, { jira: { environment_id: 'qa', instance_id: 'support' } }), true, 'Property ordering must not affect identity');
assert.equal(exports.connectorSelectionsReady(groups, { jira: { instance_id: 'support', environment_id: 'retired' } }), false);
assert.equal(exports.connectorSelectionsReady(groupsFor([instance({ bindings: [binding('prod'), binding('prod'), binding('qa')] })]), {}), false, 'Duplicate bindings cannot make the remaining single choice look automatic');
assert.deepEqual(normal(groupsFor([instance({ bindings: [binding('prod'), binding('prod')] })])), []);
assert.deepEqual(normal(groupsFor([instance({ bindings: [binding('retired', 'inactive')] })])), [], 'Inactive bindings must never fall back to an unbound instance');
assert.deepEqual(normal(groupsFor([instance({ environment_connections: [{ connection_id: 'prod' }] })])), [], 'Connections require an explicit persisted binding');
assert.deepEqual(normal(groupsFor([instance({ definition_json: { environment_dependency: 'dependent' } })])), []);

// Exercise asynchronous hook lifecycle, including scope changes before an older request settles.
let state = render(); assert.equal(state.loading, true); assert.equal(state.ready, false);
await tick(); state = render(); assert.equal(state.ready, false);
state.setSelections({ jira: { instance_id: 'support' } }); state = render(); assert.equal(state.ready, true);
state = render('timeline'); assert.deepEqual(normal(state.selections), {}); assert.equal(state.loading, true);
state = render(); await tick(); state = render();
assert.deepEqual(normal(state.selections), {}, 'Switching away and back must discard a previous capability selection');
state.setSelections({ jira: { instance_id: 'support' } }); state = render();
projectId = 'beta'; generation++;
state = render(); assert.deepEqual(normal(state.selections), {}); assert.deepEqual(normal(state.groups), []);
await tick(); state = render(); assert.equal(calls.at(-1), 'beta');
state.setSelections({ jira: { instance_id: 'support' } }); state = render();
generation++; state = render(); assert.deepEqual(normal(state.selections), {}, 'A new authenticated session must discard selections even in the same project');
await tick(); state = render();
state.setSelections({ jira: { instance_id: 'support' } }); state = render();
const normalFetch = api.fetchProjectConnectors;
api.fetchProjectConnectors = async () => [instance({ instance_id: 'support-secondary' })];
state.reload(); render(); await tick(); state = render();
assert.deepEqual(normal(state.selections), {}, 'Reload removes a selection whose saved instance is no longer available');
api.fetchProjectConnectors = normalFetch;
reset();
const previous = deferred();
api.fetchProjectConnectors = async project => project === 'beta' ? previous.promise : [instance({ instance_id: 'new-project' })];
render(); projectId = 'gamma'; generation++; render(); await tick();
previous.resolve([instance({ instance_id: 'old-project' })]); await tick(); state = render();
assert.equal(state.groups[0].choices[0].value.instance_id, 'new-project');
reset(); api.fetchProjectConnectors = normalFetch;
api.fetchConnectorTemplates = async () => { throw new Error('Source catalog unavailable'); };
render(); await tick(); state = render(); assert.equal(state.error, 'Source catalog unavailable'); assert.equal(state.ready, false);
api.fetchConnectorTemplates = async () => [template()]; state.reload(); render(); await tick(); state = render(); assert.equal(state.error, null);
reset();
api.fetchCapabilities = async () => [{ ...capability, is_authorized: false }];
await assert.rejects(() => exports.loadRunConnectorGroups(capability.id), /unavailable/);
api.fetchCapabilities = async () => [{ ...capability, runtime_supported: false }];
await assert.rejects(() => exports.loadRunConnectorGroups(capability.id), /unavailable/);
api.fetchCapabilities = async () => [capability];
projectId = null;
assert.ok((await exports.loadRunConnectorGroups(capability.id)).length);
assert.equal(calls.at(-1), 'alpha', 'Without an explicit selector, resolve the authenticated principal project');

// Typecheck real imports: both transports accept opaque IDs, never endpoint/credential overrides.
const typeFile = fileURLToPath(new URL('../frontend/src/connector-selection-contract.test.ts', import.meta.url));
const contract = `
import type { RunConnectorSelections } from './types/api';
import { triggerRun } from './services/api';
import { streamStudioRun } from './features/harness-studio/harnessApi';
const selections = { jira: { instance_id: 'support', environment_id: 'prod' }, splunk: { instance_id: 'logs' } } satisfies RunConnectorSelections;
void triggerRun('incident_triage', 'Inspect', undefined, [], undefined, selections);
void streamStudioRun('incident_triage', 'Inspect', () => {}, undefined, { connectorSelections: selections });
// @ts-expect-error Inline endpoints cannot be run selectors.
const endpoint: RunConnectorSelections = { jira: { instance_id: 'support', endpoint: 'https://external.test' } };
// @ts-expect-error A saved instance ID is required.
const missing: RunConnectorSelections = { jira: { environment_id: 'prod' } };
`;
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true };
const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile;
host.getSourceFile = (path, languageVersion, ...rest) => path === typeFile ? ts.createSourceFile(path, contract, languageVersion, true) : getSourceFile(path, languageVersion, ...rest);
const program = ts.createProgram([typeFile], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program).filter(item => item.file?.fileName === typeFile);
assert.deepEqual(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
console.log('Connector selector identity, bindings, ambiguity, stale scope, transport types, and recovery checks passed');
