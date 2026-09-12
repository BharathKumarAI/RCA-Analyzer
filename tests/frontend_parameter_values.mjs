import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/utils/parameterValues.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const values = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(values.parseNumericValue(0, '17', false), 0);
assert.equal(values.parseNumericValue(0, '17', true), 0);
assert.equal(values.parseNumericValue(Number.NaN, '2.5', false), 2.5);
assert.throws(() => values.parseNumericValue(Number.NaN, '', false), /valid finite number/);
console.log('frontend parameter value checks passed');

assert.throws(() => values.parseNumericValue(2.5, '2.5', true), /valid integer/);
assert.throws(() => values.parseNumericValue(Number.NaN, '2oops', false), /valid finite/);
