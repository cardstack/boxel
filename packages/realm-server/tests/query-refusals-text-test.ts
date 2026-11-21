import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  type UnknownMember,
  acceptedTests,
  f,
  kind,
  many,
  on,
  table,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for text search. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // matches and its options
  ...[3, null, {}, ['lamp'], true].map((v) => ({
    name: `matches: ${JSON.stringify(v)}`,
    query: f({ matches: v }),
    code: 'invalid-value',
  })),
  ...['yes', 1, null].map((v) => ({
    name: `prefix: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', prefix: v }),
    code: 'invalid-value',
  })),
  ...['body', 3, null, ['title']].map((v) => ({
    name: `scope: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', scope: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'a.b', ''].map((v) => ({
    name: `within: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', within: v }),
    code: 'invalid-value',
  })),
  ...['title', 3, null, [3], [null]].map((v) => ({
    name: `fields: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', fields: v }),
    code: 'invalid-value',
  })),
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'scope and within on one matches',
    query: f({ matches: 'lamp', scope: 'title', within: 'segments' }),
    code: 'conflicting-members',
  },
  ...(
    [
      ['scope', 'title'],
      ['within', 'segments'],
      ['prefix', true],
    ] as [string, unknown][]
  ).map(([option, v]) => ({
    name: `matches with fields and ${option}`,
    query: f({ matches: 'lamp', fields: ['title'], [option]: v }),
    code: 'conflicting-members',
  })),
];

const LIMITS: Mistake[] = [
  {
    name: 'nine fields beside matches',
    query: f({ matches: 'lamp', fields: many(9, (i) => `f${i}`) }),
    code: 'limit-exceeded',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a filter',
    newer: f({ ...kind, prefx: true }),
    unknown: 'prefx',
    nearest: 'prefix',
    older: { filter: { on, ...kind, prefx: true } },
    olderIs: 'ignored',
  },
  {
    level: 'a filter inside not',
    newer: f({ not: { ...kind, scpe: 'title' } }),
    unknown: 'scpe',
    nearest: 'scope',
    older: { filter: { on, not: { ...kind, scpe: 'title' } } },
    olderIs: 'ignored',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'eight fields beside matches',
    f({ matches: 'lamp', fields: many(8, (i) => `f${i}`) }),
  ],
  ['a term of punctuation', f({ matches: `'; DROP TABLE boxel_index; --` })],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });
});
