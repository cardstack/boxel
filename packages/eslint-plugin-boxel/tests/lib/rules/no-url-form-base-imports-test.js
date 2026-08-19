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
    // The URL appearing outside an import position is not this rule's concern
    // (fetch targets, alias registration, assertions on served content).
    "let url = 'https://cardstack.com/base/card-api';",
    "fetch('https://cardstack.com/base/file-api');",
    // Unrelated URL-form imports
    "import x from 'https://example.com/module';",
  ],

  invalid: [
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
  ],
});
