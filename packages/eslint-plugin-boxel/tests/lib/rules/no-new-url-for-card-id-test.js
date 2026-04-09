'use strict';

const rule = require('../../../lib/rules/no-new-url-for-card-id');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-new-url-for-card-id', rule, {
  valid: [
    // Already using cardIdToURL
    { code: `let url = cardIdToURL(cardId);` },
    // String literal URL — safe
    { code: `let url = new URL('https://example.com');` },
    // Two-argument form — relative URL resolution, safe
    { code: `let url = new URL(path, baseURL);` },
    // Variable name that doesn't match card ID patterns
    { code: `let url = new URL(realmURL);` },
    { code: `let url = new URL(fileUrl);` },
    { code: `let url = new URL(response.url);` },
    // Template literal — usually constructed URLs
    { code: 'let url = new URL(`${base}/path`);' },
    // Literal http URL
    { code: `let url = new URL('http://localhost:4201/base/');` },
  ],

  invalid: [
    // Variable named cardId
    {
      code: `let url = new URL(cardId);`,
      output: `let url = cardIdToURL(cardId);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable named moduleURL
    {
      code: `let url = new URL(moduleURL);`,
      output: `let url = cardIdToURL(moduleURL);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable named moduleIdentifier
    {
      code: `let url = new URL(moduleIdentifier);`,
      output: `let url = cardIdToURL(moduleIdentifier);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Property access ref.module
    {
      code: `let url = new URL(ref.module);`,
      output: `let url = cardIdToURL(ref.module);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Property access spec.id
    {
      code: `let url = new URL(spec.id);`,
      output: `let url = cardIdToURL(spec.id);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable named dep
    {
      code: `let url = new URL(dep);`,
      output: `let url = cardIdToURL(dep);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable named sourceUrl
    {
      code: `let url = new URL(sourceUrl);`,
      output: `let url = cardIdToURL(sourceUrl);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable named id
    {
      code: `let url = new URL(id);`,
      output: `let url = cardIdToURL(id);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // Variable ending in Id
    {
      code: `let url = new URL(selectedCardId);`,
      output: `let url = cardIdToURL(selectedCardId);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
    // codeRef.module
    {
      code: `let url = new URL(codeRef.module);`,
      output: `let url = cardIdToURL(codeRef.module);`,
      errors: [{ messageId: 'noNewUrlForCardId' }],
    },
  ],
});
