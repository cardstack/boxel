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
    {
      code: `
        import { FieldDef } from 'https://cardstack.com/base/card-api';

        export class AddressField extends FieldDef {}

        export class SolanaAddressField extends AddressField {}
      `,
      options: [
        {
          importMappings: {
            AddressField: ['AddressField', 'https://cardstack.com/base/card-api'],
          },
        },
      ],
    },
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
    {
      code: `import {
        field,
        linksTo,
        FieldDef
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
      `,
      output: `import {
        field,
        linksTo,
        FieldDef, contains
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
            contains: ['contains', 'https://cardstack.com/base/card-api'],
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
    {
      code: `import {
        FieldDef,
        contains,
        linksTo,
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      output: `import {
        FieldDef,
        contains,
        linksTo, field,
      } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            field: ['field', 'https://cardstack.com/base/card-api'],
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
    {
      code: `import {
        FieldDef,
        contains,
        field,
        linksTo,
      } from 'https://cardstack.com/base/card-api';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      output: `import StringField from 'https://cardstack.com/base/string';
import {
        FieldDef,
        contains,
        field,
        linksTo,
      } from 'https://cardstack.com/base/card-api';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            StringField: ['default', 'https://cardstack.com/base/string'],
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
    {
      code: `import { FieldDef, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class CurrencyField extends FieldDef {
  static displayName = "Currency";

  @field currency = contains(StringField, {
    computeVia: function() {
      return "RUB"; // Default currency is RUB (Russian Ruble)
    }
  });
}`,
      output: `import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class CurrencyField extends FieldDef {
  static displayName = "Currency";

  @field currency = contains(StringField, {
    computeVia: function() {
      return "RUB"; // Default currency is RUB (Russian Ruble)
    }
  });
}`,
      options: [
        {
          importMappings: {
            field: ['field', 'https://cardstack.com/base/card-api'],
            contains: ['contains', 'https://cardstack.com/base/card-api'],
            Component: ['Component', 'https://cardstack.com/base/card-api'],
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
