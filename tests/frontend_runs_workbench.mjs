import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

// 1. Verify that api.ts exports fetchRunRaw and fetchRunTrace, and that mapRun preserves raw payload
const apiSource = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const apiOutput = ts.transpileModule(apiSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(apiOutput).toString('base64')}`);

assert.equal(typeof api.fetchRunTrace, 'function', 'fetchRunTrace must be exported');
assert.equal(typeof api.fetchRunRaw, 'function', 'fetchRunRaw must be exported');

let fetchedPath = '';
globalThis.fetch = async (path, init = {}) => {
  fetchedPath = path;
  if (path.includes('/runs?limit=50')) {
    return new Response(JSON.stringify([
      { run_id: 'run-1', status: 'SUCCEEDED', capability: 'incident_triage', created_at: 100, updated_at: 105, evidence_count: 4, reason: 'Root cause identified' },
      { run_id: 'run-2', status: 'RUNNING', capability: 'incident_triage', created_at: 110, updated_at: 115, evidence_count: 0 },
      { run_id: 'run-3', status: 'FAILED', capability: 'service_outage', created_at: 90, updated_at: 95, evidence_count: 1 },
      { run_id: 'run-4', status: 'PARTIAL', capability: 'incident_triage', created_at: 80, updated_at: 85, evidence_count: 2 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path.includes('/trace')) {
    return new Response(JSON.stringify({
      truncated: true,
      events: [
        { sequence: 1, kind: 'custom_orchestrator_start', timestamp: 100, details: { step: 'init' } },
        { sequence: 2, kind: null, timestamp: null, details: {} },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path.includes('/runs/run-1')) {
    return new Response(JSON.stringify({
      run_id: 'run-1',
      status: 'SUCCEEDED',
      contract_json: '{"model_config":"gemini-3.8-flash"}',
      evidence_count: 4,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
};

const loadedRuns = await api.fetchRuns();
assert.equal(loadedRuns.length, 4);
assert.equal(loadedRuns[0].status, 'COMPLETED');
assert.ok(loadedRuns[0].raw, 'raw payload must be preserved on mapped Run object');
assert.equal(loadedRuns[0].raw.run_id, 'run-1');

// Verify fetchRunRaw authentic response
const rawContract = await api.fetchRunRaw('run-1');
assert.equal(rawContract.run_id, 'run-1');
assert.equal(rawContract.contract_json, '{"model_config":"gemini-3.8-flash"}');

// Verify fetchRunTrace resilient contract
const trace = await api.fetchRunTrace('run-1');
assert.equal(trace.truncated, true, 'truncated trace flag must be recognized');
assert.equal(trace.events.length, 2);
assert.equal(trace.events[0].kind, 'custom_orchestrator_start');
assert.equal(trace.events[1].kind, null, 'null kinds must not throw');

// 2. Verify Runs page logic and resilience in Runs.tsx source
const runsSource = await fs.readFile(new URL('../frontend/src/pages/Runs.tsx', import.meta.url), 'utf8');

// Ensure Telemetry Terminal design and metric semantics
assert.match(runsSource, /Loaded Batch \(max 50\)/, 'Metric label must explicitly state Loaded Batch window');
assert.match(runsSource, /Batch Diagnostic Breakdown:/, 'Diagnostic breakdown must explicitly distinguish partial, failed, and cancelled');
assert.match(runsSource, /trace\?\.truncated/, 'Trace UI must handle truncated trace banner');
assert.match(runsSource, /MAX_TRACE_EVENTS_RENDER = 100/, 'Trace UI must cap large event timelines to prevent DOM bloat');
assert.match(runsSource, /fetchRunRaw/, 'Raw contract tab must support authentic server contract export');
assert.match(runsSource, /rca-run-\$\{run\.id\}-contract\.json/, 'Export filename must include run ID and contract designation');

console.log('frontend runs workbench tests passed');
