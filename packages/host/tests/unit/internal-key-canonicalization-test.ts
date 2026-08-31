import { module, test } from 'qunit';

import { VirtualNetwork, internalKeyFor, rri } from '@cardstack/runtime-common';

const REAL_BASE = 'https://realms.example.test/base/';
const ALIAS_BASE = 'https://cardstack.com/base/';
const REAL_CATALOG = 'https://realms.example.test/catalog/';
// A realm reached by a URL mapping with no prefix of its own, the shape the
// test realm takes in environment mode.
const VIRTUAL_TEST = 'https://localhost:4202/test/';
const REAL_TEST = 'https://realm-test.example.test/test/';

// The definition store is keyed by `internalKeyFor`, which resolves a module
// reference to a real URL and unresolves that back through the registered realm
// mappings. Whether that collapses every spelling of one module into one key
// depends on the realm having a prefix mapping, and `definitionEntryFor` reads
// under two keys precisely because some realms do not have one. These tests pin
// both halves of that, because the difference decides whether a definition can
// be stored under a key no lookup produces — a miss that surfaces as
// "definition not found" rather than as anything recognisable as a form bug.
module('Unit | internalKeyFor canonicalization', function () {
  function configuredNetwork() {
    let virtualNetwork = new VirtualNetwork();
    // Registered the way every process on the definition-lookup path does it:
    // the base realm gets both its alias URL mapping and its prefix mapping,
    // other prefix realms just the prefix.
    virtualNetwork.addURLMapping(new URL(ALIAS_BASE), new URL(REAL_BASE));
    virtualNetwork.addRealmMapping('@cardstack/base/', REAL_BASE);
    virtualNetwork.addRealmMapping('@cardstack/catalog/', REAL_CATALOG);
    return virtualNetwork;
  }

  test('every spelling of a base-realm module yields one key', function (assert) {
    let virtualNetwork = configuredNetwork();
    let keys = [
      '@cardstack/base/card-api',
      `${ALIAS_BASE}card-api`,
      `${REAL_BASE}card-api`,
    ].map((module) =>
      internalKeyFor(
        { module: rri(module), name: 'CardDef' },
        undefined,
        virtualNetwork,
      ),
    );

    assert.strictEqual(
      new Set(keys).size,
      1,
      'the prefix, alias and served spellings agree',
    );
    assert.strictEqual(
      keys[0],
      '@cardstack/base/card-api/CardDef',
      'and they agree on the prefix form, which is the stored key',
    );
  });

  test('a realm with only a prefix mapping canonicalizes too', function (assert) {
    let virtualNetwork = configuredNetwork();
    let keys = ['@cardstack/catalog/listing', `${REAL_CATALOG}listing`].map(
      (module) =>
        internalKeyFor(
          { module: rri(module), name: 'Listing' },
          undefined,
          virtualNetwork,
        ),
    );

    assert.deepEqual(
      keys,
      [
        '@cardstack/catalog/listing/Listing',
        '@cardstack/catalog/listing/Listing',
      ],
      'a realm needs no alias for its two spellings to collapse',
    );
  });

  test('the executable extension is trimmed out of the key', function (assert) {
    let virtualNetwork = configuredNetwork();
    assert.strictEqual(
      internalKeyFor(
        { module: rri('@cardstack/base/card-api.gts'), name: 'CardDef' },
        undefined,
        virtualNetwork,
      ),
      '@cardstack/base/card-api/CardDef',
      'so a reference carrying .gts keys the same as one without',
    );
  });

  test('a realm mapped by URL alone keys its two spellings separately', function (assert) {
    // The reason `definitionEntryFor` reads under two keys. The test realm in
    // environment mode has this exact shape — a URL mapping onto a
    // per-environment host and no prefix of its own — so a definition stored
    // under one spelling is invisible to a lookup holding the other.
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(new URL(VIRTUAL_TEST), new URL(REAL_TEST));

    let servedKey = internalKeyFor(
      { module: rri(`${REAL_TEST}captain`), name: 'Captain' },
      undefined,
      virtualNetwork,
    );
    let virtualKey = internalKeyFor(
      { module: rri(`${VIRTUAL_TEST}captain`), name: 'Captain' },
      undefined,
      virtualNetwork,
    );

    assert.notStrictEqual(
      servedKey,
      virtualKey,
      'without a prefix to fold onto, each URL spelling keys its own entry',
    );
    assert.strictEqual(
      servedKey,
      `${REAL_TEST}captain/Captain`,
      'the served spelling keys under the served URL',
    );
    assert.strictEqual(
      virtualKey,
      `${VIRTUAL_TEST}captain/Captain`,
      'and the virtual spelling under the virtual URL',
    );
  });

  test('giving that realm a prefix collapses both spellings', function (assert) {
    // And the condition under which the second lookup becomes redundant.
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(new URL(VIRTUAL_TEST), new URL(REAL_TEST));
    virtualNetwork.addRealmMapping('@test/realm/', REAL_TEST);

    let keys = [`${REAL_TEST}captain`, `${VIRTUAL_TEST}captain`].map((module) =>
      internalKeyFor(
        { module: rri(module), name: 'Captain' },
        undefined,
        virtualNetwork,
      ),
    );

    assert.deepEqual(
      keys,
      ['@test/realm/captain/Captain', '@test/realm/captain/Captain'],
      'a prefix mapping is what makes the key independent of the spelling',
    );
  });
});
