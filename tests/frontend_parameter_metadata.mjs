import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../frontend/src/pages/ParameterStudio.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(source, /TOOL_REGISTRY/, 'Provider content must not be defined in the frontend');
assert.match(source, /fetchConnectorTemplates\('published'\)/, 'Provider content must load from published backend templates');
assert.match(source, /const \[items, publishedTemplates\] = await Promise\.all\(\[\s*fetchParameters\(\)/, 'Parameter Studio lists all server-authorized platform parameters');
assert.match(source, /field\.variable_name === param\.variable_name/, 'Only shared connector fields use connector governance');
assert.match(source, /saveConnectorFieldGovernance\(shared\.template\.system_name/, 'Shared field access saves through the same backend policy as connector forms');
assert.match(source, /renderScopeControl\(param\)/, 'Table and card scope controls use the shared policy');
assert.match(source, /param\.label \|\| param\.variable_name/, 'Parameter labels come from backend definitions');
assert.doesNotMatch(source, /Inherits Default/, 'The redundant inheritance badge is absent from table and card views');

const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const context = {
  exports: {},
  require: () => ({ jsx: () => null, Cpu: () => null, Layers: () => null, Search: () => null, Sliders: () => null }),
};
vm.createContext(context);
vm.runInContext(`${code}\nglobalThis.getToolMeta = getToolMeta;`, context);

const template = { system_name: 'itsm', name: 'Configured Jira name', category: 'Ticketing', description: 'Configured by backend' };
const meta = context.getToolMeta('itsm', [template]);
assert.equal(meta.displayName, template.name);
assert.equal(meta.toolCategory, template.category);
assert.equal(meta.description, template.description);
assert.equal(context.getToolMeta('custom_tool', []).displayName, 'Custom Tool');
