import { module, test } from 'qunit';

import { VirtualNetwork, internalKeyFor, rri } from '@cardstack/runtime-common';

const REAL_BASE = 'https://realms.example.test/base/';
const ALIAS_BASE = 'https://cardstack.com/base/';
const REAL_CATALOG = 'https://realms.example.test/catalog/';

// The definition store is keyed by `internalKeyFor`, and the lookup does a
// single keyed read. That is only correct because `internalKeyFor` is a
// canonicalization rather than a formatting choice: it resolves the module
// reference to a real URL and unresolves that back through the registered realm
// mappings, so every spelling of one module reduces to one string. If that ever
// stopped holding, a definition would be stored under a key no lookup produces
// — a miss that surfaces as "definition not found" rather than as a form bug.
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

  test('an unregistered realm does not canonicalize, which is why the mappings matter', function (assert) {
    // The negative case, recorded because it is the reason the prefix set has
    // to be the same in every process: without the prefix mapping the alias and
    // served spellings stay distinct, and neither becomes the prefix-form key
    // that a configured process stores under.
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(new URL(ALIAS_BASE), new URL(REAL_BASE));

    let aliasKey = internalKeyFor(
      { module: rri(`${ALIAS_BASE}card-api`), name: 'CardDef' },
      undefined,
      virtualNetwork,
    );
    let servedKey = internalKeyFor(
      { module: rri(`${REAL_BASE}card-api`), name: 'CardDef' },
      undefined,
      virtualNetwork,
    );

    assert.notStrictEqual(
      aliasKey,
      servedKey,
      'the two spellings split when no realm mapping covers them',
    );
    for (let key of [aliasKey, servedKey]) {
      assert.false(
        key.startsWith('@cardstack/base/'),
        `${key} is not the prefix-form key a configured process would use`,
      );
    }
  });
});
