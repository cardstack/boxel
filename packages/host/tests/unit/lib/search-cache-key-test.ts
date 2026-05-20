import { module, test } from 'qunit';

import type { Query, RealmResourceIdentifier } from '@cardstack/runtime-common';

import { searchCacheKey } from '@cardstack/host/lib/search-cache-key';

const jobA = 'job-aaa';
const jobB = 'job-bbb';
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

module('Unit | Utility | searchCacheKey', function () {
  test('same jobId + consumingRealm + query produce the same key', function (assert) {
    let a = searchCacheKey(jobA, realmA, baseQuery);
    let b = searchCacheKey(jobA, realmA, baseQuery);
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
      searchCacheKey(jobA, realmA, q1),
      searchCacheKey(jobA, realmA, q2),
    );
  });

  test('different jobIds produce different keys', function (assert) {
    assert.notStrictEqual(
      searchCacheKey(jobA, realmA, baseQuery),
      searchCacheKey(jobB, realmA, baseQuery),
    );
  });

  test('different consumingRealms produce different keys', function (assert) {
    assert.notStrictEqual(
      searchCacheKey(jobA, realmA, baseQuery),
      searchCacheKey(jobA, realmB, baseQuery),
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
      searchCacheKey(jobA, realmA, baseQuery),
      searchCacheKey(jobA, realmA, other),
    );
  });

  test('pagination differences produce different keys', function (assert) {
    let p1: Query = { ...baseQuery, page: { number: 0, size: 10 } };
    let p2: Query = { ...baseQuery, page: { number: 1, size: 10 } };
    assert.notStrictEqual(
      searchCacheKey(jobA, realmA, p1),
      searchCacheKey(jobA, realmA, p2),
    );
  });

  test('a payload that would collide via naïve string concatenation does not collide via JSON encoding', function (assert) {
    // jobId="a", realm="b|c" vs jobId="a|b", realm="c" — both would
    // produce the same string if we joined fields with a "|" delimiter.
    // The JSON-array encoding keeps them distinct.
    let a = searchCacheKey('a', 'b|c', baseQuery);
    let b = searchCacheKey('a|b', 'c', baseQuery);
    assert.notStrictEqual(a, b);
  });
});
