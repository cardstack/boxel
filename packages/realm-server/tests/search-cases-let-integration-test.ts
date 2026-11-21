import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import type { VirtualNetwork } from '@cardstack/runtime-common';
import {
  IndexWriter,
  InvalidQueryError,
  assertQuery,
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
  rri,
} from '@cardstack/runtime-common';
import { testRealm } from './helpers/index.ts';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for let bindings, on a corpus of talks seeded fresh for each
// test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search, byScore, addSavedList, reranked, byScoreDesc } = shared;
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  hooks.beforeEach(function () {
    ({ adapter, virtualNetwork } = shared);
  });

  test('linkedFrom keeps the cards another card links to', async function (assert) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let listURL = new URL(`${testRealm}List/saved.json`);
    let id = (name: string) => `${testRealm}Talk/${name}`;
    await batch.updateEntry(listURL, {
      type: 'instance',
      resource: {
        id: rri(listURL.href),
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: rri(`${testRealm}list`), name: 'List' } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: {
        title: 'Saved',
        items: [{ id: id('b') }, { id: id('f') }, { id: id('d') }],
        pinned: { id: id('c') },
      },
      markdown: 'Saved',
      deps: new Set(),
      displayNames: ['List'],
      types: [],
      isolatedHtml: '<div>saved</div>',
    });
    await batch.done();
    let saved = `${testRealm}List/saved`;
    let titles = async (filter: any) =>
      (
        await search({
          filter: { every: [{ type: on }, filter] },
          sort: byScore,
        })
      ).titles;
    assert.deepEqual(
      await titles({ linkedFrom: { card: saved, field: 'items' } }),
      ['d', 'b', 'f'],
      'a linksToMany',
    );
    assert.deepEqual(
      await titles({ linkedFrom: { card: saved, field: 'pinned' } }),
      ['c'],
      'a linksTo',
    );
    assert.deepEqual(
      await titles({
        every: [
          { linkedFrom: { card: `${saved}.json`, field: 'items' } },
          { on, range: { hnScore: { gte: 10 } } },
        ],
      }),
      ['d', 'b'],
      'it composes, and a .json URL names the same card',
    );
    assert.deepEqual(
      await titles({ not: { linkedFrom: { card: saved, field: 'items' } } }),
      ['e', 'c', 'a', 'g'],
      'it negates',
    );
    assert.deepEqual(
      await titles({
        linkedFrom: { card: `${testRealm}List/nope`, field: 'items' },
      }),
      [],
      'a missing card links to nothing',
    );
    assert.deepEqual(
      await titles({
        linkedFrom: {
          card: 'https://elsewhere.example/List/saved',
          field: 'items',
        },
      }),
      [],
      'a card in another realm links to nothing',
    );
    let wire = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, linkedFrom: { card: saved, field: 'items' } },
    });
    assert.deepEqual(wire.itemQuery.filter, {
      on,
      linkedFrom: { card: saved, field: 'items' },
    });
    assert.throws(
      () =>
        assertQuery({
          filter: { linkedFrom: { card: 'List/saved', field: 'items' } },
        } as any),
      /card must be a card's id: its URL, its @scope\/… id or \$REALM\/<path>/,
    );
    // ADR 002: a card's id in its registered prefix's form names the same
    // card as its URL.
    // over the lists' folder only: a prefix over the whole realm would
    // re-spell its already-indexed types too
    virtualNetwork.addRealmMapping('@test/lists/', `${testRealm}List/`);
    try {
      assert.deepEqual(
        await titles({
          linkedFrom: { card: '@test/lists/saved', field: 'items' },
        }),
        ['d', 'b', 'f'],
        'a prefix-form id names the card its URL does',
      );
      assert.deepEqual(
        await titles({
          linkedFrom: {
            card: '@test/lists/saved.json',
            field: 'pinned',
          },
        }),
        ['c'],
        'with or without .json',
      );
    } finally {
      virtualNetwork.removeRealmMapping('@test/lists/');
    }
  });

  test("a let binding of one card's links runs as a join", async function (assert) {
    let saved = await addSavedList();
    let { titles, meta } = await search({
      let: {
        $saved: { from: { filter: { eq: { id: saved } } }, select: 'items.id' },
      },
      filter: { every: [{ type: on }, { in: { id: '$saved' } }] },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'b', 'f']);
    assert.deepEqual(meta.lets, { $saved: { strategy: 'join' } });
  });

  test('a let binding runs its query first and passes the values on', async function (assert) {
    // The channels of talks scoring 40 or more, then every talk on them.
    let { titles, meta } = await search({
      let: {
        $hot: {
          from: { filter: { on, range: { hnScore: { gte: 40 } } } },
          select: 'channel',
        },
      },
      filter: {
        every: [{ type: on }, { on, in: { channel: '$hot' } }],
      },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'e']);
    assert.deepEqual(meta.lets, { $hot: { strategy: 'list', values: 1 } });

    // A card's links read some other way than by id fall back to a list.
    let saved = await addSavedList();
    let listed = await search({
      let: {
        $saved: {
          from: { filter: { eq: { id: saved } } },
          select: 'items.id',
        },
      },
      filter: {
        every: [
          { type: on },
          { not: { in: { id: '$saved' } } },
          { on, range: { hnScore: { gte: 10 } } },
        ],
      },
      sort: byScore,
    });
    assert.deepEqual(
      listed.titles,
      ['e', 'c', 'a'],
      'negated, beside other filters',
    );
  });

  test('a let binding reaches a _when signal, and an empty list matches nothing', async function (assert) {
    let { titles } = await search({
      let: {
        $loop: {
          from: { filter: { on, eq: { channel: 'Strange Loop' } } },
          select: 'channel',
        },
      },
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            {
              by: '_when',
              when: { on, in: { channel: '$loop' } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.deepEqual(titles, ['b', 'c', 'a', 'd', 'e', 'f', 'g']);
    let none = await search({
      let: {
        $nobody: {
          from: { filter: { on, eq: { channel: 'Nowhere' } } },
          select: 'channel',
        },
      },
      filter: {
        every: [{ type: on }, { on, in: { channel: '$nobody' } }],
      },
    });
    assert.deepEqual(none.titles, []);
    assert.deepEqual(none.meta.lets, {
      $nobody: { strategy: 'list', values: 0 },
    });
  });

  test('let bindings are checked, and travel the wire through item.', function (assert) {
    let bad = (query: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    // a name no binding declares is text, and an `in` takes a list
    bad({ filter: { in: { id: '$missing' } } }, /in values must be arrays/);
    bad({ let: { $x: { select: 'a' } } }, /from must be a query/);
    bad(
      { let: { $x: { from: { filter: { type: on } }, select: 'a b' } } },
      /select must be a field path/,
    );
    bad(
      {
        let: {
          $x: {
            from: { filter: { type: on }, page: { size: 10_001 } },
            select: 'a',
          },
        },
      },
      /page is \{ size \}/,
    );
    bad(
      {
        let: {
          $x: { from: { filter: { in: { id: '$y' } } }, select: 'a' },
          $y: { from: { filter: { type: on } }, select: 'a' },
        },
      },
      /cannot use another binding/,
    );
    let parsed = parseSearchEntryQueryFromPayload({
      let: {
        $hot: {
          from: {
            filter: { 'item.on': on, range: { 'item.hnScore': { gte: 40 } } },
          },
          select: 'item.channel',
        },
      },
      filter: { 'item.on': on, in: { 'item.channel': '$hot' } },
    });
    assert.deepEqual(parsed.itemQuery.let, {
      $hot: {
        from: { filter: { on, range: { hnScore: { gte: 40 } } } },
        select: 'channel',
      },
    });
    // `let` makes the request the newer spelling, so it arrives lowered:
    // the reference is interned as the engine reads it
    assert.deepEqual(parsed.itemQuery.filter, {
      on,
      in: { channel: { $let: '$hot' } },
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.strictEqual((wire.let as any).$hot.select, 'item.channel');
  });

  test('a list binding goes only as the one value of an in', async function (assert) {
    let hot = {
      from: { filter: { on, range: { hnScore: { gte: 40 } } } },
      select: 'channel',
    };
    let refused = (filter: unknown, why: string) =>
      assert.throws(
        () => assertQuery({ let: { $hot: hot }, filter }),
        (err: unknown) =>
          err instanceof InvalidQueryError &&
          err.code === 'binding-kind' &&
          /only as the one value of an `in`/.test(err.message),
        why,
      );
    refused({ on, eq: { channel: '$hot' } }, 'an eq value');
    refused(
      { on, in: { channel: '$hot', title: ['A'] } },
      'an in with another entry',
    );
    refused({ on, in: { channel: ['$hot'] } }, 'inside an in list');
    refused({ on, range: { hnScore: { gte: '$hot' } } }, 'a range bound');
    assert.throws(
      () =>
        assertQuery({
          let: { $hot: hot },
          filter: { type: on },
          sort: [
            {
              expression: 'hnScore',
              compare: { filter: { on, eq: { channel: '$hot' } } },
            },
            { on, by: 'hnScore' },
          ],
        }),
      (err: unknown) =>
        err instanceof InvalidQueryError && err.code === 'binding-kind',
      "a sort entry's comparison filter is checked too",
    );
    // The one place it goes still runs, in the filter and in a comparison set.
    let { titles } = await search({
      let: { $hot: hot },
      filter: { on, in: { channel: '$hot' } },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'e']);
    let compared: Record<string, any> = {
      let: { $hot: hot },
      filter: { type: on },
      sort: [
        {
          expression: 'stats.hnScore.max',
          compare: { filter: { on, in: { channel: '$hot' } } },
        },
        ...byScore,
      ],
    };
    assertQuery(compared);
    let { rows } = await reranked(compared);
    assert.deepEqual(
      [...new Set(rows.map((r) => r[1]))],
      [50],
      'the comparison set is the GOTO talks',
    );
  });
  test("a one-card let binding's values stand in where values go", async function (assert) {
    let top = {
      from: { filter: { on, eq: { title: 'D' } } },
      one: true as const,
    };
    let same = await search({
      let: { $top: top },
      filter: { on, eq: { channel: '$top.channel' } },
      sort: byScore,
    });
    assert.deepEqual(same.titles, ['d', 'e'], "an eq reads the card's channel");
    assert.deepEqual(same.meta.lets, {
      $top: { strategy: 'card', found: true },
    });
    let lower = await search({
      let: { $top: top },
      filter: {
        on,
        range: { hnScore: { lt: '$top.hnScore' } },
      },
      sort: byScore,
    });
    assert.deepEqual(
      lower.titles,
      ['e', 'b', 'c', 'a', 'f', 'g'],
      'a range bound reads its score',
    );
    let { rows } = await reranked({
      let: { $top: top },
      filter: { type: on },
      sort: [
        { expression: '$top.hnScore - hnScore', direction: 'asc', top: 100 },
        ...byScoreDesc,
      ],
    });
    assert.deepEqual(
      rows.slice(0, 3),
      [
        ['d', 0],
        ['e', 10],
        ['b', 20],
      ],
      'an expression reads the card under its name',
    );
  });

  test('a one-card binding that finds nothing matches nothing, as $this does', async function (assert) {
    let none = {
      from: { filter: { on, eq: { title: 'Z' } } },
      one: true as const,
    };
    let bounded = await search({
      let: { $none: none },
      filter: {
        on,
        range: { hnScore: { lt: '$none.hnScore' } },
      },
    });
    assert.deepEqual(bounded.titles, [], 'a null bound matches nothing');
    assert.deepEqual(bounded.meta.lets, {
      $none: { strategy: 'card', found: false },
    });
    let missing = await search({
      let: { $none: none },
      filter: { on, eq: { channel: '$none.channel' } },
      sort: byScore,
    });
    assert.deepEqual(
      missing.titles,
      [],
      'no card, so no value to compare: no rows, not the cards with no channel',
    );
  });

  test('one-card bindings are checked, and travel the wire', function (assert) {
    let bad = (query: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    let top = { from: { filter: { type: on } }, one: true };
    bad({ let: { $top: { ...top, select: 'a' } } }, /or \{ from, one: true \}/);
    bad({ let: { $top: { ...top, one: 1 } } }, /or \{ from, one: true \}/);
    bad({ let: { $top: top }, filter: { in: { id: '$top' } } }, /is one card/);
    bad(
      {
        let: {
          $top: top,
          $x: {
            from: {
              filter: { on, eq: { channel: '$top.channel' } },
            },
            select: 'a',
          },
        },
      },
      /cannot use another binding/,
    );
    assertQuery({
      let: { $top: top },
      filter: {
        every: [
          { on, eq: { channel: '$top.channel' } },
          { on, range: { hnScore: { lt: '$top.hnScore' } } },
        ],
      },
      sort: [{ on, by: 'hnScore', direction: 'desc' }],
    });
    assert.ok(true, 'references pass where values go');
    let parsed = parseSearchEntryQueryFromPayload({
      let: {
        $top: {
          from: { filter: { 'item.on': on, eq: { 'item.title': 'D' } } },
          one: true,
        },
      },
      filter: {
        'item.on': on,
        range: { 'item.hnScore': { lt: '$top.hnScore' } },
      },
    });
    assert.deepEqual(parsed.itemQuery.let, {
      $top: { from: { filter: { on, eq: { title: 'D' } } }, one: true },
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.deepEqual((wire.let as any).$top, {
      from: { filter: { 'item.on': on, eq: { 'item.title': 'D' } } },
      one: true,
    });
  });
  test('the newer spellings lower to the JSON the engine runs', async function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      type: on,
      filter: { eq: { 'item.channel': 'GOTO' } },
      sort: [
        {
          blend: [
            { by: 'item.hnScore', weight: 2 },
            { expression: 'hnScore * 2' },
          ],
        },
      ],
      collapse: 'item.channel',
    });
    assert.deepEqual(parsed.itemQuery.filter, {
      on,
      every: [{ eq: { channel: 'GOTO' } }],
    });
    let blend = (parsed.itemQuery.sort as any)[0];
    assert.strictEqual(blend.by, '_blend', 'blend lowers to _blend');
    assert.deepEqual(blend.of[0].on, on, 'a field signal inherits the type');
    assert.strictEqual(blend.of[1].by, '_expr', 'formula lowers to _expr');
    assert.deepEqual(parsed.itemQuery.collapse, { by: 'channel', on });
    let bound = parseSearchEntryQueryFromPayload({
      type: on,
      let: {
        $top: {
          from: {
            type: on,
            filter: { eq: { channel: 'GOTO' } },
            sort: [{ by: 'hnScore', direction: 'desc' }],
          },
          one: true,
        },
      },
      filter: { range: { hnScore: { lte: '$top.hnScore' } } },
    });
    assert.deepEqual(
      (bound.itemQuery.let as any).$top.from,
      {
        filter: { on, every: [{ eq: { channel: 'GOTO' } }] },
        sort: [{ by: 'hnScore', direction: 'desc', on }],
      },
      "a binding's own query lowers with its own type",
    );
    let topWindow = parseSearchEntryQueryFromPayload({
      type: on,
      sort: [{ expression: 'hnScore * 2', top: 50 }],
    });
    assert.deepEqual(
      topWindow.itemQuery.rerank,
      { expression: 'hnScore * 2', top: 50 },
      'an expression with top lowers to the engine form of a window',
    );
    assert.throws(
      () =>
        parseSearchEntryQueryFromPayload({
          type: on,
          sort: [{ expression: 'SUMM(hnScore, 1)' }],
        }),
      (e: any) => e.queryCode === 'unknown-function' && /SUMM/.test(e.message),
    );
    let refused = (query: unknown, code: string, pattern: RegExp) =>
      assert.throws(
        () => parseSearchEntryQueryFromPayload(query),
        (e: any) => e.queryCode === code && pattern.test(e.message),
        String(pattern),
      );
    let textual = 'IF(ISNUMBER(SEARCH("a", title)), 1, 0)';
    refused(
      { type: on, sort: [{ expression: 42 }] },
      'invalid-expression',
      /^/, // the code is the check; the wording is not pinned
    );
    refused(
      { type: on, sort: [{ expression: 'hnScore', placement: 'sql' }] },
      'unknown-key',
      /placement.*every expression runs in SQL/,
    );
    refused(
      { type: on, sort: [{ expression: textual }] },
      'expression-unsupported',
      /cannot run in a query/,
    );
    refused(
      {
        type: on,
        sort: [{ by: 'hnScore' }, { expression: 'hnScore', top: 5 }],
      },
      'expression-placement',
      /first sort entry/,
    );
    refused(
      {
        type: on,
        sort: [{ expression: 'hnScore', top: 5 }],
        rerank: { expression: 'hnScore', top: 50 },
      },
      'unknown-key',
      /sort entry/,
    );
    refused(
      {
        type: on,
        sort: [{ blend: [{ by: 'hnScore' }, { expression: textual }] }],
      },
      'expression-unsupported',
      /cannot run in a query/,
    );
    refused(
      {
        type: on,
        sort: [
          { blend: [{ by: 'hnScore' }, { expression: 'hnScore', top: 5 }] },
        ],
      },
      'invalid-nesting',
      /takes no top/,
    );
    refused(
      { type: on, sort: [{ expression: 'hnScore / stats.hnScore.median' }] },
      'expression-placement',
      /only a sort entry with top/,
    );
    let sqlPlaced = parseSearchEntryQueryFromPayload({
      type: on,
      sort: [{ by: 'hnScore' }, { expression: 'hnScore * 2' }],
    });
    assert.strictEqual(
      (sqlPlaced.itemQuery.sort as any)[1].by,
      '_expr',
      'a formula that compiles may come after another key',
    );
    let { titles } = await search({
      filter: { on, eq: { Channel: 'GOTO' } },
      sort: [{ on, by: 'HnScore', direction: 'desc' }],
    });
    assert.deepEqual(titles, ['d', 'e'], 'labels resolve against the type');
    await assert.rejects(
      search({ filter: { on, eq: { Chanel: 'GOTO' } } }),
      (e: any) => e.code === 'unknown-field' && /channel/.test(e.message),
    );
  });
});
