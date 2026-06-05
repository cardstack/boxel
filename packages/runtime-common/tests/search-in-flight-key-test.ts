import type { RealmResourceIdentifier } from '../realm-identifiers';
import type { SharedTests } from '../helpers';
import type { Query } from '../query';
import { searchInFlightKey } from '../realm-index-query-engine';

const realmURL = 'http://localhost:4201/test/';

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

const tests = Object.freeze({
  'same query + opts produce the same key': async (assert) => {
    let a = searchInFlightKey(realmURL, baseQuery, { loadLinks: true });
    let b = searchInFlightKey(realmURL, baseQuery, { loadLinks: true });
    assert.strictEqual(a, b);
  },

  'key is invariant under input property order': async (assert) => {
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
      searchInFlightKey(realmURL, q1, undefined),
      searchInFlightKey(realmURL, q2, undefined),
    );
  },

  'different filters produce different keys': async (assert) => {
    let other: Query = {
      filter: {
        on: personRef,
        eq: { firstName: 'Vango' },
      },
    };
    assert.notStrictEqual(
      searchInFlightKey(realmURL, baseQuery, undefined),
      searchInFlightKey(realmURL, other, undefined),
    );
  },

  'different realm URLs produce different keys': async (assert) => {
    assert.notStrictEqual(
      searchInFlightKey(realmURL, baseQuery, undefined),
      searchInFlightKey('http://localhost:4201/other/', baseQuery, undefined),
    );
  },

  'different opts shapes produce different keys': async (assert) => {
    // Callers passing different opts shapes should not coalesce.
    assert.notStrictEqual(
      searchInFlightKey(realmURL, baseQuery, undefined),
      searchInFlightKey(realmURL, baseQuery, { loadLinks: true }),
    );
  },

  'undefined opts and empty-object opts produce different keys': async (
    assert,
  ) => {
    // The key intentionally distinguishes `undefined` (no opts at all) from
    // `{}` (opts object with no flags set). They semantically behave the same
    // inside searchCards, but keeping them distinct keys avoids any future
    // surprise if the two shapes ever diverge — coalescing only happens for
    // callers passing literally the same opts.
    assert.notStrictEqual(
      searchInFlightKey(realmURL, baseQuery, undefined),
      searchInFlightKey(realmURL, baseQuery, {}),
    );
  },

  'different linkFields produce different keys': async (assert) => {
    assert.notStrictEqual(
      searchInFlightKey(realmURL, baseQuery, {
        loadLinks: true,
        linkFields: ['friends'],
      }),
      searchInFlightKey(realmURL, baseQuery, {
        loadLinks: true,
        linkFields: ['family'],
      }),
    );
  },

  'pagination differences produce different keys': async (assert) => {
    let p1: Query = { ...baseQuery, page: { number: 0, size: 10 } };
    let p2: Query = { ...baseQuery, page: { number: 1, size: 10 } };
    assert.notStrictEqual(
      searchInFlightKey(realmURL, p1, undefined),
      searchInFlightKey(realmURL, p2, undefined),
    );
  },
} as SharedTests<{}>);

export default tests;
