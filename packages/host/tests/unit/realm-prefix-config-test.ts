import { module, test } from 'qunit';

import { PREFIX_REALM_PREFIXES } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

// `config/environment` is untyped JavaScript, so the map arrives as `{}`.
function prefixRealmURLs(): Record<string, string> {
  return (ENV.prefixRealmURLs ?? {}) as Record<string, string>;
}

// `config/environment.js` is CommonJS evaluated at build time and cannot import
// `PREFIX_REALMS`, so it spells the prefixes itself. This is what keeps the two
// lists from drifting: a realm added to the declaration but not to the config
// would silently never register on the host, which is the divergence the
// declaration exists to prevent.
module('Unit | realm prefix config', function () {
  test('every configured prefix is a declared one', function (assert) {
    let configured = Object.keys(prefixRealmURLs());
    assert.true(
      configured.length > 0,
      'the build carries at least one prefix realm',
    );
    for (let prefix of configured) {
      assert.true(
        PREFIX_REALM_PREFIXES.includes(prefix),
        `${prefix} is declared in PREFIX_REALMS`,
      );
    }
  });

  test('the base realm is always configured', function (assert) {
    // Every environment serves it, and unlike the catalog and openrouter realms
    // it is never trimmed, so its absence would mean the config block is not
    // being reached at all rather than a realm being switched off.
    assert.ok(
      prefixRealmURLs()['@cardstack/base/'],
      'the base realm has a served-at URL',
    );
  });

  test('a configured prefix carries a URL, not a prefix', function (assert) {
    // The map's values are where a prefix resolves *to*; a value that was
    // itself prefix-form would make `addRealmMapping` map a prefix onto a
    // prefix, and `new URL` on it would throw at boot.
    for (let [prefix, servedAt] of Object.entries(prefixRealmURLs())) {
      let isURL = typeof servedAt === 'string' && /^https?:\/\//.test(servedAt);
      assert.true(isURL, `${prefix} resolves to a URL (${servedAt})`);
    }
  });
});
