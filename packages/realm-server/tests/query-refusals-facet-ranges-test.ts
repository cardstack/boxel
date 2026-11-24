import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  MALFORMED_PATHS,
  type Mistake,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  binding,
  f,
  isRefusedWith,
  kind,
  many,
  on,
  s,
  table,
  top,
  unknownMemberTests,
  usingA,
  viaAssert,
  viaWire,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for facet ranges and measures. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  ...(
    [
      ['own', true],
      ['own', 'keep'],
      ['stats', 'yes'],
      ['stats', 1],
      ['missing', 'yes'],
      ['prefix', 3],
      ['prefix', ['la']],
      ['order', 'alpha'],
      ['order', 1],
      ['interval', 'hour'],
      ['interval', 3],
      ['measure', 'price'],
      ['measure', { avg: 3 }],
      ['measure', { median: 'price' }],
      ['measure', { avg: 'price', max: 'price' }],
      ['measure', {}],
      ['measure', { avg: 'a..b' }],
    ] as [string, unknown][]
  ).map(([member, v]) => ({
    name: `facet ${member}: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'kind', [member]: v }] }),
    code: 'invalid-value',
  })),
  ...[{}, 'cheap', 3].map((v) => ({
    name: `facet ranges: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: v }] }),
    code: 'invalid-value',
  })),
  ...[3, null, 'cheap', [0, 10]].map((v) => ({
    name: `a facet range is ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [v] }] }),
    code: 'invalid-value',
  })),
  ...[null, true, [1], {}].map((v) => ({
    name: `a facet range's bound is ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [{ from: v }] }] }),
    code: 'invalid-value',
  })),
  ...[NaN, Infinity, -Infinity].map((v) => ({
    name: `a facet range's bound is ${String(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [{ to: v }] }] }),
    wire: false,
    code: 'invalid-value',
  })),
  {
    name: 'a facet range with a key that is not text',
    query: top({ facets: [{ by: 'price', ranges: [{ to: 10, key: 3 }] }] }),
    code: 'invalid-value',
  },
  {
    name: 'a facet range with neither end',
    query: top({ facets: [{ by: 'price', ranges: [{ key: 'all' }] }] }),
    code: 'missing-member',
  },
  {
    name: 'a facet ordered by a measure it does not have',
    query: top({ facets: [{ by: 'kind', order: 'measure' }] }),
    code: 'missing-member',
  },
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'a facet with ranges and an interval',
    query: top({
      facets: [{ by: 'price', ranges: [{ to: 10 }], interval: 'month' }],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet with a measure and ranges',
    query: top({
      facets: [
        { by: 'price', measure: { avg: 'price' }, ranges: [{ to: 10 }] },
      ],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet with a measure and an interval',
    query: top({
      facets: [{ by: 'kind', measure: { avg: 'price' }, interval: 'month' }],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet range from a number to a word',
    query: top({ facets: [{ by: 'price', ranges: [{ from: 1, to: 'z' }] }] }),
    code: 'conflicting-members',
  },
];

const LIMITS: Mistake[] = [
  {
    name: 'fifty-one ranges in a facet',
    query: top({
      facets: [{ by: 'price', ranges: many(51, (i) => ({ to: i + 1 })) }],
    }),
    code: 'limit-exceeded',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: "a facet's range",
    newer: top({ facets: [{ by: 'price', ranges: [{ form: 1, to: 5 }] }] }),
    unknown: 'form',
    nearest: 'from',
    older: {
      filter: { on, ...kind },
      facets: [{ by: 'price', ranges: [{ form: 1, to: 5 }] }],
    },
    olderIs: 'refused',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'fifty ranges in a facet',
    top({
      facets: [{ by: 'price', ranges: many(50, (i) => ({ to: i + 1 })) }],
    }),
  ],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    // select exists only on the wire: it answers a table, which a card's own
    // search has no use for.
    const selecting = (select: unknown, more: Q = {}) =>
      viaWire({ type: T, select, ...more });
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);

    test('[validation] a path that is not a field path is invalid-value wherever a path is checked', function (assert) {
      // A facet's `by`, a collapse's `by`, a binding's `select`, the fields
      // beside `matches`, a comparison's `by`, a `linkedFrom` field and a
      // select column are each checked as a path when the query is read.
      for (let path of MALFORMED_PATHS) {
        let shown = JSON.stringify(path);
        let places: [string, Q, boolean][] = [
          ['facet by', top({ facets: [{ by: path }] }), true],
          ['collapse by', top({ collapse: { by: path } }), true],
          ['a bare collapse', top({ collapse: path }), path !== ''],
          [
            "a binding's select",
            top({ let: { $a: { ...binding, select: path } }, filter: usingA }),
            true,
          ],
          ['matches fields', f({ matches: 'lamp', fields: [path] }), true],
          [
            "a comparison's by",
            s([{ expression: 'price', compare: { by: path } }]),
            path !== '',
          ],
          [
            "a facet measure's field",
            top({ facets: [{ by: 'kind', measure: { avg: path } }] }),
            true,
          ],
          [
            'linkedFrom field',
            f({ linkedFrom: { card: 'http://a.test/W/1', field: path } }),
            true,
          ],
        ];
        for (let [place, query, checked] of places) {
          if (!checked) continue;
          isRefusedWith(
            assert,
            viaAssert(query),
            'invalid-value',
            `${place} ${shown}, assertQuery`,
          );
          isRefusedWith(
            assert,
            viaWire(query),
            'invalid-value',
            `${place} ${shown}, the wire`,
          );
        }
        isRefusedWith(
          assert,
          selecting([path]),
          'invalid-value',
          `select ${shown}`,
        );
        isRefusedWith(
          assert,
          selecting([{ label: path }]),
          'invalid-value',
          `select, renamed, ${shown}`,
        );
      }
    });
  });
});
