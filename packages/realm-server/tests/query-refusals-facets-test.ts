import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexQueryEngine,
  VirtualNetwork,
  type DBAdapter,
} from '@cardstack/runtime-common';
import {
  INHERITED_NAMES,
  type Mistake,
  type Outcome,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  isRefusedWith,
  kind,
  many,
  on,
  setupRefusalIndex,
  table,
  top,
  unknownMemberTests,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for facet counts. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // facets
  ...[{}, 'kind', 3, null].map((v) => ({
    name: `facets: ${JSON.stringify(v)}`,
    query: top({ facets: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'kind', ['kind'], {}].map((v) => ({
    name: `a facet is ${JSON.stringify(v)}`,
    query: top({ facets: [v] }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], ''].map((v) => ({
    name: `facet by: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: v }] }),
    code: 'invalid-value',
  })),
  ...[0, -1, 1001, 1.5, '5', null].map((v) => ({
    name: `facet size: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'kind', size: v }] }),
    code: 'invalid-value',
  })),
];

const LIMITS: Mistake[] = [
  {
    name: 'nine facets',
    query: top({ facets: many(9, (i) => ({ by: `f${i}` })) }),
    code: 'limit-exceeded',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a facet',
    newer: top({ facets: [{ by: 'kind', sizee: 5 }] }),
    unknown: 'sizee',
    nearest: 'size',
    older: { filter: { on, ...kind }, facets: [{ by: 'kind', sizee: 5 }] },
    olderIs: 'refused',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  ['eight facets', top({ facets: many(8, (i) => ({ by: `f${i}` })) })],
  ['a facet of 1,000 values', top({ facets: [{ by: 'kind', size: 1000 }] })],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { makeDefinitionLookup, run } = shared;

    test('[run] an inherited name in a facet is unknown-field', async function (assert) {
      // docs/search.md (Refusals): a facet's `by` the type does not declare
      // is unknown-field when no card of the type holds a value there, as a
      // filter or a sort on it is. No card holds a value at these names.
      for (let name of [...INHERITED_NAMES, 'nope']) {
        let got = await run({
          filter: { type: T },
          facets: [{ by: name }],
        });
        isRefusedWith(assert, got, 'unknown-field', `facet by ${name}`);
      }
    });

    // The SQLite index runs only in the browser tests (which show its
    // answers). These go through the engine with an adapter that says it is
    // SQLite and answers every statement with no rows: what SQLite lacks is
    // approximated and named in `meta.warnings`, never refused
    // (docs/search.md, "On SQLite"), while an invalid query is still refused.
    test('[run] features the SQLite index cannot run are approximated, not refused', async function (assert) {
      let asked: string[] = [];
      let sqlite = {
        kind: 'sqlite',
        isClosed: false,
        async execute(sql: string) {
          asked.push(sql);
          return [];
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
      } as unknown as DBAdapter;
      let browserEngine = new IndexQueryEngine(
        sqlite,
        makeDefinitionLookup(),
        new VirtualNetwork(),
      );
      let notRefused = (
        got: Outcome & { meta?: any },
        rule: string,
        code: string | undefined,
      ) =>
        assert.deepEqual(
          [
            got.kind,
            (got.meta?.warnings ?? []).map((w: { code: string }) => w.code),
          ],
          ['ran', code ? [code] : []],
          `${rule}: ${got.message}`,
        );
      notRefused(
        await run({ filter: { on: T, regex: { sku: '^LMP' } } }, browserEngine),
        'a regex filter',
        'sqlite-regex-as-pattern',
      );
      notRefused(
        await run(
          { filter: { on: T, not: { regex: { sku: '[LM]P' } } } },
          browserEngine,
        ),
        'a regex under not',
        'sqlite-regex-dropped',
      );
      let plans = await browserEngine.planColumns(T, [
        { name: 'kind', path: 'kind' },
      ]);
      assert.deepEqual(
        plans.map((p) => p.segments),
        [['kind']],
        'select is planned',
      );
      notRefused(
        await run(
          { type: T, sort: [{ expression: 'price * 2' }] },
          browserEngine,
        ),
        'an expression sort',
        'sqlite-formula-sort-dropped',
      );
      notRefused(
        await run({ type: T, facets: [{ by: 'kind' }] }, browserEngine),
        'a facet, counted from the rows read',
        undefined,
      );
      assert.true(asked.length > 0, 'each ran its statements');
      isRefusedWith(
        assert,
        await run({ filter: { on: T, regex: { sku: '(' } } }, browserEngine),
        'invalid-value',
        'a regex that is no regular expression',
      );
      isRefusedWith(
        assert,
        await run(
          { filter: { on: T, regex: { nope: '[ab]' } } },
          browserEngine,
        ),
        'unknown-field',
        'a regex on a field the type lacks, left out on SQLite',
      );
    });
  });
});
