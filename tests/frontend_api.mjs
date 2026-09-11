// Run with: node tests/frontend_api.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../web/js/api.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response('<html>Not found</html>', {status: 404, statusText: 'Not Found'});
  await assert.rejects(api.getReady(), error => error instanceof api.ApiError && error.status === 404 && error.message === 'Not Found');
  globalThis.fetch = async () => new Response(JSON.stringify({detail: 'Access denied'}), {status: 403});
  await assert.rejects(api.getMe(), error => error.status === 403 && error.message === 'Access denied');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Frontend API error handling passed.');
