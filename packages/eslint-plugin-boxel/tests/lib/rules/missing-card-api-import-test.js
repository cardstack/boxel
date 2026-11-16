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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
  `,
    {
      code: `
        import { FieldDef } from '@cardstack/base/card-api';

        export class AddressField extends FieldDef {}

        export class SolanaAddressField extends AddressField {}
      `,
      options: [
        {
          importMappings: {
            AddressField: ['AddressField', '@cardstack/base/card-api'],
          },
        },
      ],
    },
    // A class member named after a mapped export is not a reference, so
    // no import is injected for it. Injecting one would create a binding
    // with no references, the unused-import fix would remove it, and the
    // two autofixes would ping-pong without converging.
    {
      code: `
        export class Foo {
          contains(other) {
            return other === this;
          }
          field = 1;
        }
      `,
      options: [
        {
          importMappings: {
            contains: ['contains', '@cardstack/base/card-api'],
            field: ['field', '@cardstack/base/card-api'],
          },
        },
      ],
    },
    // A TypeScript interface or type-literal key named after a mapped
    // export is not a reference either.
    {
      code: `
        export interface Art {
          field?: number;
          contains(other: Art): boolean;
        }
        export type Placed = { field: number } | null;
      `,
      options: [
        {
          importMappings: {
            contains: ['contains', '@cardstack/base/card-api'],
            field: ['field', '@cardstack/base/card-api'],
          },
        },
      ],
    },
    // Nor is an enum member, the right side of a qualified type name,
    // or the outside name of an export alias.
    {
      code: `
        import * as NS from './ns';
        export enum Kind { field, other }
        export type T = NS.field;
        const x = 1;
        export { x as field };
      `,
      options: [
        {
          importMappings: {
            field: ['field', '@cardstack/base/card-api'],
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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            FieldDef: ['FieldDef', '@cardstack/base/card-api'],
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
      // The configured target module is the RRI prefix form, but the
      // file imports the equivalent virtual-alias URL form. The fix
      // must merge into the existing import rather than emitting a
      // second, duplicate import line — the two specifiers refer to the
      // same module (see REALM_PREFIX_ALIASES in import-utils).
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
            FieldDef: ['FieldDef', '@cardstack/base/card-api'],
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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      import { Chain } from './chain';

      export class Payment extends FieldDef {
        @field chain = linksTo(Chain);
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            contains: ['contains', '@cardstack/base/card-api'],
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
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      output: `import {
        FieldDef,
        contains,
        linksTo, field,
      } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            field: ['field', '@cardstack/base/card-api'],
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
      } from '@cardstack/base/card-api';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      output: `import StringField from '@cardstack/base/string';
import {
        FieldDef,
        contains,
        field,
        linksTo,
      } from '@cardstack/base/card-api';

      export class Payment extends FieldDef {
        @field address = contains(StringField);
      }
      `,
      options: [
        {
          importMappings: {
            StringField: ['default', '@cardstack/base/string'],
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
      code: `import { FieldDef, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class CurrencyField extends FieldDef {
  static displayName = "Currency";

  @field currency = contains(StringField, {
    computeVia: function() {
      return "RUB"; // Default currency is RUB (Russian Ruble)
    }
  });
}`,
      output: `import { FieldDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

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
            field: ['field', '@cardstack/base/card-api'],
            contains: ['contains', '@cardstack/base/card-api'],
            Component: ['Component', '@cardstack/base/card-api'],
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
