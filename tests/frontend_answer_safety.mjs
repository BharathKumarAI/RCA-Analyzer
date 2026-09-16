import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import React from '../frontend/node_modules/react/index.js';
import { renderToStaticMarkup } from '../frontend/node_modules/react-dom/server.node.js';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
async function componentUrl(name) {
  const source = await readFile(new URL(`../frontend/src/components/${name}.tsx`, import.meta.url), 'utf8');
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import ['"].*\.css['"];$/gm, '');
  for (const specifier of ['react', 'react/jsx-runtime', 'react-markdown', 'remark-gfm', 'mermaid']) {
    const url = pathToFileURL(require.resolve(specifier)).href;
    for (const quote of ['"', "'"]) output = output.replaceAll(`from ${quote}${specifier}${quote}`, `from ${quote}${url}${quote}`).replaceAll(`import(${quote}${specifier}${quote})`, `import(${quote}${url}${quote})`);
  }
  for (const match of [...output.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) output = output.replace(match[0], `from '${await componentUrl(match[1])}'`);
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}
const { AnswerMarkdown } = await import(await componentUrl('AnswerMarkdown'));
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
const handbook = renderToStaticMarkup(React.createElement(AnswerMarkdown, { onDocumentLink() {}, text: [
  '# Safe heading', '# Safe heading', '<a id="retained-anchor"></a>',
  '[Local section](#safe-heading)', '[Other guide](knowledge.md#review)',
  '<a id="bad" onclick="alert(1)"></a>', '<script>bad()</script>',
].join('\n\n') }));
assert.match(handbook, /id="guide-safe-heading"/);
assert.match(handbook, /id="guide-safe-heading-1"/);
assert.match(handbook, /id="guide-retained-anchor"/);
assert.match(handbook, /<button[^>]*>Local section<\/button>/);
assert.doesNotMatch(handbook, /<script|onclick|id="bad"/);
const blocks = renderToStaticMarkup(React.createElement(AnswerMarkdown, { text: '```json\n{"message":"<script>inert</script>"}\n```\n\n```mermaid\nflowchart LR\n A[Source] --> B[Evidence]\n```' }));
assert.match(blocks, /json block/);
assert.match(blocks, /Copy code/);
assert.match(blocks, /mermaid block/);
assert.match(blocks, /Diagram source/);
assert.doesNotMatch(blocks, /<script/);
const { diagramSource } = await import(await componentUrl('MermaidBlock'));
assert.equal(diagramSource('flowchart LR\n A --> B\n click A "project.md"'), 'flowchart LR\n A --> B\n');
for (const unsafe of ['---\nconfig: {}', '%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B', 'flowchart LR\nA@{img:"https://example.test/x"}', 'flowchart LR\nA["![tracker](x)"]', 'flowchart LR\nA["<img src=x>"]', 'flowchart LR\nclassDef x fill:u\\72l(x)', 'a'.repeat(24_001), 'a\n'.repeat(401)]) assert.throws(() => diagramSource(unsafe));
for (const unsafe of ['flowchart LR\nA@{ "img": "//example.test/pixel" }', 'flowchart LR\nA@{ "im\\u0067": "/local-source" }']) assert.throws(() => diagramSource(unsafe));
for (const separator of [';', ' & ']) assert.throws(() => diagramSource('flowchart LR\n' + Array.from({ length: 1000 }, (_, index) => `node${index}`).join(separator)));
for (const unsafe of ['sequenceDiagram\nparticipant A\nproperties A: {"icon":"//example.test/pixel"}', 'sequenceDiagram\nparticipant A\ndetails A: #private', 'C4Context\nUpdateElementStyle(a, $bgColor="custom")']) assert.throws(() => diagramSource(unsafe));
console.log('Untrusted answers cannot execute HTML, load remote images, or create script links');
