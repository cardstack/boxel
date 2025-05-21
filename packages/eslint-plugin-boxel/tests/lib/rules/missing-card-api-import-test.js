//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/missing-card-api-import');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});
ruleTester.run('missing-card-api-import', rule, {
  valid: [
    `
      import {
        contains,
        field,
        FieldDef,
        linksTo,
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
  `,
  ],

  invalid: [
    {
      code: `import {
        contains,
        field,
        linksTo,
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
      `,
      output: `import {
        contains,
        field,
        linksTo, FieldDef,
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            FieldDef: ['FieldDef', 'https://cardstack.com/base/card-api'],
          },
        },
      ],

      errors: [
        {
          type: 'Identifier',
          message: rule.meta.messages['missing-card-api-import'],
        },
      ],
    },
  ],
});
