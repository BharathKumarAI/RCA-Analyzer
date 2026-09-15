import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/services/api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const controller = new AbortController();
try {
  AbortSignal.timeout = milliseconds => {
    assert.equal(milliseconds, 15_000);
    return controller.signal;
  };
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/v1/me');
    assert.equal(options.signal, controller.signal);
    controller.abort(new DOMException('The operation timed out', 'TimeoutError'));
    throw controller.signal.reason;
  };
  await assert.rejects(api.fetchPrincipal(), error => {
    assert.equal(error.status, 0);
    assert.match(error.message, /server did not respond/i);
    return true;
  });
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
}
