import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

// 1. Verify Sidebar registrations
const sidebar = await readFile(new URL('../frontend/src/components/Sidebar.tsx', import.meta.url), 'utf8');
assert.match(sidebar, /'metrics'/, 'Sidebar ActivePage includes metrics');
assert.match(sidebar, /metrics:\s*BarChart2/, 'Sidebar PAGE_ICONS maps metrics to BarChart2');
assert.match(sidebar, /'metrics'/, 'Sidebar PROJECT_PAGE_KEYS includes metrics');

// 2. Verify Topbar navigation
const topbar = await readFile(new URL('../frontend/src/components/Topbar.tsx', import.meta.url), 'utf8');
assert.match(topbar, /'metrics'/, 'Topbar visibleNavItems includes metrics');

// 3. Verify App.tsx routing & page mounting
const app = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /const Metrics = lazy\(/, 'App.tsx lazy loads Metrics');
assert.match(app, /activePage === 'metrics' \|\| activePage === 'insights'/, 'App.tsx mounts Metrics for metrics and insights');

// 4. Verify telemetry services and types
const telemetryService = await readFile(new URL('../frontend/src/services/telemetry.ts', import.meta.url), 'utf8');
assert.match(telemetryService, /export function fetchProjectMetrics/, 'telemetry.ts exports fetchProjectMetrics');
assert.match(telemetryService, /export function fetchPlatformMetrics/, 'telemetry.ts exports fetchPlatformMetrics');
assert.match(telemetryService, /export interface SreMetrics/, 'telemetry.ts exports SreMetrics');
assert.match(telemetryService, /export interface PlatformMetrics/, 'telemetry.ts exports PlatformMetrics');

// 5. Verify Metrics page component structure
const metricsPage = await readFile(new URL('../frontend/src/pages/Metrics.tsx', import.meta.url), 'utf8');
assert.match(metricsPage, /MTTT \(Mean Triage\)/, 'Metrics page displays MTTT KPI card');
assert.match(metricsPage, /MTTR \(Resolution\)/, 'Metrics page displays MTTR KPI card');
assert.match(metricsPage, /SLA Compliance/, 'Metrics page displays SLA Compliance KPI card');
assert.match(metricsPage, /Auto-Triage Success/, 'Metrics page displays Auto-Triage Success KPI card');
assert.match(metricsPage, /Analyst Validation/, 'Metrics page displays Analyst Validation KPI card');
assert.match(metricsPage, /Estimated LLM Spend/, 'Metrics page displays Estimated LLM Spend KPI card');
assert.match(metricsPage, /Operational Trends/, 'Metrics page includes Operational Trends chart');
assert.match(metricsPage, /Cross-Project Comparison/, 'Metrics page includes Platform Cross-Project Comparison');

// 6. Test App.tsx route navigation logic in VM
const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = `const ${node.getText(parsed)};`;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found, `${name} remains available for route contract checks`);
  return found;
}

const state = { url: '', page: '', navigations: 0 };
const location = { pathname: '/p/team-a/metrics', search: '', hash: '' };
const context = {
  principal: { project_id: 'team-a' },
  routeProjectKey: 'team-a',
  Event,
  PopStateEvent: class extends Event {},
  isActivePage: value => ['overview', 'settings', 'chat', 'knowledge', 'insights', 'metrics', 'runs'].includes(value),
  setActivePage: page => { state.page = page; },
  window: {
    location,
    history: { pushState: (_state, _unused, url) => { state.url = url; } },
    dispatchEvent: event => {
      state.navigations++;
      return true;
    },
  },
};

const code = ['pageFromSegment', 'readLocationRoute', 'projectPath', 'handleSelectPage'].map(declaration).join('\n');
vm.createContext(context);
vm.runInContext(
  ts.transpileModule(
    `${code}\nglobalThis.navigate = handleSelectPage; globalThis.route = readLocationRoute;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText,
  context
);

// In project scope: navigating to metrics stays in project scope
context.navigate('metrics');
assert.equal(state.url, '/p/team-a/metrics', 'navigating to metrics in project scope goes to /p/team-a/metrics');

// In platform scope: navigating to metrics goes to /admins/metrics
context.routeProjectKey = null;
context.navigate('metrics');
assert.equal(state.url, '/admins/metrics', 'navigating to metrics without project scope goes to /admins/metrics');

console.log('✅ All frontend metrics verification checks passed successfully!');
