import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sidebar = await readFile(new URL('../frontend/src/components/Sidebar.tsx', import.meta.url), 'utf8');
const topbar = await readFile(new URL('../frontend/src/components/Topbar.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const triageService = await readFile(new URL('../frontend/src/services/triage.ts', import.meta.url), 'utf8');
const ticketPanel = await readFile(new URL('../frontend/src/components/TicketDetailPanel.tsx', import.meta.url), 'utf8');
const rcaWorkbench = await readFile(new URL('../frontend/src/pages/RCAWorkbench.tsx', import.meta.url), 'utf8');
const projectTickets = await readFile(new URL('../frontend/src/pages/ProjectTickets.tsx', import.meta.url), 'utf8');
const projectFeedback = await readFile(new URL('../frontend/src/pages/ProjectFeedback.tsx', import.meta.url), 'utf8');

// 1. Verify Project-Scoped Navigation in Sidebar
assert.match(sidebar, /'triage-board'[\s\S]*?'tickets'[\s\S]*?'rca-workbench'[\s\S]*?'feedback'[\s\S]*?'docs'[\s\S]*?'artifacts'[\s\S]*?'orchestration'/, 'Sidebar ActivePage includes all project workspace pages');
assert.match(sidebar, /\['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights'/, 'Sidebar projectWorkspace navigation includes all project workspace pages');
assert.match(sidebar, /!\['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration'/, 'Sidebar admin console excludes project workspace pages');

// 2. Verify Topbar Project Scoping
assert.match(topbar, /projectKey[\s\S]*?\['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration'/, 'Topbar properly scopes project workspace pages when projectKey is present');

// 3. Verify App.tsx Lazy Imports & Routing
assert.match(app, /const ProjectTickets = lazy\(/, 'App.tsx lazy loads ProjectTickets');
assert.match(app, /const RCAWorkbench = lazy\(/, 'App.tsx lazy loads RCAWorkbench');
assert.match(app, /const ProjectFeedback = lazy\(/, 'App.tsx lazy loads ProjectFeedback');
assert.match(app, /const Docs = lazy\(/, 'App.tsx lazy loads Docs');
assert.match(app, /const Artifacts = lazy\(/, 'App.tsx lazy loads Artifacts');
assert.match(app, /const Orchestration = lazy\(/, 'App.tsx lazy loads Orchestration');

assert.match(app, /activePage === 'tickets' && \(\s*<ProjectTickets canEdit=\{canEditTriage\} \/>\s*\)/, 'App.tsx renders ProjectTickets for tickets');
assert.match(app, /activePage === 'rca-workbench' && \(\s*<RCAWorkbench canEdit=\{canEditTriage\}[\s\S]*?\/>\s*\)/, 'App.tsx renders RCAWorkbench for rca-workbench');
assert.match(app, /activePage === 'feedback' && \(\s*<ProjectFeedback \/>\s*\)/, 'App.tsx renders ProjectFeedback for feedback');
assert.match(app, /activePage === 'docs' && \(\s*<Docs \/>\s*\)/, 'App.tsx renders Docs for docs');
assert.match(app, /activePage === 'artifacts' && \(\s*<Artifacts \/>\s*\)/, 'App.tsx renders Artifacts for artifacts');
assert.match(app, /activePage === 'orchestration' && \(\s*<Orchestration \/>\s*\)/, 'App.tsx renders Orchestration for orchestration');

// 4. Verify Triage Services with Authentic Endpoints
assert.match(triageService, /export async function updateTicketStage/, 'Exports updateTicketStage');
assert.match(triageService, /export async function addTicketComment/, 'Exports addTicketComment');
assert.match(triageService, /export async function fetchTicketComments/, 'Exports fetchTicketComments');
assert.match(triageService, /export async function submitCalibrationFeedback/, 'Exports submitCalibrationFeedback');
assert.match(triageService, /export async function fetchCalibrationFeedback/, 'Exports fetchCalibrationFeedback');
assert.match(triageService, /export async function fetchTicketRca/, 'Exports fetchTicketRca');

// 5. Verify Ticket Detail Drawer Component
assert.match(ticketPanel, /Triage RCA/, 'TicketDetailPanel has Triage RCA tab');
assert.match(ticketPanel, /Interactive Tools/, 'TicketDetailPanel has Interactive Tools tab');
assert.match(ticketPanel, /Comments \(/, 'TicketDetailPanel has Comments Thread tab');
assert.match(ticketPanel, /Evidence \(/, 'TicketDetailPanel has Evidence tab');
assert.match(ticketPanel, /Activity Log/, 'TicketDetailPanel has Activity Log tab');

// 6. Verify RCA Workbench Multi-Methodology Engine
assert.match(rcaWorkbench, /5 Whys Causal Chain/, 'RCA Workbench supports 5 Whys');
assert.match(rcaWorkbench, /Ishikawa \/ Fishbone Diagram/, 'RCA Workbench supports Fishbone Diagram');
assert.match(rcaWorkbench, /Kepner-Tregoe IS \/ IS-NOT/, 'RCA Workbench supports Kepner-Tregoe');
assert.match(rcaWorkbench, /FMEA Risk Modes/, 'RCA Workbench supports FMEA');
assert.match(rcaWorkbench, /Boolean Fault Tree/, 'RCA Workbench supports Fault Tree');
assert.match(rcaWorkbench, /Auto-Ensemble Synthesis/, 'RCA Workbench supports Auto-Ensemble');

// 7. Verify ProjectTickets Desk
assert.match(projectTickets, /TicketDetailPanel/, 'ProjectTickets includes TicketDetailPanel slide-out drawer');

// 8. Verify SRE Feedback Loop
assert.match(projectFeedback, /submitCalibrationFeedback/, 'ProjectFeedback calls real submitCalibrationFeedback API');
assert.match(projectFeedback, /fetchCalibrationFeedback/, 'ProjectFeedback loads real calibration feedback history');

console.log('✅ All project workspace frontend tests passed successfully!');
