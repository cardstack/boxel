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
    // `baseRealm.url` outside an import position, or not interpolated first
    'let id = `${baseRealm.url}index`;',
    'let mod = await loader.import(`${realm}${baseRealm.url}x`);',
    'let mod = await loader.import(`${other.url}card-api`);',
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
    {
      code: "let ref = { module: 'https://cardstack.com/base/realm-config', name: 'RealmConfig' };",
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
