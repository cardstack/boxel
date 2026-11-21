import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  type Mistake,
  type Q,
  T,
  type UnknownMember,
  f,
  isRefusedWith,
  kind,
  on,
  setupRefusalIndex,
  table,
  unknownMemberTests,
  viaAssert,
  viaWire,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for typos, patterns and type-ahead.
// See query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // `typeahead` is gone: type-ahead is `{ matches, prefix: true, scope:
  // 'title' }`. Refused in both spellings, on the wire, and wherever a filter
  // goes, whatever its value.
  ...['lam', 3, null, {}, ['lam']].map((v) => ({
    name: `typeahead: ${JSON.stringify(v)}`,
    query: f({ typeahead: v }),
    code: 'unknown-key',
  })),
  {
    name: 'typeahead in the older spelling',
    query: { filter: { on: T, typeahead: 'lam' } },
    wire: { filter: { 'item.on': T, typeahead: 'lam' } },
    code: 'unknown-key',
  },
  {
    name: 'typeahead under any',
    query: f({ any: [{ typeahead: 'lam' }, { eq: { kind: 'lamp' } }] }),
    code: 'unknown-key',
  },
  {
    name: 'typeahead under not',
    query: f({ not: { typeahead: 'lam' } }),
    code: 'unknown-key',
  },
  {
    name: 'typeahead beside typos',
    query: f({ typeahead: 'lam', typos: true }),
    code: 'unknown-key',
  },
  ...['yes', 1, null].map((v) => ({
    name: `typos: ${JSON.stringify(v)} beside matches`,
    query: f({ matches: 'lamp', typos: v }),
    code: 'invalid-value',
  })),
  {
    name: 'typos: "yes" beside a type-ahead matches',
    query: f({ matches: 'lam', prefix: true, scope: 'title', typos: 'yes' }),
    code: 'invalid-value',
  },
  // pattern, regex
  ...(['pattern', 'regex'] as const).flatMap((op) => [
    ...['LMP-*', 3, null, ['LMP-*']].map((v) => ({
      name: `${op}: ${JSON.stringify(v)}`,
      query: f({ [op]: v }),
      code: 'invalid-value',
    })),
    ...[3, null, {}, ['a'], ''].map((v) => ({
      name: `${op}: a field's value is ${JSON.stringify(v)}`,
      query: f({ [op]: { sku: v } }),
      code: 'invalid-value',
    })),
    {
      name: `${op}: no field`,
      query: f({ [op]: {} }),
      code: 'missing-member',
    },
  ]),
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'matches and typeahead in one filter',
    query: f({ matches: 'lamp', typeahead: 'lam' }),
    code: 'unknown-key',
  },
  {
    name: 'pattern and regex in one filter',
    query: f({ pattern: { sku: 'L*' }, regex: { sku: '^L' } }),
    code: 'conflicting-members',
  },
  ...(
    [
      ['typos', true, { eq: { kind: 'lamp' } }],
      ['typos', true, { pattern: { sku: 'L*' } }],
      ['typos', true, { range: { price: { gt: 1 } } }],
      ['prefix', true, { contains: { kind: 'la' } }],
      ['scope', 'title', { eq: { kind: 'lamp' } }],
      ['within', 'segments', { eq: { kind: 'lamp' } }],
      ['fields', ['title'], { eq: { kind: 'lamp' } }],
      ['fields', ['title'], { matches: 'lam', prefix: true }],
    ] as [string, unknown, Q][]
  ).map(([option, v, filter]) => ({
    name: `${option} beside ${Object.keys(filter)[0]}`,
    query: f({ ...filter, [option]: v }),
    code: 'conflicting-members',
  })),
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a filter inside any',
    newer: f({ any: [kind, { matches: 'lamp', typoes: true }] }),
    unknown: 'typoes',
    nearest: 'typos',
    older: {
      filter: {
        any: [
          { on, ...kind },
          { on, matches: 'lamp', typoes: true },
        ],
      },
    },
    olderIs: 'ignored',
  },
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    test('[validation] a field name wrapped in brackets is invalid-value in a filter', function (assert) {
      for (let op of ['eq', 'in', 'contains', 'pattern', 'regex']) {
        let value = op === 'in' ? ['x'] : 'x';
        isRefusedWith(
          assert,
          viaAssert(f({ [op]: { '[kind]': value } })),
          'invalid-value',
          `${op}, assertQuery`,
        );
        isRefusedWith(
          assert,
          viaWire(f({ [op]: { '[kind]': value } })),
          'invalid-value',
          `${op}, the wire`,
        );
      }
    });
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { run } = shared;

    test('[run] a pattern or a regex on a field not searched by pattern is needs-declaration', async function (assert) {
      for (let query of [
        { filter: { on: T, pattern: { memo: 'LMP-*' } } },
        { filter: { on: T, regex: { memo: '^LMP' } } },
        { filter: { on: T, pattern: { title: 'Brass*' } } },
        { filter: { on: T, not: { regex: { kind: '^lamp$' } } } },
        {
          filter: {
            on: T,
            every: [
              { on: T, eq: { kind: 'lamp' } },
              { any: [{ on: T, pattern: { memo: '*' } }] },
            ],
          },
        },
      ]) {
        isRefusedWith(
          assert,
          await run(query),
          'needs-declaration',
          JSON.stringify(query.filter).slice(0, 80),
        );
      }
      // the declared field beside it runs
      assert.deepEqual(
        (await run({ filter: { on: T, pattern: { sku: 'lmp-*' } } })).names,
        ['one', 'two'],
      );
    });
  });
});
