//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/no-unused-imports');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const SIDE_EFFECT_FREE = {
  sideEffectFreeModules: ['@cardstack/base/*', 'exact-module'],
};

ruleTester.run('no-unused-imports', rule, {
  valid: [
    // every binding used
    `import { CardDef } from '@cardstack/base/card-api';
export class MyCard extends CardDef {}`,
    // default + named, both used
    `import StringField, { type BaseDef } from '@cardstack/base/string';
export function f(x: BaseDef) { return StringField ?? x; }`,
    // bare side-effect import is never touched
    `import './register';`,
    // namespace import used
    `import * as helpers from './helpers';
helpers.go();`,
    // usage only inside a template body counts as a reference
    `import MyComponent from 'somewhere';
<template><MyComponent /></template>`,
    // re-exported binding counts as used
    `import { CardDef } from '@cardstack/base/card-api';
export { CardDef };`,
  ],

  invalid: [
    // unused named specifiers removed, used one kept
    {
      code: `import { CardDef, FieldDef, linksToMany } from '@cardstack/base/card-api';
export class MyCard extends CardDef {}`,
      options: [SIDE_EFFECT_FREE],
      output: `import { CardDef } from '@cardstack/base/card-api';
export class MyCard extends CardDef {}`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // fully-unused declaration from a side-effect-free module (prefix
    // match) is deleted together with its line
    {
      code: `import StringField from '@cardstack/base/string';
export const x = 1;`,
      options: [SIDE_EFFECT_FREE],
      output: `export const x = 1;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // fully-unused declaration from an exact-match module is deleted
    {
      code: `import thing from 'exact-module';
export const x = 1;`,
      options: [SIDE_EFFECT_FREE],
      output: `export const x = 1;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // fully-unused declaration from an unknown module keeps a bare
    // side-effect import so its top-level code still runs
    {
      code: `import registration from './register';
export const x = 1;`,
      options: [SIDE_EFFECT_FREE],
      output: `import './register';
export const x = 1;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // fully-unused type-only import never evaluates, so it is deleted
    // even from an unknown module
    {
      code: `import type { Foo } from './register';
export const x = 1;`,
      options: [SIDE_EFFECT_FREE],
      output: `export const x = 1;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // used default survives when the named specifiers are all unused
    {
      code: `import StringField, { helper, other } from './my-module';
export const x = StringField;`,
      options: [SIDE_EFFECT_FREE],
      output: `import StringField from './my-module';
export const x = StringField;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // unused default is dropped while used named specifiers survive
    {
      code: `import StringField, { helper } from './my-module';
export const x = helper;`,
      options: [SIDE_EFFECT_FREE],
      output: `import { helper } from './my-module';
export const x = helper;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // aliased specifier text is preserved on rebuild
    {
      code: `import { helper as h, unused } from './my-module';
export const x = h;`,
      options: [SIDE_EFFECT_FREE],
      output: `import { helper as h } from './my-module';
export const x = h;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // no options: nothing is ever deleted outright, only rewritten
    {
      code: `import StringField from '@cardstack/base/string';
export const x = 1;`,
      output: `import '@cardstack/base/string';
export const x = 1;`,
      errors: [{ messageId: 'unusedImport' }],
    },
    // a component invoked in the template is kept; its unused sibling is
    // removed
    {
      code: `import MyComponent from 'somewhere';
import OtherComponent from 'elsewhere';
<template><MyComponent /></template>`,
      options: [SIDE_EFFECT_FREE],
      output: `import MyComponent from 'somewhere';
import 'elsewhere';
<template><MyComponent /></template>`,
      errors: [{ messageId: 'unusedImport' }],
    },
  ],
});
