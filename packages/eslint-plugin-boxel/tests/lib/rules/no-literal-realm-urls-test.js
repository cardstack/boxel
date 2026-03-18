'use strict';

const rule = require('../../../lib/rules/no-literal-realm-urls');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-literal-realm-urls', rule, {
  valid: [
    // Already using prefix form
    {
      code: `let id = '@cardstack/catalog/PersonCard';`,
    },
    // Unrelated URLs
    {
      code: `let url = 'https://example.com/something';`,
    },
    // Partial match that isn't a realm URL
    {
      code: `let url = 'http://localhost:4201/other-realm/foo';`,
    },
    // Template literal with prefix form
    {
      code: 'let id = `@cardstack/catalog/${name}`;',
    },
  ],

  invalid: [
    // localhost catalog URL in a string literal
    {
      code: `let id = 'http://localhost:4201/catalog/PersonCard';`,
      output: `let id = '@cardstack/catalog/PersonCard';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // staging catalog URL
    {
      code: `let id = 'https://realms-staging.stack.cards/catalog/PersonCard';`,
      output: `let id = '@cardstack/catalog/PersonCard';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // production catalog URL
    {
      code: `let id = 'https://app.boxel.ai/catalog/PersonCard';`,
      output: `let id = '@cardstack/catalog/PersonCard';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // URL with deeper path
    {
      code: `let ref = 'http://localhost:4201/catalog/fields/SkillCard.json';`,
      output: `let ref = '@cardstack/catalog/fields/SkillCard.json';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Import statement with catalog URL
    {
      code: `import { PersonCard } from 'http://localhost:4201/catalog/person-card';`,
      output: `import { PersonCard } from '@cardstack/catalog/person-card';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Template literal containing a catalog URL
    {
      code: 'let url = `http://localhost:4201/catalog/cards/${id}`;',
      output: 'let url = `@cardstack/catalog/cards/${id}`;',
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Double-quoted string
    {
      code: `let id = "https://app.boxel.ai/catalog/FancyCard";`,
      output: `let id = "@cardstack/catalog/FancyCard";`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Just the base URL (no trailing path beyond the realm)
    {
      code: `let base = 'http://localhost:4201/catalog/';`,
      output: `let base = '@cardstack/catalog/';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Custom realm mappings via options
    {
      code: `let id = 'https://cardstack.com/base/card-api';`,
      output: `let id = '@cardstack/base/card-api';`,
      options: [
        {
          realmMappings: [
            {
              prefix: '@cardstack/base/',
              urls: ['https://cardstack.com/base/'],
            },
          ],
        },
      ],
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
  ],
});
