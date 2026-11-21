import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  type UnknownMember,
  acceptedTests,
  f,
  on,
  s,
  table,
  top,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for relevance and explain. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  ...['high', null, [1]].map((v) => ({
    name: `a relevance weight is ${JSON.stringify(v)}`,
    query: s([{ relevance: { text: v } }], { filter: { matches: 'lamp' } }),
    code: 'invalid-value',
  })),
  {
    name: 'a relevance signal that does not exist',
    query: s([{ relevance: { txt: 1 } }], { filter: { matches: 'lamp' } }),
    code: 'unknown-key',
  },
  ...['x', 3, {}].map((v) => ({
    name: `a relevance sort's near is ${JSON.stringify(v)}`,
    query: s([{ relevance: true, near: v }], { filter: { matches: 'lamp' } }),
    code: 'invalid-value',
  })),
  // explain, type
  ...['yes', 1, null].map((v) => ({
    name: `explain: ${JSON.stringify(v)}`,
    query: top({ explain: v }),
    code: 'invalid-value',
  })),
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a text-relevance sort entry',
    newer: f(
      { matches: 'lamp' },
      { sort: [{ by: 'textRelevance', wieght: 2 }] },
    ),
    unknown: 'wieght',
    nearest: 'weight',
    older: {
      filter: { on, matches: 'lamp' },
      sort: [{ by: '_matchRelevance', wieght: 2 }],
    },
    olderIs: 'ignored',
  },
  {
    level: 'a relevance sort',
    newer: f(
      { matches: 'lamp' },
      { sort: [{ relevance: true, directon: 'asc' }] },
    ),
    unknown: 'directon',
    nearest: 'direction',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'a negative and a zero weight in a relevance sort',
    f(
      { matches: 'lamp' },
      { sort: [{ relevance: { text: -1, popularity: 0 } }] },
    ),
  ],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });
});
