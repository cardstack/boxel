import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  f,
  isRefusedWith,
  many,
  noteRef,
  on,
  s,
  setupRefusalIndex,
  table,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for near search. See
// query-refusals-test.ts for how a row is read.

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    name: 'a near sort with no type anywhere',
    query: { sort: [{ by: 'embedding', near: [1, 0, 0] }] },
    wire: { sort: [{ by: 'item.embedding', near: [1, 0, 0] }] },
    code: 'needs-type',
  },
];

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // near
  ...[[1, 0], 3, null, 'embedding'].map((v) => ({
    name: `near: ${JSON.stringify(v)}`,
    query: f({ near: v }),
    code: 'invalid-value',
  })),
  ...[null, [1, 0], 3, {}].map((v) => ({
    name: `near: a field's value is ${JSON.stringify(v)}`,
    query: f({ near: { embedding: v } }),
    code: 'invalid-value',
  })),
  ...['x', 3, null, {}, [1, 'a'], [1, null]].map((v) => ({
    name: `near: to is ${JSON.stringify(v)}`,
    query: f({ near: { embedding: { to: v } } }),
    code: 'invalid-value',
  })),
  ...['high', null, 2, -1.5].map((v) => ({
    name: `near: minSimilarity ${JSON.stringify(v)}`,
    query: f({ near: { embedding: { to: [1, 0], minSimilarity: v } } }),
    code: 'invalid-value',
  })),
  {
    name: 'near: the k nearest is not a filter',
    query: f({ near: { embedding: { to: [1, 0], k: 5 } } }),
    code: 'unknown-key',
  },
  {
    name: 'near: two fields in one filter',
    query: f({ near: { a: { to: [1, 0] }, b: { to: [1, 0] } } }),
    code: 'conflicting-members',
  },
  ...['x', 3, {}, [1, 'a']].map((v) => ({
    name: `a near sort's target is ${JSON.stringify(v)}`,
    query: s([{ by: 'embedding', near: v }]),
    code: 'invalid-value',
  })),
];

const LIMITS: Mistake[] = [
  {
    name: 'a near target of 2,001 components',
    query: s([{ by: 'embedding', near: many(2001, () => 0.1) }]),
    code: 'limit-exceeded',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a near sort entry',
    newer: s([{ by: 'embedding', near: [1, 0], directon: 'asc' }]),
    unknown: 'directon',
    nearest: 'direction',
    older: { sort: [{ on, by: 'embedding', near: [1, 0], directon: 'asc' }] },
    olderIs: 'refused',
  },
  {
    level: "a near filter's value",
    newer: f({ near: { embedding: { to: [1, 0], minSimilarty: 0.5 } } }),
    unknown: 'minSimilarty',
    nearest: 'minSimilarity',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'a similarity floor of -1',
    f({ near: { embedding: { to: [1, 0], minSimilarity: -1 } } }),
  ],
  [
    'a near target of 2,000 components',
    s([{ by: 'embedding', near: many(2000, () => 0.1) }]),
  ],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { run } = shared;

    test('[run] a near filter or sort on a field that is not a vector is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          filter: { on: T, near: { kind: { to: [1, 0, 0] } } },
        }),
        'needs-declaration',
        'a near filter on a text field',
      );
      isRefusedWith(
        assert,
        await run({ sort: [{ on: T, by: 'price', near: [1, 0, 0] }] }),
        'needs-declaration',
        'a near sort on a number field',
      );
      isRefusedWith(
        assert,
        await run({
          filter: { type: T },
          sort: [
            {
              by: '_blend',
              of: [{ on: T, by: 'title', near: [1, 0, 0] }],
            } as any,
          ],
        }),
        'needs-declaration',
        'a near signal in a blend on a text field',
      );
    });

    test('[run] a relevance sort near a vector, on a type with no vector field, is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          type: noteRef,
          filter: { matches: 'lamp' },
          sort: [{ relevance: true, near: [1, 0, 0] }],
        }),
        'needs-declaration',
        'the newer spelling',
      );
    });

    test('[run] look-alikes by a vector field with no neighbor index declared is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          type: T,
          sort: [
            {
              expression: 'COUNT(peers.price)',
              compare: { near: 'embedding', k: 2 },
            },
          ],
        }),
        'needs-declaration',
        'compare.near',
      );
    });

    test('[run] a relevance sort near a vector with no type anywhere is needs-type', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          filter: { matches: 'lamp' },
          sort: [{ relevance: true, near: [1, 0, 0] }],
        }),
        'needs-type',
        'no type, no anchor',
      );
    });
  });
});
