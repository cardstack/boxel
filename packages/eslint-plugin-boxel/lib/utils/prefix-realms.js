'use strict';

// The registered `@cardstack/…` realm prefixes, in the order
// `PREFIX_REALMS` in `packages/runtime-common/realm-prefixes.ts` declares
// them. That module is TypeScript importing TypeScript, which this plugin's
// CommonJS cannot load wherever ESLint runs, so the list is restated here and
// `tests/lib/utils/prefix-realms-test.js` fails when the two differ.
const PREFIX_REALM_PREFIXES = Object.freeze([
  '@cardstack/base/',
  '@cardstack/catalog/',
  '@cardstack/skills/',
  '@cardstack/openrouter/',
  '@cardstack/pretui/',
]);

module.exports = { PREFIX_REALM_PREFIXES };
