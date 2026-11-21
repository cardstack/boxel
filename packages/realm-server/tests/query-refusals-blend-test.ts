import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  kind,
  many,
  s,
  table,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for blends and boosts. See
// query-refusals-test.ts for how a row is read.

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    name: 'a field sort inside a blend with no type anywhere',
    query: { sort: [{ blend: [{ by: 'price' }] }] },
    code: 'sort-needs-type',
  },
];

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // blend, boost, relevance
  ...['heavy', null, '2'].map((v) => ({
    name: `a blend signal's weight is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price', weight: v }] }]),
    code: 'invalid-value',
  })),
  ...[0, -1, '60', null].map((v) => ({
    name: `a blend's k is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price' }], k: v }]),
    code: 'invalid-value',
  })),
  ...['sum', 3, null].map((v) => ({
    name: `a blend's method is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price' }], method: v }]),
    code: 'invalid-value',
  })),
  {
    name: 'a blend of nothing',
    query: s([{ blend: [] }]),
    code: 'missing-member',
  },
  ...['price', 3].map((v) => ({
    name: `blend: ${JSON.stringify(v)}`,
    query: s([{ blend: v }]),
    code: 'invalid-value',
  })),
  ...[null, 3, 'lamp'].map((v) => ({
    name: `boost: ${JSON.stringify(v)}`,
    query: s([{ blend: [{ boost: v }] }]),
    code: 'missing-member',
  })),
  {
    name: 'a blend signal with top',
    query: s([{ blend: [{ expression: 'price', top: 5 }] }]),
    code: 'invalid-nesting',
  },
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'a blend with a type of its own',
    query: s([{ blend: [{ by: 'price' }], on: T }]),
    wire: s([{ blend: [{ by: 'price' }], 'item.on': T }]),
    // "Its members are blend, method, k and direction; any other is refused"
    code: 'unknown-key',
  },
];

const LIMITS: Mistake[] = [
  {
    name: 'nine signals in a blend',
    query: s([{ blend: many(9, (i) => ({ by: `f${i}` })) }]),
    code: 'limit-exceeded',
  },
  {
    name: 'nine signals in a blend, eight of them boosts',
    query: s([
      {
        blend: [
          { by: 'price' },
          ...many(8, (i) => ({ boost: { eq: { kind: `k${i}` } } })),
        ],
      },
    ]),
    code: 'limit-exceeded',
  },
  {
    name: 'a blend inside a blend',
    query: s([{ blend: [{ blend: [{ by: 'price' }] }] }]),
    code: 'invalid-nesting',
  },
  {
    name: 'a relevance sort inside a blend',
    query: s([{ blend: [{ relevance: true }] }], {
      filter: { matches: 'lamp' },
    }),
    code: 'invalid-nesting',
  },
  {
    name: 'a boost outside a blend',
    query: s([{ boost: { eq: { kind: 'lamp' } }, weight: 2 }]),
    code: 'invalid-nesting',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a blend',
    newer: s([{ blend: [{ by: 'price' }], fusion: 'rrf' }]),
    unknown: 'fusion',
    nearest: 'method',
  },
  {
    level: 'a blend, a near miss',
    newer: s([{ blend: [{ by: 'price' }], methd: 'rrf' }]),
    unknown: 'methd',
    nearest: 'method',
  },
  {
    level: 'a signal inside a blend',
    newer: s([{ blend: [{ by: 'price', wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: 'a near signal inside a blend',
    newer: s([{ blend: [{ by: 'embedding', near: [1, 0], wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: 'a boost',
    newer: s([{ blend: [{ boost: kind, wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: "a boost's filter",
    newer: s([{ blend: [{ boost: { ...kind, prefx: true }, weight: 2 }] }]),
    unknown: 'prefx',
    nearest: 'prefix',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'eight signals in a blend',
    s([{ blend: many(8, (i) => ({ by: `f${i}` })) }]),
  ],
  [
    'a negative weight in a blend (it inverts the signal)',
    s([{ blend: [{ by: 'price', weight: -1 }] }]),
  ],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });
});
