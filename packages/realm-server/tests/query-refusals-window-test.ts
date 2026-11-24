import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  type UnknownMember,
  acceptedTests,
  s,
  table,
  top,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for expression windows. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // `placement` is gone: every expression runs in SQL
  ...['sql', 'top', 'gpu', 3, null].map((v) => ({
    name: `an expression's placement is ${JSON.stringify(v)}`,
    query: s([{ expression: 'price * 2', placement: v }]),
    code: 'unknown-key',
  })),
  {
    name: 'an expression with top that is not the first sort entry',
    query: s([{ by: 'price' }, { expression: 'price', top: 5 }]),
    code: 'expression-placement',
  },
  // `rerank` is gone: re-ranking is a sort entry with top
  ...['price', { expression: 'price' }, { expression: 'price', top: 5 }].map(
    (v) => ({
      name: `a top-level rerank: ${JSON.stringify(v)}`,
      query: top({ rerank: v }),
      code: 'unknown-key',
    }),
  ),
  // a window (an expression sort entry with top or compare)
  ...[3, null, '', '  ', ['price']].map((v) => ({
    name: `window expression: ${JSON.stringify(v)}`,
    query: s([{ expression: v, top: 5 }]),
    code: 'invalid-expression',
  })),
  ...[0, -1, 501, 1.5, '50', null].map((v) => ({
    name: `window top: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', top: v }]),
    code: 'invalid-value',
  })),
  ...['up', 1, null].map((v) => ({
    name: `window direction: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', top: 5, direction: v }]),
    code: 'invalid-value',
  })),
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a window',
    newer: s([{ expression: 'price', top: 5, topp: 5 }]),
    unknown: 'topp',
    nearest: 'top',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  ['a window of the top 500', s([{ expression: 'price', top: 500 }])],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });
});
