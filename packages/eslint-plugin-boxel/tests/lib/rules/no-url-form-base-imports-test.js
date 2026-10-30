/**
 * @fileoverview Tests for no-url-form-base-imports rule
 */
'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/no-url-form-base-imports');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-url-form-base-imports', rule, {
  valid: [
    // Canonical prefix specifiers
    "import { CardDef } from '@cardstack/base/card-api';",
    "import StringField from '@cardstack/base/string';",
    "let api = await loader.import('@cardstack/base/card-api');",
    "let mod = await import('@cardstack/base/string');",
    "export { Foo } from '@cardstack/base/foo';",
    // The positions that define the alias or recognize data written in it
    "export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));",
    "function internalKeyFor(ref) { return ref.module.replace('https://cardstack.com/base/', '@cardstack/base/'); }",
    "export function registeredRealmURL(vn, realm) { return realm === '@cardstack/base/' ? 'https://cardstack.com/base/' : realm; }",
    "class VirtualNetwork { equivalentURLForms(url) { return [url, url.replace('@cardstack/base/', 'https://cardstack.com/base/')]; } }",
    'let equivalentURLForms = (url) => [url, `https://cardstack.com/base/${url}`];',
    // A test of alias tolerance, canonicalization or migration, outside imports
    {
      code: "let url = 'https://cardstack.com/base/card-api';",
      options: [{ allowAliasOutsideImports: true }],
    },
    // The alias in a comment is not code
    '// resolves https://cardstack.com/base/card-api\nlet x = 1;',
    // Unrelated URL-form imports
    "import x from 'https://example.com/module';",
    // A template literal whose leading spelling is not the alias
    'let mod = await import(`@cardstack/base/${name}`);',
    'let mod = await loader.import(`${realm}https://cardstack.com/base/x`);',
    // `baseRealm.url` read as the base realm's registered URL, with no path
    // appended to it
    'let realms = [baseRealm.url, testRealmURL];',
    'let isBase = realmURL === baseRealm.url;',
    'let paths = new RealmPaths(new URL(baseRealm.url));',
    'let url = `${baseRealm.url}`;',
    'let selector = `[data-test-realm-url="${baseRealm.url}"]`;',
    'let message = `${baseRealm.url} is the base realm`;',
    "let permissions = { [`${baseRealm.url}`]: ['read'] };",
    'let id = `${other.url}index`;',
    "let id = other.url + 'index';",
    "let url = new URL('index', other.url);",
    // An import specifier is read by its leading spelling only
    'let mod = await loader.import(`${realm}${baseRealm.url}x`);',
    'let mod = await loader.import(`${other.url}card-api`);',
    // A path appended to `baseRealm.url` in the positions that recognize the
    // alias, or in a test of alias tolerance
    'function equivalentURLForms(url) { return [url, `${baseRealm.url}${url}`]; }',
    {
      code: 'let id = `${baseRealm.url}index`;',
      options: [{ allowAliasOutsideImports: true }],
    },
    {
      code: "let id = baseRealm.url + 'index';",
      options: [{ allowAliasOutsideImports: true }],
    },
    // `importResource` with a canonical specifier, or one it cannot read
    "let mod = importResource(this, () => '@cardstack/base/card-api');",
    'let mod = importResource(this, () => this.args.url);',
  ],

  invalid: [
    // The alias outside an import position and outside the allowed positions
    {
      code: "let url = 'https://cardstack.com/base/card-api';",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "fetch('https://cardstack.com/base/file-api');",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let url = `https://cardstack.com/base/${name}`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let selector = `[data-test-id="https://cardstack.com/base/cards/skill"]`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    // A path appended to `baseRealm.url` spells the alias
    {
      code: 'let id = `${baseRealm.url}index`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let selector = `[data-test-item-button="${baseRealm.url}cards/skill"]`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let id = `${baseRealm.url}${name}`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let source = `import X from "${baseRealm.url}card-api";`;',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let id = baseRealm.url + 'card-api';",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let url = new URL('card-api', baseRealm.url).href;",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let ref = { module: `${baseRealm.url}card-api`, name: 'CardDef' };",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    // A code ref's module is rewritten to the prefix
    {
      code: "let ref = { module: 'https://cardstack.com/base/realm-config', name: 'RealmConfig' };",
      output:
        "let ref = { module: '@cardstack/base/realm-config', name: 'RealmConfig' };",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: 'let doc = { meta: { adoptsFrom: { "module": "https://cardstack.com/base/card-api", name: "CardDef" } } };',
      output:
        'let doc = { meta: { adoptsFrom: { "module": "@cardstack/base/card-api", name: "CardDef" } } };',
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    // A module that only contains the alias, or a key other than module, is
    // reported without a fix
    {
      code: "let ref = { module: 'see https://cardstack.com/base/card-api' };",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let ref = { url: 'https://cardstack.com/base/card-api' };",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let mod = importResource(this, () => { return 'https://cardstack.com/base/card-api'; });",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: "let mod = somethingElse(this, () => 'https://cardstack.com/base/card-api');",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    // A function that only shares a name's prefix with an allowed one
    {
      code: "function internalKeyForDisplay() { return 'https://cardstack.com/base/x'; }",
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    // The option leaves import positions checked
    {
      code: "import { CardDef } from 'https://cardstack.com/base/card-api';",
      output: "import { CardDef } from '@cardstack/base/card-api';",
      options: [{ allowAliasOutsideImports: true }],
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "import { CardDef } from 'https://cardstack.com/base/card-api';",
      output: "import { CardDef } from '@cardstack/base/card-api';",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: 'import StringField from "https://cardstack.com/base/string";',
      output: 'import StringField from "@cardstack/base/string";',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "export { Foo } from 'https://cardstack.com/base/foo';",
      output: "export { Foo } from '@cardstack/base/foo';",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "let mod = await import('https://cardstack.com/base/card-api');",
      output: "let mod = await import('@cardstack/base/card-api');",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "let api = await loader.import('https://cardstack.com/base/card-api');",
      output: "let api = await loader.import('@cardstack/base/card-api');",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "let api = await this.loaderService.loader.import('https://cardstack.com/base/command');",
      output:
        "let api = await this.loaderService.loader.import('@cardstack/base/command');",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    // Template literals
    {
      code: 'let mod = await import(`https://cardstack.com/base/${name}`);',
      output: 'let mod = await import(`@cardstack/base/${name}`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: 'let api = await loader.import(`https://cardstack.com/base/${name}.gts`);',
      output: 'let api = await loader.import(`@cardstack/base/${name}.gts`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: 'let api = await loader.import(`https://cardstack.com/base/card-api`);',
      output: 'let api = await loader.import(`@cardstack/base/card-api`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: "let api = await loader.import(`${'https://cardstack.com/base/'}card-api`);",
      output: "let api = await loader.import(`${'@cardstack/base/'}card-api`);",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    // `baseRealm.url` interpolated first
    {
      code: 'let mod = await loader.import(`${baseRealm.url}card-api`);',
      output: 'let mod = await loader.import(`@cardstack/base/card-api`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: 'let mod = await import(`${baseRealm.url}${name}`);',
      output: 'let mod = await import(`@cardstack/base/${name}`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    // `importResource` thunks
    {
      code: "let mod = importResource(this, () => 'https://cardstack.com/base/card-api');",
      output:
        "let mod = importResource(this, () => '@cardstack/base/card-api');",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
    {
      code: 'let mod = importResource(this, () => `https://cardstack.com/base/${name}`);',
      output:
        'let mod = importResource(this, () => `@cardstack/base/${name}`);',
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
  ],
});

// Type positions need a TypeScript parser.
const typeScriptRuleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

typeScriptRuleTester.run('no-url-form-base-imports (TypeScript)', rule, {
  valid: [
    "let api = await loader.import<typeof import('@cardstack/base/card-api')>('@cardstack/base/card-api');",
  ],
  invalid: [
    {
      code: "let api = await loader.import<typeof import('https://cardstack.com/base/card-api')>('@cardstack/base/card-api');",
      output:
        "let api = await loader.import<typeof import('@cardstack/base/card-api')>('@cardstack/base/card-api');",
      errors: [{ messageId: 'no-url-form-base-imports' }],
    },
  ],
});

// `<template>` content needs the Ember parser.
const templateRuleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

templateRuleTester.run('no-url-form-base-imports (templates)', rule, {
  valid: [
    `<template><a href="https://example.com/base/x">Docs</a></template>`,
    `<template>{{concat "@cardstack/base/" "card-api"}}</template>`,
  ],
  invalid: [
    {
      code: `<template><a href="https://cardstack.com/base/cards/skill">Skill</a></template>`,
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: `<template>Served from https://cardstack.com/base/ today</template>`,
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
    {
      code: `<template>{{concat "https://cardstack.com/base/" "card-api"}}</template>`,
      errors: [{ messageId: 'aliasOutsideAllowedPosition' }],
    },
  ],
});
