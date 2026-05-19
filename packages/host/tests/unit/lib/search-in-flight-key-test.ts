import { module, test } from 'qunit';

import type { Query, RealmResourceIdentifier } from '@cardstack/runtime-common';

import { searchInFlightKey } from '@cardstack/host/lib/search-in-flight-key';

const realmA = 'http://localhost:4201/test/';
const realmB = 'http://localhost:4201/other/';

const personRef = {
  module: 'http://localhost:4201/test/person' as RealmResourceIdentifier,
  name: 'Person',
};

const baseQuery: Query = {
  filter: {
    on: personRef,
    eq: { firstName: 'Mango' },
  },
};

module('Unit | Utility | searchInFlightKey (host)', function () {
  test('same realms + query produce the same key', function (assert) {
    let a = searchInFlightKey([realmA], baseQuery);
    let b = searchInFlightKey([realmA], baseQuery);
    assert.strictEqual(a, b);
  });

  test('key is invariant under query property order', function (assert) {
    let q1: Query = {
      filter: {
        on: personRef,
        eq: { firstName: 'Mango', lastName: 'Abdel-Rahman' },
      },
    };
    let q2: Query = {
      filter: {
        eq: { lastName: 'Abdel-Rahman', firstName: 'Mango' },
        on: {
          name: 'Person',
          module:
            'http://localhost:4201/test/person' as RealmResourceIdentifier,
        },
      },
    };
    assert.strictEqual(
      searchInFlightKey([realmA], q1),
      searchInFlightKey([realmA], q2),
    );
  });

  test('different filters produce different keys', function (assert) {
    let other: Query = {
      filter: {
        on: personRef,
        eq: { firstName: 'Vango' },
      },
    };
    assert.notStrictEqual(
      searchInFlightKey([realmA], baseQuery),
      searchInFlightKey([realmA], other),
    );
  });

  test('different realm sets produce different keys', function (assert) {
    assert.notStrictEqual(
      searchInFlightKey([realmA], baseQuery),
      searchInFlightKey([realmB], baseQuery),
    );
  });

  test('realm array order matters (different orders => different keys)', function (assert) {
    // The realm-server's `_federated-search` iterates the `realms`
    // array and concatenates results in that order, so `[a, b]` and
    // `[b, a]` are not semantically equivalent requests.
    assert.notStrictEqual(
      searchInFlightKey([realmA, realmB], baseQuery),
      searchInFlightKey([realmB, realmA], baseQuery),
    );
  });

  test('superset / subset of realms produce different keys', function (assert) {
    assert.notStrictEqual(
      searchInFlightKey([realmA], baseQuery),
      searchInFlightKey([realmA, realmB], baseQuery),
    );
  });

  test('pagination differences produce different keys', function (assert) {
    let p1: Query = { ...baseQuery, page: { number: 0, size: 10 } };
    let p2: Query = { ...baseQuery, page: { number: 1, size: 10 } };
    assert.notStrictEqual(
      searchInFlightKey([realmA], p1),
      searchInFlightKey([realmA], p2),
    );
  });

  test('empty realms array produces a stable key distinct from non-empty', function (assert) {
    assert.strictEqual(
      searchInFlightKey([], baseQuery),
      searchInFlightKey([], baseQuery),
    );
    assert.notStrictEqual(
      searchInFlightKey([], baseQuery),
      searchInFlightKey([realmA], baseQuery),
    );
  });
});
