'use strict';

// The realms addressed by a registered `@cardstack/…` prefix, in the order
// `PREFIX_REALMS` in `packages/runtime-common/realm-prefixes.ts` declares
// them: each realm's prefix and, where it has one, the `https://` alias that
// must resolve to the same realm. That module is TypeScript importing
// TypeScript, which this plugin's CommonJS cannot load wherever ESLint runs,
// so the table is restated here and `tests/lib/utils/prefix-realms-test.js`
// fails when the two differ. Every prefix-to-alias table in this plugin reads
// from this one.
const PREFIX_REALMS = Object.freeze([
  Object.freeze({
    prefix: '@cardstack/base/',
    alias: 'https://cardstack.com/base/',
  }),
  Object.freeze({ prefix: '@cardstack/catalog/' }),
  Object.freeze({ prefix: '@cardstack/skills/' }),
  Object.freeze({ prefix: '@cardstack/openrouter/' }),
  Object.freeze({ prefix: '@cardstack/pretui/' }),
]);

const PREFIX_REALM_PREFIXES = Object.freeze(
  PREFIX_REALMS.map((realm) => realm.prefix),
);

// Each alias keyed by the prefix it stands for. A realm without an alias is
// absent, so a rule that treats the two spellings as one module has nothing to
// fold for it.
const PREFIX_REALM_ALIASES = Object.freeze(
  Object.fromEntries(
    PREFIX_REALMS.filter((realm) => realm.alias).map((realm) => [
      realm.prefix,
      realm.alias,
    ]),
  ),
);

module.exports = { PREFIX_REALMS, PREFIX_REALM_PREFIXES, PREFIX_REALM_ALIASES };
