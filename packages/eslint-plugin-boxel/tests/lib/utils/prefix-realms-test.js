'use strict';

const {
  PREFIX_REALMS,
  PREFIX_REALM_PREFIXES,
  PREFIX_REALM_ALIASES,
} = require('../../../lib/utils/prefix-realms');

// The prefix and alias of each realm, which is the part of the declaration the
// plugin restates. `hostConfigKey` is the host's concern.
function prefixesAndAliases(realms) {
  return realms.map(({ prefix, alias }) => ({ prefix, alias }));
}

describe('prefix-realms', () => {
  it('lists the prefixes and aliases runtime-common declares, in its order', async () => {
    let { PREFIX_REALMS: declared } =
      await import('../../../../runtime-common/realm-prefixes.ts');
    expect(prefixesAndAliases(PREFIX_REALMS)).toEqual(
      prefixesAndAliases(declared),
    );
  });

  it('derives the prefix list from the table', () => {
    expect([...PREFIX_REALM_PREFIXES]).toEqual(
      PREFIX_REALMS.map((realm) => realm.prefix),
    );
  });

  // `no-url-form-base-imports` reports nothing without the base alias, so
  // retiring the alias retires that rule too.
  it('maps each prefix that has an alias to it', () => {
    expect(PREFIX_REALM_ALIASES).toEqual({
      '@cardstack/base/': 'https://cardstack.com/base/',
    });
  });
});
