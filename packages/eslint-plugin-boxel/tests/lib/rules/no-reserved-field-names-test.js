'use strict';

const rule = require('../../../lib/rules/no-reserved-field-names');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: require.resolve('ember-eslint-parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-reserved-field-names', rule, {
  valid: [
    // Ordinary field names are fine
    `
      import { contains, field, CardDef } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

      export class Product extends CardDef {
        @field name = contains(StringField);
      }
    `,
    // Consuming the system getter is the point, not a violation
    `
      import { CardDef } from '@cardstack/base/card-api';

      export class Product extends CardDef {
        get preview() {
          return this.captureURLs.card;
        }
      }
    `,
    // The reserved name without a @field decorator is not this rule's
    // concern (the runtime getter contract covers overrides)
    `
      export class NotACard {
        captureURLs = {};
      }
    `,
    // Other decorators under the reserved name are not fields
    `
      export class Component {
        @tracked captureURLs = {};
      }
    `,
  ],

  invalid: [
    {
      code: `
        import { contains, field, CardDef } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';

        export class Product extends CardDef {
          @field captureURLs = contains(StringField);
        }
      `,
      errors: [{ messageId: 'no-reserved-field-names' }],
    },
    {
      code: `
        import { field, linksTo, CardDef } from '@cardstack/base/card-api';

        export class Product extends CardDef {
          @field captureURLs = linksTo(() => Product);
        }
      `,
      errors: [{ messageId: 'no-reserved-field-names' }],
    },
    {
      code: `
        import { contains, field, CardDef } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';

        export class Product extends CardDef {
          @field capturesMeta = contains(StringField);
        }
      `,
      errors: [{ messageId: 'no-reserved-field-names' }],
    },
  ],
});
