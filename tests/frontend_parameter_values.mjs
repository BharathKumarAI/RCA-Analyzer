import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await fs.readFile(new URL('../frontend/src/utils/parameterValues.ts', import.meta.url), 'utf8');
const withoutImport = source.replace(
  /import \{[^}]*KNOWN_PARAMETER_CATEGORIES[^}]*\} from ['"]\.\.\/types\/api['"];?/,
  `const KNOWN_PARAMETER_CATEGORIES = {
  connectivity: ['authentication', 'endpoint', 'protocol', 'rate_limit', 'retry', 'service_account', 'timeouts'],
  identity: ['service_account', 'authentication'],
  performance: ['rate_limit', 'retry', 'timeouts'],
  query: ['index_selection', 'pagination'],
  schedules: ['environment', 'schedule', 'window', 'polling_frequency', 'max_window_seconds'],
  security: ['auth', 'oauth', 'secret'],
  runtime: ['operation', 'deployment'],
  operational: ['general'],
};`
);
const output = ts.transpileModule(withoutImport, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const values = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.equal(values.parseNumericValue(0, '17', false), 0);
assert.equal(values.parseNumericValue(0, '17', true), 0);
assert.equal(values.parseNumericValue(Number.NaN, '2.5', false), 2.5);
assert.throws(() => values.parseNumericValue(Number.NaN, '', false), /valid finite number/);

assert.throws(() => values.parseNumericValue(2.5, '2.5', true), /valid integer/);
assert.throws(() => values.parseNumericValue(Number.NaN, '2oops', false), /valid finite/);

// Typed parse & valuesMatch checks
assert.equal(values.parseTypedValue('123', 'integer'), 123);
assert.equal(typeof values.parseTypedValue('123', 'integer'), 'number');
assert.throws(() => values.parseTypedValue('12.5', 'integer'), /not a valid integer/);
assert.equal(values.parseTypedValue('true', 'boolean'), true);
assert.equal(values.parseTypedValue('false', 'boolean'), false);
assert.throws(() => values.parseTypedValue('maybe', 'boolean'), /boolean/);
assert.deepEqual(values.parseTypedValue('{"a": 1}', 'json'), { a: 1 });
assert.equal(values.parseTypedValue('env://MY_TOKEN', 'secret_ref'), 'env://MY_TOKEN');

assert.equal(values.valuesMatch(123, 123), true);
assert.equal(values.valuesMatch(123, '123'), false);
assert.equal(values.valuesMatch({ a: 1 }, { a: 1 }), true);
assert.equal(values.valuesMatch({ a: 1 }, { a: 2 }), false);

// Taxonomy and allowed values validation checks
assert.equal(values.isScalar('abc'), true);
assert.equal(values.isScalar(42), true);
assert.equal(values.isScalar(true), true);
assert.equal(values.isScalar({ a: 1 }), false);
assert.equal(values.isScalar(null), false);

assert.equal(values.areAllowedValuesScalar(['fast', 'slow', 'medium']), true);
assert.equal(values.areAllowedValuesScalar([10, 20, 30]), true);
assert.equal(values.areAllowedValuesScalar(['fast', { complex: true }]), false);
assert.equal(values.areAllowedValuesScalar([]), false);
assert.equal(values.areAllowedValuesScalar(null), false);

assert.equal(values.validateAllowedValue('fast', ['fast', 'slow']), true);
assert.equal(values.validateAllowedValue('turbo', ['fast', 'slow']), false);
assert.equal(values.validateAllowedValue(10, [10, 20]), true);
assert.equal(values.validateAllowedValue('10', [10, 20]), false);
assert.equal(values.validateAllowedValue('anything', null), true);

assert.equal(values.validateTaxonomy('connectivity', 'endpoint'), true);
assert.equal(values.validateTaxonomy('connectivity', 'timeouts'), true);
assert.equal(values.validateTaxonomy('connectivity', 'invalid_subcat'), true);
assert.equal(values.validateTaxonomy('unknown_cat', 'endpoint'), false);
assert.equal(values.validateTaxonomy('operational', 'custom_facet'), true);

console.log('frontend parameter value checks passed');
