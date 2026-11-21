import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import {
  InvalidQueryError,
  assertQuery,
  parseSearchEntryQueryFromPayload,
  policyScopedQuery,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';
import { testRealm } from './helpers/index.ts';
import { ref, setupTalkCorpus } from './helpers/talk-corpus.ts';
import { setupPolicyStoreDifferential } from './helpers/policy-store-differential.ts';

// Search cases for policy-scoped search, on a corpus of talks seeded fresh
// for each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  setupPolicyStoreDifferential(hooks);
  const shared = setupTalkCorpus(hooks);
  const { on } = shared;
  let engine: IndexQueryEngine;
  hooks.beforeEach(function () {
    ({ engine } = shared);
  });

  test('under a policy, bindings and linkedFrom read only what the grants admit', function (assert) {
    let grant = { on, eq: { channel: 'GOTO' } };
    let scoped = policyScopedQuery(
      parseSearchEntryQueryFromPayload({
        let: {
          $hot: {
            from: {
              filter: { 'item.on': on, range: { 'item.hnScore': { gte: 40 } } },
            },
            select: 'item.channel',
          },
        },
        filter: {
          every: [
            { 'item.on': on, in: { 'item.channel': '$hot' } },
            { linkedFrom: { card: `${testRealm}List/saved`, field: 'items' } },
          ],
        },
      }),
      [grant],
    );
    let lets = scoped.itemQuery.let!;
    assert.deepEqual(lets.$hot.from.filter, {
      every: [{ on, range: { hnScore: { gte: 40 } } }, { any: [grant] }],
    });
    assert.deepEqual(lets.$__linkedFrom0, {
      from: {
        filter: {
          every: [{ eq: { id: `${testRealm}List/saved` } }, { any: [grant] }],
        },
      },
      select: 'items.id',
    });
    assert.notOk(
      JSON.stringify(scoped.itemQuery.filter).includes('"linkedFrom":'),
      'the direct join is gone',
    );
  });

  test('under a policy, linkedFrom never reads links directly, wherever it is written', async function (assert) {
    let grant = { on, eq: { channel: 'GOTO' } };
    let saved = {
      linkedFrom: { card: `${testRealm}List/saved`, field: 'items' },
    };
    let scope = (payload: Record<string, unknown>) =>
      policyScopedQuery(parseSearchEntryQueryFromPayload(payload), [grant]);
    let refused = (payload: Record<string, unknown>, at: RegExp) =>
      assert.throws(
        () => scope(payload),
        (e: unknown) =>
          e instanceof InvalidQueryError &&
          e.code === 'policy-linked-from' &&
          at.test(e.message),
      );

    // In a boost, it becomes a binding the grants scope, as in the filter.
    let boosted = scope({
      filter: { 'item.on': on, range: { 'item.hnScore': { gte: 0 } } },
      sort: [
        {
          blend: [
            { 'item.on': on, by: 'item.hnScore' },
            { boost: saved, weight: 2 },
          ],
        },
      ],
    });
    assert.notOk(
      JSON.stringify(boosted.itemQuery).includes('"linkedFrom":'),
      'no direct read is left in the query',
    );
    assert.deepEqual(boosted.itemQuery.let?.$__linkedFrom0?.from.filter, {
      every: [{ eq: { id: `${testRealm}List/saved` } }, { any: [grant] }],
    });
    let { results } = await engine.search(
      new URL(testRealm),
      boosted.itemQuery,
      {},
      { kind: 'renderSet' },
    );
    assert.strictEqual(results.length, 2, 'and the scoped query runs');

    // In a binding's query and a comparison filter it cannot become one.
    refused(
      {
        let: {
          $mine: { from: { filter: saved }, select: 'item.channel' },
        },
        filter: { 'item.on': on, in: { 'item.channel': '$mine' } },
      },
      /^\/let\/\$mine\/from\/filter:/,
    );
    refused(
      {
        filter: { 'item.on': on, range: { 'item.hnScore': { gte: 0 } } },
        sort: [
          {
            expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
            compare: { filter: saved },
          },
        ],
      },
      /^\/sort\/0\/compare\/filter:/,
    );
  });

  test("under a policy, linkedFrom's bindings never take a caller's binding name", function (assert) {
    let grant = { on, eq: { channel: 'GOTO' } };
    let mine = {
      from: {
        filter: { 'item.on': on, range: { 'item.hnScore': { gte: 40 } } },
      },
      select: 'item.channel',
    };
    let scoped = policyScopedQuery(
      parseSearchEntryQueryFromPayload({
        let: { $__linkedFrom0: mine },
        filter: {
          every: [
            {
              'item.on': on,
              in: { 'item.channel': '$__linkedFrom0' },
            },
            { linkedFrom: { card: `${testRealm}List/saved`, field: 'items' } },
          ],
        },
      }),
      [grant],
    );
    let lets = scoped.itemQuery.let!;
    assert.deepEqual(
      lets.$__linkedFrom0?.select,
      'channel',
      "the caller's binding keeps its name and its query",
    );
    let added = Object.keys(lets).filter((n) => n !== '$__linkedFrom0');
    assert.strictEqual(
      added.length,
      1,
      'linkedFrom became a binding of its own',
    );
    assert.strictEqual(lets[added[0]].select, 'items.id');
    let text = JSON.stringify(scoped.itemQuery.filter);
    assert.true(
      text.includes(':"$__linkedFrom0"'),
      'the caller still reads its own',
    );
    assert.true(
      text.includes(`"$let":"${added[0]}"`),
      'and the rewrite reads its own',
    );
  });

  test("under a policy, linkedFrom's bindings are capped apart from the caller's", function (assert) {
    let grant = { on, eq: { channel: 'GOTO' } };
    let list = (n: number) => ({
      linkedFrom: { card: `${testRealm}List/l${n}`, field: 'items' },
    });
    let lets = Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        `$b${n}`,
        {
          from: {
            filter: { 'item.on': on, range: { 'item.hnScore': { gte: n } } },
          },
          select: 'item.channel',
        },
      ]),
    );
    let scoped = policyScopedQuery(
      parseSearchEntryQueryFromPayload({
        let: lets,
        filter: { every: [list(1), list(2), list(3), list(4)] },
      }),
      [grant],
    );
    assert.strictEqual(
      Object.keys(scoped.itemQuery.let!).length,
      8,
      "four of the caller's and four for linkedFrom",
    );
    assert.throws(
      () =>
        policyScopedQuery(
          parseSearchEntryQueryFromPayload({
            let: lets,
            filter: { every: [list(1), list(2), list(3), list(4), list(5)] },
          }),
          [grant],
        ),
      (e: unknown) =>
        e instanceof InvalidQueryError &&
        e.code === 'limit-exceeded' &&
        /at most 4 cards' links/.test(e.message),
      'a fifth is refused',
    );
  });

  test('an expression with top is checked, travels the wire, and a policy scopes its comparison set', function (assert) {
    assert.throws(
      () => assertQuery({ sort: [{ expression: 'x', top: 501 }] } as any),
      /top is a whole number from 1 to 500/,
    );
    assert.throws(
      () =>
        assertQuery({
          sort: [{ expression: 'x', compare: { by: 'a b' } }],
        } as any),
      /by must be a field path/,
    );
    assert.throws(
      () =>
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          rerank: { expression: 'hnScore' },
        }),
      (e: any) => e.queryCode === 'unknown-key' && /sort entry/.test(e.message),
      'the wire has no rerank member',
    );
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      sort: [
        {
          expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
          top: 50,
          compare: {
            filter: { 'item.on': on, eq: { 'item.channel': 'GOTO' } },
            by: 'item.channel',
          },
        },
      ],
    });
    assert.deepEqual(parsed.itemQuery.rerank, {
      expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
      top: 50,
      compare: { filter: { on, eq: { channel: 'GOTO' } }, by: 'channel' },
    });
    let grant = { on, eq: { channel: 'GOTO' } };
    let scoped = policyScopedQuery(parsed, [grant]);
    assert.deepEqual(scoped.itemQuery.rerank!.compare!.filter, {
      every: [{ on, eq: { channel: 'GOTO' } }, { any: [grant] }],
    });
    assert.deepEqual(
      scoped.labelFilter,
      { any: [grant] },
      "the grants also decide which linked cards' titles label a facet",
    );
  });

  test('look-alike comparisons are checked, travel the wire, and a policy scopes them', function (assert) {
    let bad = (compare: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery({ sort: [{ expression: 'x', compare }] } as any),
        pattern,
      );
    bad({ near: 'embedding', by: 'channel' }, /near or by, not both/);
    bad({ near: 'embedding', k: 0 }, /k goes with near/);
    bad({ k: 5 }, /k goes with near/);
    bad({ minSimilarity: 0.5 }, /minSimilarity goes with near/);
    bad({ near: 'a b' }, /near names a vector field/);
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      sort: [
        {
          expression: 'priceMin / stats.priceMin.median',
          compare: { near: 'item.imageEmbedding', k: 20, minSimilarity: 0.8 },
        },
      ],
    });
    assert.deepEqual(parsed.itemQuery.rerank!.compare, {
      near: 'imageEmbedding',
      k: 20,
      minSimilarity: 0.8,
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.strictEqual(
      (wire.sort as any)[0].compare.near,
      'item.imageEmbedding',
      'the window goes out as the leading sort entry',
    );
    let grant = { on, eq: { channel: 'GOTO' } };
    let scoped = policyScopedQuery(parsed, [grant]);
    assert.deepEqual(
      scoped.itemQuery.rerank!.compare!.filter,
      { any: [grant] },
      "a row's look-alikes reach only the cards the grants admit",
    );
  });

  test('exists keeps its own node, a type ANDs with another anchor, and policy marks the statistics rule', function (assert) {
    assert.throws(
      () =>
        parseSearchEntryQueryFromPayload({
          type: on,
          filter: { exists: 'item.channel', eq: { 'item.title': 'A' } },
        }),
      (e: any) => e.queryCode === 'invalid-filter',
    );
    let other = ref(`${testRealm}other`, 'Other');
    let parsed = parseSearchEntryQueryFromPayload({
      type: on,
      filter: { 'item.on': other, eq: { 'item.title': 'A' } },
    });
    assert.deepEqual(parsed.itemQuery.filter, {
      on,
      every: [{ on: other, eq: { title: 'A' } }],
    });
    let scoped = policyScopedQuery(
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, eq: { 'item.title': 'A' } },
      }),
      [{ on, eq: { channel: 'GOTO' } }],
    );
    assert.true(scoped.anonymizeStatistics, 'set on the entry query');
    assert.notOk(
      'anonymizeStatistics' in scoped.itemQuery,
      'never on the query itself',
    );
  });
});
