import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import {
  InvalidQueryError,
  assertQuery,
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
  type Query,
} from '@cardstack/runtime-common';
import { testRealm } from './helpers/index.ts';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for expression sorts, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search } = shared;
  let engine: IndexQueryEngine;
  hooks.beforeEach(function () {
    ({ engine } = shared);
  });

  test('an _expr sort ranks by a spreadsheet formula', async function (assert) {
    let titles = async (sort: any, extra: any = {}) =>
      (await search({ filter: { type: on }, sort, ...extra })).titles;
    assert.deepEqual(
      await titles([{ by: '_expr', on, expr: '100 - hnScore' }]),
      ['g', 'f', 'a', 'c', 'b', 'e', 'd'],
      'highest value first',
    );
    assert.deepEqual(
      await titles([
        { by: '_expr', on, expr: 'hnScore / MAX(DAYS(NOW(), published), 1)' },
      ]),
      ['e', 'a', 'f', 'b', 'g', 'c', 'd'],
      'score per day since publishing; as in Excel, MAX skips a missing date',
    );
    assert.deepEqual(
      await titles([
        { by: '_expr', on, expr: 'IF(hnScore >= 30, 1, 0)' },
        { on, by: 'hnScore', direction: 'asc' },
      ]),
      ['b', 'e', 'd', 'g', 'f', 'a', 'c'],
      'a then-by sort breaks its ties',
    );
    assert.deepEqual(
      await titles([{ by: '_expr', on, expr: 'hnScore' }], {
        collapse: { by: 'channel', on },
        page: { number: 0, size: 2 },
      }),
      ['d', 'b'],
      'it orders a collapsed, paged search too',
    );
  });

  test('an _expr signal blends, and explain names its formula', async function (assert) {
    let { results } = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        explain: true,
        sort: [
          {
            by: '_blend',
            of: [
              { by: '_expr', on, expr: 'IFERROR(100 / hnScore, 0)', weight: 2 },
              { on, by: 'hnScore' },
            ],
          },
        ],
      },
      {},
      { kind: 'renderSet' },
    );
    let first = results[0] as any;
    assert.strictEqual(
      first.url,
      `${testRealm}Talk/g.json`,
      'the formula leads',
    );
    assert.deepEqual(first._explain.signals[0], {
      signal: 'IFERROR(100 / hnScore, 0)',
      weight: 2,
      value: 100,
      rank: 1,
      contribution: 2 / 61,
    });
  });

  test('a formula outside the score profile is refused, and formula travels the wire', function (assert) {
    assert.throws(
      () => assertQuery({ sort: [{ by: '_expr', on, expr: 'LEN(title)' }] }),
      (err: unknown) =>
        err instanceof InvalidQueryError &&
        /expression: LEN is not part of the score profile/.test(err.message),
    );
    assert.throws(
      () =>
        assertQuery({
          sort: [{ by: '_expr', on, expr: 'rating', near: [1] }],
        } as any),
      /unknown expression sort member "near"/,
    );
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      sort: [{ expression: 'rating / LN(priceMin + 1)' }],
    });
    assert.deepEqual((parsed.itemQuery.sort as any)[0], {
      by: '_expr',
      expr: 'rating / LN(priceMin + 1)',
      on,
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.strictEqual(
      (wire.sort as any)[0].expression,
      'rating / LN(priceMin + 1)',
    );
    assert.throws(
      () =>
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          sort: [{ by: 'item._expr', expr: 'rating' }],
        }),
      /is not a sort key/,
      'the engine form is not part of the request grammar',
    );
  });
  test('a formula that overflows in SQL is refused with limit-exceeded', async function (assert) {
    let plain = await search({
      filter: { type: on },
      sort: [{ by: '_expr', expr: 'hnScore * 2', direction: 'desc' }],
    } as Query);
    assert.ok(plain.titles.length > 0, 'a formula in range answers');
    // 1e300 squared is past a double: Postgres raises, and there is nowhere
    // else an expression runs
    await assert.rejects(
      search({
        filter: { type: on },
        sort: [
          {
            by: '_expr',
            expr: 'IF(hnScore > 25, 1e300 * 1e300, hnScore)',
            direction: 'desc',
          },
        ],
        facets: [{ by: 'channel', measure: { max: 'hnScore' } }],
      } as Query),
      (e: any) =>
        e instanceof InvalidQueryError &&
        e.code === 'limit-exceeded' &&
        /overflows/.test(e.message),
    );
  });
});
