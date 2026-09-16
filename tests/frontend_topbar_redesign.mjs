import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const topbarSource = await readFile(new URL('../frontend/src/components/Topbar.tsx', import.meta.url), 'utf8');

// 1. Honest copy checks
assert.match(topbarSource, /aria-label="Search workspace pages \(⌘K\)"/, 'The accessible search name identifies workspace page search');
assert.match(topbarSource, />Search pages<\/span>/, 'The compact visible search label stays honest about its scope');
assert.match(topbarSource, /⌘K/, 'Search trigger includes keyboard shortcut badge');
assert.doesNotMatch(topbarSource, /SRE Engine/, 'Topbar must not invent unsupported branding tags');
assert.match(topbarSource, /Mode: Live/, 'Execution mode must be clearly identified');
assert.match(topbarSource, /Mode: Demo/, 'Demo execution mode must be clearly identified');
assert.match(topbarSource, /API response time refreshed/, 'API response time freshness must be explicitly labeled');

const appSource = await readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /projectSelector=\{navigationProjectKey \? \(/, 'Project switcher follows the project navigation context, including the reader-accessible handbook');

// 2. Security and session checks
assert.doesNotMatch(topbarSource, /jwt|raw_token|token_value/i, 'Session menu must never expose raw JWT or token strings');
assert.match(topbarSource, /onOpenSession/, 'Session details reuses existing session dialog');
assert.match(topbarSource, /onSignOut/, 'Sign out action reuses existing session sign-out');

// 3. Navigation guard checks
assert.match(topbarSource, /onNavigate\(projectKey \? 'chat' : 'overview'\)/, 'Brand link opens the project conversation or administration through its route guard');
assert.match(topbarSource, /const visibleNavItems = settings\.navigation\.filter\(item =>\s*item\.visible &&/, 'Module navigation respects server-backed visibility');
assert.match(topbarSource, /if \(onNavigate && isActivePage\(item\.page\)\) onNavigate\(item\.page\)/, 'Module selection uses route navigation only for recognized pages');
assert.match(topbarSource, /onNavigate\('health-checks'\)/, 'Health checks link uses route navigation guard');

// 4. Keyboard accessibility & popover dismiss
assert.match(topbarSource, /event\.key === 'Escape'/, 'Escape key handler must close open popovers');
assert.match(topbarSource, /role="dialog"/, 'Popovers must be accessible dialog containers');

// 5. Test pure helper functions (Role priority and relative freshness)
const transpiled = ts.transpileModule(topbarSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;

const context = {
  console,
  Date,
  Math,
  exports: {},
  require: () => ({ jsx: () => {}, jsxs: () => {}, Fragment: () => {} }),
  window: { addEventListener: () => {}, removeEventListener: () => {} },
  document: { addEventListener: () => {}, removeEventListener: () => {} }
};
vm.createContext(context);

// Extract and test ROLE_PRIORITY_ORDER and getPrimaryRole
vm.runInContext(`
  ${transpiled}
  globalThis.getPrimaryRole = getPrimaryRole;
  globalThis.formatRelativeFreshness = formatRelativeFreshness;
`, context);

// Test deterministic role priority
assert.equal(context.getPrimaryRole(['GENERIC_USER', 'PLATFORM_ADMIN']), 'Admin', 'PLATFORM_ADMIN has highest priority');
assert.equal(context.getPrimaryRole(['PROJECT_VIEWER', 'PROJECT_OWNER']), 'Owner', 'PROJECT_OWNER outranks PROJECT_VIEWER');
assert.equal(context.getPrimaryRole(['PROJECT_ANALYST', 'PROJECT_MANAGER']), 'Manager', 'PROJECT_MANAGER outranks PROJECT_ANALYST');
assert.equal(context.getPrimaryRole(['PROJECT_ANALYST']), 'Analyst', 'Single role resolved correctly');
assert.equal(context.getPrimaryRole(['PROJECT_VIEWER']), 'Viewer', 'PROJECT_VIEWER resolved correctly');
assert.equal(context.getPrimaryRole(['GENERIC_USER']), 'User', 'GENERIC_USER resolved correctly');
assert.equal(context.getPrimaryRole([]), 'Member', 'Empty role fallback');

// Test relative freshness formatter
assert.equal(context.formatRelativeFreshness(null), 'Unavailable', 'Null freshness displays Unavailable');
assert.equal(context.formatRelativeFreshness(undefined), 'Unavailable', 'Undefined freshness displays Unavailable');
assert.equal(context.formatRelativeFreshness(new Date(Date.now() - 1000)), 'just now', 'Recent updates show just now');
assert.equal(context.formatRelativeFreshness(new Date(Date.now() - 25000)), '25s ago', 'Seconds ago formatted');
assert.equal(context.formatRelativeFreshness(new Date(Date.now() - 180000)), '3m ago', 'Minutes ago formatted');

console.log('Topbar redesign contracts, honesty checks, and helper logic passed');
