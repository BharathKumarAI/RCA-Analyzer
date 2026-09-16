import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import React from '../frontend/node_modules/react/index.js';
import { renderToStaticMarkup } from '../frontend/node_modules/react-dom/server.node.js';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const source = await readFile(new URL('../frontend/src/components/AnswerMarkdown.tsx', import.meta.url), 'utf8');
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
for (const specifier of ['react/jsx-runtime', 'react-markdown', 'remark-gfm']) {
  const url = pathToFileURL(require.resolve(specifier)).href;
  output = output.replaceAll(`"${specifier}"`, `"${url}"`).replaceAll(`'${specifier}'`, `'${url}'`);
}
const { AnswerMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const html = renderToStaticMarkup(React.createElement(AnswerMarkdown, { text: [
  '<script>alert(1)</script><img src="https://bad.example/track" onerror="alert(1)">',
  '![External tracking image](https://bad.example/image)',
  '[Bad link](javascript:alert(1))',
  '[Source](https://example.com/evidence)',
  '| Service | Observed errors |\n| --- | --- |\n| Checkout | 12 |',
].join('\n\n') }));
assert.doesNotMatch(html, /<script|<img|onerror|javascript:/i);
assert.match(html, /<table>/, 'structured comparisons remain readable');
assert.match(html, /rel="noopener noreferrer"/, 'external links isolate the opener');
assert.match(html, /External tracking image/, 'image description remains available without remote fetch');
assert.match(html, /Checkout/);
console.log('Untrusted answers cannot execute HTML, load remote images, or create script links');
