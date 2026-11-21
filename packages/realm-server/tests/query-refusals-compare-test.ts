import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type UnknownMember,
  s,
  table,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for comparison sets. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  {
    name: 'peers. in an expression sort with no top',
    query: s([{ expression: 'price / stats.price.median' }]),
    code: 'expression-placement',
  },
  {
    name: 'arithmetic on a peers list',
    query: s([{ expression: 'peers.price * 2', compare: { by: 'kind' } }]),
    code: 'expression-unsupported',
  },
  ...(
    [
      3,
      null,
      'kind',
      [],
      { by: 3 },
      { by: 'a..b' },
      { near: 3 },
      { near: 'a b' },
      { k: 5 },
      { minSimilarity: 0.5 },
      { near: 'embedding', k: 0 },
      { near: 'embedding', k: 101 },
      { near: 'embedding', k: 1.5 },
      { near: 'embedding', minSimilarity: 2 },
      { near: 'embedding', minSimilarity: 'high' },
    ] as unknown[]
  ).map((v) => ({
    name: `window compare: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', compare: v }]),
    code: 'invalid-value',
  })),
  ...[3, 'lamp', []].map((v) => ({
    name: `window compare filter: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', compare: { filter: v } }]),
    code: Array.isArray(v) ? 'invalid-value' : 'missing-member',
  })),
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'a comparison by a field and by look-alikes at once',
    query: s([
      { expression: 'price', compare: { near: 'embedding', by: 'kind' } },
    ]),
    code: 'conflicting-members',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: "a window's comparison",
    newer: s([{ expression: 'price', compare: { bye: 'kind' } }]),
    unknown: 'bye',
    nearest: 'by',
  },
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);

    unknownMemberTests(UNKNOWN_MEMBERS);
  });
});
