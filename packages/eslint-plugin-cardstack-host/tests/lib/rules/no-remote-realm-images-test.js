'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/no-remote-realm-images');
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

ruleTester.run('no-remote-realm-images', rule, {
  valid: [
    // Root-relative paths are the point of the rule: nothing to fetch.
    {
      code: `realmConfigCardJSON({ iconURL: '/test-fixtures/realm-images/boxel-logo.png' });`,
    },
    {
      code: `realmConfigCardJSON({ backgroundURL: '/test-fixtures/realm-images/4k-powder-puff.jpg' });`,
    },
    // Our own image CDN.
    {
      code: `realmConfigCardJSON({ iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png' });`,
    },
    // Resolved through a const, still allow-listed.
    {
      code: `const icon = 'https://boxel-images.boxel.ai/icons/Letter-a.png';
             realmConfigCardJSON({ iconURL: icon });`,
    },
    // A value the rule cannot know statically is left alone rather than guessed.
    {
      code: `realmConfigCardJSON({ backgroundURL: getRandomBackgroundURL() });`,
    },
    {
      code: `realmConfigCardJSON({ iconURL: someImportedConstant });`,
    },
    {
      code: `realmConfigCardJSON({ iconURL: \`\${base}/icon.png\` });`,
    },
    // Other properties are none of this rule's business, even when remote.
    {
      code: `let card = { thumbnailURL: 'https://i.postimg.cc/abc/icon.png' };`,
    },
    // A computed key could be anything; don't assume.
    {
      code: `let key = 'iconURL'; let o = { [key]: 'https://i.postimg.cc/abc/icon.png' };`,
    },
    // Honours a configured allow-list.
    {
      code: `realmConfigCardJSON({ iconURL: 'https://example.test/icon.png' });`,
      options: [{ allowedHosts: ['example.test'] }],
    },
    // The single-slash form is the local one and must stay valid — the
    // protocol-relative case below turns on exactly this distinction.
    {
      code: `realmConfigCardJSON({ iconURL: '/test-fixtures/realm-images/letter-a.png' });`,
    },
    // An allow-listed host is allow-listed however the URL is spelled.
    {
      code: `realmConfigCardJSON({ iconURL: '//boxel-images.boxel.ai/icons/cardstack.png' });`,
    },
    // One separator resolves against the page's own origin whichever way it
    // leans, so neither of these is remote and the rule must not claim they
    // are.
    {
      code: String.raw`realmConfigCardJSON({ iconURL: '\i.postimg.cc/icon.png' });`,
    },
    {
      code: String.raw`realmConfigCardJSON({ iconURL: 'https:\i.postimg.cc/icon.png' });`,
    },
  ],
  invalid: [
    {
      code: `realmConfigCardJSON({ iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    {
      code: `realmConfigCardJSON({ backgroundURL: 'https://i.postimg.cc/VNvHH93M/bg.jpg' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // http as well as https.
    {
      code: `realmConfigCardJSON({ iconURL: 'http://example.com/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // Through a module-level const, which is how several fixtures spell it.
    {
      code: `const testRealmAIconURL = 'https://i.postimg.cc/L8yXRvws/icon.png';
             realmConfigCardJSON({ iconURL: testRealmAIconURL });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // A quoted key is still the same property.
    {
      code: `realmConfigCardJSON({ 'iconURL': 'https://i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // An allow-listed host does not cover a different one.
    {
      code: `realmConfigCardJSON({ iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png' });`,
      options: [{ allowedHosts: ['boxel-images.boxel.ai'] }],
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // Protocol-relative: the browser borrows the page's scheme and makes the
    // same third-party request, so the leading `//` is remote.
    {
      code: `realmConfigCardJSON({ iconURL: '//i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    {
      code: `realmConfigCardJSON({ backgroundURL: '//example.com/bg.jpg' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // Every two-separator spelling resolves to the same third-party origin,
    // because the URL parser treats a backslash as a slash after a special
    // scheme.
    {
      code: String.raw`realmConfigCardJSON({ iconURL: '\\\\i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    {
      code: String.raw`realmConfigCardJSON({ iconURL: '\\/i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    {
      code: String.raw`realmConfigCardJSON({ iconURL: '/\\i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    {
      code: String.raw`realmConfigCardJSON({ iconURL: 'https:\\\\i.postimg.cc/L8yXRvws/icon.png' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
    // Whitespace is stripped before the fetch, so it cannot smuggle a remote
    // URL past the check either.
    {
      code: `realmConfigCardJSON({ iconURL: '  https://i.postimg.cc/L8yXRvws/icon.png ' });`,
      errors: [{ messageId: 'remoteRealmImage' }],
    },
  ],
});
