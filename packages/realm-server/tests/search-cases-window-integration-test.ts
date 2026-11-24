import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import {
  InvalidQueryError,
  setCompareRowLimitForTests,
  hasWarning,
  type Query,
} from '@cardstack/runtime-common';
import { testRealm } from './helpers/index.ts';
import { setupTalkCorpus, url } from './helpers/talk-corpus.ts';

// Search cases for expression windows, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, byScore, reranked, byScoreDesc } = shared;
  let engine: IndexQueryEngine;
  hooks.beforeEach(function () {
    ({ engine } = shared);
  });

  test('an expression with top orders the top of a result', async function (assert) {
    // The talks scored 10 to 30 first (b, c, a), each group keeping the
    // query order.
    let { rows, meta } = await reranked({
      filter: { type: on },
      sort: [
        { expression: 'IF(AND(hnScore >= 10, hnScore <= 30), 1, 0)', top: 100 },
        ...byScoreDesc,
      ],
    });
    assert.deepEqual(
      rows.map((r) => r[0]),
      ['b', 'c', 'a', 'd', 'e', 'f', 'g'],
      'matching rows lead, each group keeping the query order',
    );
    // every talk gets a value
    assert.deepEqual(meta.window, { rows: 7, scored: 7 });
    assert.strictEqual(meta.page.total, 7);

    let windowed = await reranked({
      filter: { type: on },
      sort: [{ expression: '100 - hnScore', top: 4 }, ...byScoreDesc],
      page: { number: 0, size: 3 },
    });
    assert.deepEqual(
      windowed.rows,
      [
        ['c', 80],
        ['b', 70],
        ['e', 60],
      ],
      'only the first four are re-ranked, lowest score first',
    );
    let past = await reranked({
      filter: { type: on },
      sort: [{ expression: '100 - hnScore', top: 4 }, ...byScoreDesc],
      page: { number: 1, size: 4 },
    });
    assert.deepEqual(
      past.rows.map((r) => r[0]),
      ['a', 'f', 'g'],
      'a page past the window keeps the query order',
    );
  });

  test('a reranked page keeps what the query computed for each row', async function (assert) {
    let page = async (query: Record<string, any>, opts = {}) =>
      (
        await engine.search(new URL(testRealm), query as Query, opts, {
          kind: 'renderSet',
        })
      ).results as Record<string, any>[];
    let rows = await page(
      {
        filter: { type: on },
        explain: true,
        sort: [
          { expression: '100 - hnScore', top: 4 },
          { blend: [{ on, by: 'hnScore' }] },
        ],
        collapse: { by: 'channel', on },
        page: { number: 0, size: 3 },
      },
      { exposeSortValues: true },
    );
    assert.deepEqual(
      rows.map((r) => r.url.replace(`${testRealm}Talk/`, '')),
      ['g.json', 'f.json', 'b.json'],
      'the first four groups, lowest score first',
    );
    for (let row of rows) {
      assert.strictEqual(
        typeof Number(row._blendScore),
        'number',
        `${row.url} keeps its blend score`,
      );
      assert.notStrictEqual(row._blendScore, undefined);
      assert.ok(row._explain?.signals, `${row.url} keeps its explanation`);
      assert.ok(Number(row._collapseSize) >= 1, `${row.url} keeps its size`);
      assert.deepEqual(
        row._sortValues.slice(0, 1),
        [row._window],
        `${row.url} sorts by its rerank value first, for a merge`,
      );
      assert.strictEqual(
        row._sortValues.length,
        3,
        'then the blend score and the url',
      );
    }
    assert.deepEqual(
      rows.map((r) => Number(r._collapseSize)),
      [1, 1, 3],
      'two talks with no channel, then Strange Loop',
    );

    // An expression sort over every match keeps its own values beside the
    // window's.
    let both = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        sort: [
          { expression: '100 - hnScore', top: 3 },
          { expression: 'hnScore * 2' },
        ],
      } as unknown as Query,
      {},
      { kind: 'renderSet' },
    );
    let d = both.results.find((r: any) => r.url === url('d')) as any;
    assert.strictEqual(Number(d._expression), 100, "the sort's value");
    assert.strictEqual(Number(d._window), 50, "the window's value");

    // The window's expression alone gives no row an `_expression`.
    let alone = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        sort: [{ expression: '100 - hnScore', top: 3 }, ...byScore],
      } as unknown as Query,
      {},
      { kind: 'renderSet' },
    );
    assert.ok(alone.meta.window, 'the window reports itself');
    assert.notOk(
      alone.results.some((r: any) => '_expression' in r),
      'no row carries an expression value',
    );
  });

  test('an expression with top says when its window or its comparison set was cut short', async function (assert) {
    let whole = await reranked({
      filter: { type: on },
      sort: [
        { expression: 'hnScore / stats.hnScore.median', top: 100 },
        ...byScoreDesc,
      ],
    });
    assert.notOk(whole.meta.window?.truncated, 'a window holding every match');
    assert.false(
      hasWarning(whole.meta, 'compare-truncated'),
      'a whole comparison set',
    );

    let top = await reranked({
      filter: { type: on },
      sort: [
        { expression: 'hnScore / stats.hnScore.median', top: 4 },
        ...byScoreDesc,
      ],
    });
    assert.true(
      top.meta.window?.truncated,
      'seven matches, four re-ranked: the rest keep the query order',
    );

    setCompareRowLimitForTests(3);
    try {
      let capped = await reranked({
        filter: { type: on },
        sort: [
          { expression: 'hnScore / stats.hnScore.median', top: 100 },
          ...byScoreDesc,
        ],
      });
      assert.deepEqual(
        capped.meta.warnings?.find((w) => w.code === 'compare-truncated')
          ?.message,
        'the comparison set held 7 rows, more than the 3 it reads, so stats. and peers. describe the first 3',
        'the set read three of its seven rows, and says so',
      );
      assert.false(
        'compareTruncated' in (capped.meta.window ?? {}),
        'a caveat is a warning, not a flag on meta.window',
      );
    } finally {
      setCompareRowLimitForTests(undefined);
    }
  });

  test('an expression with compare compares each row with its peers', async function (assert) {
    let { rows } = await reranked({
      filter: { type: on },
      sort: [
        {
          expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
          compare: { by: 'channel' },
        },
        ...byScoreDesc,
      ],
    });
    assert.deepEqual(
      rows,
      [
        ['d', 1],
        ['b', 1],
        ['f', 1],
        ['c', 0.5],
        ['e', 0],
        ['a', 0],
        ['g', 0],
      ],
      'each talk ranked within its own channel (f and g have none)',
    );
    let ratio = await reranked({
      filter: { type: on },
      sort: [
        {
          expression: 'hnScore / stats.hnScore.median',
          direction: 'asc',
          top: 100,
        },
        ...byScoreDesc,
      ],
    });
    assert.deepEqual(
      ratio.rows,
      [
        ['g', 0.05],
        ['f', 0.25],
        ['a', 0.5],
        ['c', 1],
        ['b', 1.5],
        ['e', 2],
        ['d', 2.5],
      ],
      'a ratio to the median of every match',
    );
    let against = await reranked({
      filter: { on, eq: { channel: 'GOTO' } },
      sort: [
        {
          expression: '(hnScore - stats.hnScore.avg) / stats.hnScore.stdev',
          compare: { filter: { type: on } },
        },
      ],
    });
    assert.deepEqual(
      against.rows.map((r) => r[0]),
      ['d', 'e'],
      'a comparison set other than the matches',
    );
    assert.ok(
      (against.rows[0][1] as number) > 1,
      'd sits more than a standard deviation above every talk',
    );
  });

  test('an expression with top that does not compile is refused', async function (assert) {
    await assert.rejects(
      engine.search(
        new URL(testRealm),
        {
          filter: { type: on },
          sort: [{ expression: 'IF(', top: 10 }],
        } as unknown as Query,
        {},
        { kind: 'renderSet' },
      ),
      (e: any) =>
        e instanceof InvalidQueryError &&
        ['invalid-expression', 'expression-unsupported'].includes(e.code),
    );
  });

  test('an expression with top is scored in Postgres', async function (assert) {
    let { rows, meta } = await reranked({
      filter: { type: on },
      sort: [
        { expression: 'IFERROR(100 / (hnScore - 30), -1)', top: 4 },
        ...byScoreDesc,
      ],
    });
    assert.deepEqual(meta.window, { rows: 4, scored: 4, truncated: true });
    assert.deepEqual(
      rows.slice(0, 4),
      [
        ['e', 10],
        ['d', 5],
        ['b', -1],
        ['c', -10],
      ],
      "the top four by score, re-ranked; b's #DIV/0! caught by IFERROR",
    );
  });

  test('an expression SQL cannot run is refused, with or without top', async function (assert) {
    for (let entry of [
      {
        expression:
          'IF(ISNUMBER(SEARCH("loop", channel)), 1, 0) + LEN(title) * 0',
      },
      {
        expression: 'IF(ISNUMBER(SEARCH("loop", channel)), 1, 0)',
        top: 100,
      },
    ]) {
      await assert.rejects(
        engine.search(
          new URL(testRealm),
          {
            filter: { type: on },
            sort: [entry, ...byScoreDesc],
          } as unknown as Query,
          {},
          { kind: 'renderSet' },
        ),
        (e: any) =>
          e instanceof InvalidQueryError &&
          e.code === 'expression-unsupported' &&
          /SEARCH|ISNUMBER|LEN/.test(e.message),
        JSON.stringify(entry),
      );
    }
  });
});
