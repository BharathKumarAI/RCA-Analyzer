import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const triageComponent = await readFile(new URL('../frontend/src/pages/TriageBoard.tsx', import.meta.url), 'utf8');
const triageTypes = await readFile(new URL('../frontend/src/types/triage.ts', import.meta.url), 'utf8');
const triageService = await readFile(new URL('../frontend/src/services/triage.ts', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../frontend/src/components/Sidebar.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');

// 1. Verify TriageBoard component integrates key architectural elements
assert.match(triageComponent, /Live Triage Board/, 'renders Live Triage Board title');
assert.match(triageComponent, /Focus Queue/, 'renders Focus Queue panel');
assert.match(triageComponent, /urgency-strip/, 'renders Urgency Strip');
assert.match(triageComponent, /work-buckets-bar/, 'renders Work Buckets Bar');
assert.match(triageComponent, /Tool Pane/, 'renders Contextual Tool Pane');
assert.match(triageComponent, /Assignment Journey/, 'renders Assignment Journey timeline');
assert.match(triageComponent, /Governed Action Proposals/, 'renders Governed Action proposals');
assert.match(triageComponent, /Approve & Execute/, 'renders explicit human approval button');

// 2. Verify Triage Types
assert.match(triageTypes, /export interface TriageTicket/, 'exports TriageTicket interface');
assert.match(triageTypes, /export interface SlaState/, 'exports SlaState interface');
assert.match(triageTypes, /export interface ToolProposal/, 'exports ToolProposal interface');
assert.match(triageTypes, /export interface GovernedAction/, 'exports GovernedAction interface');

// 3. Verify Triage Services
assert.match(triageService, /\/api\/v1\/triage\/live-board/, 'calls live-board endpoint');
assert.match(triageService, /\/api\/v1\/triage\/tickets/, 'calls ticket workspace endpoint');
assert.match(triageService, /\/api\/v1\/triage\/tool-proposals/, 'calls tool proposals endpoint');
assert.match(triageService, /\/api\/v1\/triage\/actions/, 'calls actions approve endpoint');

// 4. Verify Sidebar & App.tsx routing
assert.match(sidebar, /'triage-board'/, 'Sidebar includes triage-board page');
assert.match(app, /const TriageBoard = lazy\(/, 'App.tsx lazy imports TriageBoard');
assert.match(app, /activePage === 'triage-board'/, 'App.tsx routes triage-board to TriageBoard component');

console.log('All PRISM Live Triage Board frontend integration checks passed!');
