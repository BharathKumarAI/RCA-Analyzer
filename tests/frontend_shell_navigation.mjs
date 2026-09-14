import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sidebar = await readFile(new URL('../frontend/src/components/Sidebar.tsx', import.meta.url), 'utf8');
const palette = await readFile(new URL('../frontend/src/components/CommandPalette.tsx', import.meta.url), 'utf8');

// Keep the shell contract tied to persisted navigation settings: order is the
// server array order, while hidden entries must never render or become commands.
assert.match(sidebar, /settings\.navigation\.filter\(item => item\.visible\)/);
assert.match(sidebar, /settings\.navigation\.filter\(item => item\.visible && item\.group === group\)/);
assert.match(sidebar, /<span>\{item\.label\}<\/span>/);
assert.match(palette, /if \(!item\.visible \|\| !isActivePage\(item\.page\)\) return \[\]/);
assert.match(palette, /title: item\.label/);
assert.match(palette, /category: item\.group/);
console.log('shell navigation persistence checks passed');

const app = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
const topbar = await readFile(new URL('../frontend/src/components/Topbar.tsx', import.meta.url), 'utf8');
const connectorEditor = await readFile(new URL('../frontend/src/components/ConnectorInstanceEditor.tsx', import.meta.url), 'utf8');
// Admin navigation must not inherit a project merely because the session has one.
assert.match(app, /const scopedProjectKey = routeProjectKey;/);
assert.doesNotMatch(app, /setRouteProjectKey\(principal\.project_id\)/);
assert.match(app, /`\/admin\/\$\{window\.location\.search\}#\$\{page\}`/);
assert.match(app, /handleSelectPage\('runs'\)/);
assert.match(topbar, /projectKey \? `\/p\/\$\{projectKey\}` : 'Administration'/);
assert.doesNotMatch(connectorEditor, /payments-prod/);
console.log('admin and project navigation separation checks passed');
