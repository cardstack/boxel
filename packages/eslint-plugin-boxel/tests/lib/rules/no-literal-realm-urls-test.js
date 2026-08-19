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
    // .localhost but not a catalog path
    {
      code: `let url = 'http://realm-server.linty.localhost/other/foo';`,
    },
    // .localhost with catalog path but not realm-server host
    {
      code: `let url = 'http://boxel.linty.localhost/catalog/foo';`,
    },
    // localhost without subdomain doesn't match the pattern (matched by exact URL instead, but not /other/)
    {
      code: `let url = 'http://localhost:4201/other/foo';`,
    },
  ],

  invalid: [
    // --- Exact URL matches ---

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

    // --- Pattern-based matches (environment-mode *.localhost) ---

    // Environment mode with subdomain
    {
      code: `let id = 'http://realm-server.linty.localhost/catalog/PersonCard';`,
      output: `let id = '@cardstack/catalog/PersonCard';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Environment mode with port
    {
      code: `let id = 'http://realm-server.linty.localhost:4201/catalog/PersonCard';`,
      output: `let id = '@cardstack/catalog/PersonCard';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Environment mode with https
    {
      code: `let id = 'https://realm-server.foo.localhost/catalog/deep/path/Card';`,
      output: `let id = '@cardstack/catalog/deep/path/Card';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
    // Environment mode — just the base URL
    {
      code: `let base = 'http://realm-server.linty.localhost/catalog/';`,
      output: `let base = '@cardstack/catalog/';`,
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },

    // --- Custom realm mappings via options ---
    {
      code: `let id = '@cardstack/base/card-api';`,
      output: `let id = '@cardstack/base/card-api';`,
      options: [
        {
          realmMappings: [
            {
              prefix: '@cardstack/base/',
              urls: ['@cardstack/base/'],
            },
          ],
        },
      ],
      errors: [{ messageId: 'noLiteralRealmUrl' }],
    },
  ],
});
