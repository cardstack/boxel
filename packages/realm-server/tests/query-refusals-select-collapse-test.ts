import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import {
  INHERITED_NAMES,
  type Mistake,
  type Outcome,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  describeError,
  isRefusedWith,
  kind,
  many,
  on,
  setupRefusalIndex,
  table,
  top,
  unknownMemberTests,
  viaAssert,
  viaWire,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for select and collapse. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // collapse
  ...[3, null, ['kind'], true, {}].map((v) => ({
    name: `collapse: ${JSON.stringify(v)}`,
    query: top({ collapse: v }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], ''].map((v) => ({
    name: `collapse by: ${JSON.stringify(v)}`,
    query: top({ collapse: { by: v } }),
    code: 'invalid-value',
  })),
  ...[0, -1, 11, 1.5, '2', null].map((v) => ({
    name: `collapse keep: ${JSON.stringify(v)}`,
    query: top({ collapse: { by: 'kind', keep: v } }),
    code: 'invalid-value',
  })),
  ...['Listing', 3, {}].map((v) => ({
    name: `a collapse's on is ${JSON.stringify(v)}`,
    query: top({ collapse: { by: 'kind', on: v } }),
    wire: top({ collapse: { by: 'kind', 'item.on': v } }),
    code: 'invalid-type',
  })),
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a collapse',
    newer: top({ collapse: { by: 'kind', kep: 2 } }),
    unknown: 'kep',
    nearest: 'keep',
    older: { filter: { on, ...kind }, collapse: { by: 'kind', on, kep: 2 } },
    olderIs: 'refused',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  ['a collapse keeping ten', top({ collapse: { by: 'kind', keep: 10 } })],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    // select exists only on the wire: it answers a table, which a card's own
    // search has no use for.
    const selecting = (select: unknown, more: Q = {}) =>
      viaWire({ type: T, select, ...more });
    table('a wrong kind of value', WRONG_KIND);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);

    test('[validation] select: a wrong kind of value is invalid-value', function (assert) {
      for (let select of [
        'kind',
        3,
        null,
        {},
        [],
        [3],
        [null],
        [['kind']],
        [{}],
        [{ a: 'kind', b: 'price' }],
        [{ label: 3 }],
        [{ label: null }],
      ]) {
        isRefusedWith(
          assert,
          selecting(select),
          'invalid-value',
          `select: ${JSON.stringify(select)}`,
        );
      }
    });

    test('[validation] select: limits and clashes', function (assert) {
      isRefusedWith(
        assert,
        selecting(many(65, (i) => `f${i}`)),
        'limit-exceeded',
        '65 columns',
      );
      assert.strictEqual(
        selecting(many(64, (i) => `f${i}`)).kind,
        'accepted',
        '64 columns',
      );
      isRefusedWith(
        assert,
        selecting(['kind', 'kind']),
        'conflicting-members',
        'one name twice',
      );
      isRefusedWith(
        assert,
        selecting(['kind', { kind: 'price' }]),
        'conflicting-members',
        'a renamed column taking another column’s name',
      );
      isRefusedWith(
        assert,
        selecting(['id']),
        'conflicting-members',
        'a column named id, which every row starts with',
      );
      isRefusedWith(
        assert,
        selecting(['kind'], { fields: { entry: ['item'] } }),
        'select-excludes-fields',
        'select beside fields',
      );
    });

    test('[validation] a card search has no select', function (assert) {
      // pins current behavior; rule not yet decided: the docs list `select`
      // among a query's members, and say it "answers a query as a table".
      // `assertQuery`, which checks a card's own search, has no such member.
      isRefusedWith(
        assert,
        viaAssert({ type: T, select: ['kind'] }),
        'unknown-key',
        'assertQuery',
      );
    });
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { run } = shared;
    let engine: IndexQueryEngine;
    hooks.before(function () {
      ({ engine } = shared);
    });

    test('[run] a collapse with no type anywhere is needs-type', async function (assert) {
      isRefusedWith(
        assert,
        await run({ collapse: 'kind' }),
        'needs-type',
        'a bare path',
      );
      isRefusedWith(
        assert,
        await run({ filter: { matches: 'lamp' }, collapse: { by: 'kind' } }),
        'needs-type',
        'beside an unanchored filter',
      );
      let anchored = await run({ filter: { type: T }, collapse: 'kind' });
      assert.strictEqual(
        anchored.names?.length,
        2,
        `with the filter's anchor it runs: one per kind (${anchored.message})`,
      );
    });

    test('[run] an inherited name as a select column is unknown-field', async function (assert) {
      for (let name of [...INHERITED_NAMES, 'nope', 'kind.constructor']) {
        let got: Outcome;
        try {
          await engine.planColumns(T, [{ name, path: name }]);
          got = {
            refused: false,
            kind: 'planned',
            code: undefined,
            message: '',
          };
        } catch (e) {
          got = describeError(e);
        }
        isRefusedWith(assert, got, 'unknown-field', `select ${name}`);
      }
      let plans = await engine.planColumns(T, [{ name: 'kind', path: 'kind' }]);
      assert.strictEqual(plans.length, 1, 'a real field plans');
    });
  });
});
