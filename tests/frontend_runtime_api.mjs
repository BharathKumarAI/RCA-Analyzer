import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/pages/Runtime.tsx', import.meta.url), 'utf8');

assert.match(source, /expected_hash:\s*current\.content_hash/);
assert.match(source, /thinkingMode === 'level'/);
assert.match(source, /thinkingMode === 'budget'/);
assert.doesNotMatch(source, /tool_limit:\s*editToolLimit/);
assert.doesNotMatch(source, /instruction:\s*editInstruction/);
console.log('runtime stage API payload checks passed');
