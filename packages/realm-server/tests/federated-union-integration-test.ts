import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexQueryEngine,
  IndexWriter,
  RealmUnion,
  VectorSerializer,
  VirtualNetwork,
  hasVectorIndex,
  internalKeyFor,
  realmAdmissionFilter,
  rri,
  unionPathRefusal,
  parseSearchEntryQueryFromPayload,
  type Definition,
  type DefinitionLookup,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// A merged federated search over realms on one database runs as one
// statement over all of them (`RealmUnion`). The invariant: a union of
// realms A and B answers exactly what one realm holding A's and B's cards
// answers — rows, order, totals, facets, collapse and blend scores.
//
// The use case: a read-only corpus of videos discussed on Hacker News, and
// the caller's own videos (subscriptions and history), blended into one
// list by text relevance, nearness to a taste vector, recency and a boost
// for their own, collapsed by video, paged.
//
// The realm holding both keeps each realm's cards under a folder named for
// it (`all/hn/h1` for `hn/h1`), so the URL tie-break orders them alike.

const HN = 'http://union.test/hn/';
const MINE = 'http://union.test/mine/';
const ALL = 'http://union.test/all/';

const videoRef: ResolvedCodeRef = {
  module: 'http://union.test/hn/video' as ResolvedCodeRef['module'],
  name: 'Video',
};

const stringRef = { module: '@cardstack/base/string', name: 'default' };
const numberRef = { module: '@cardstack/base/number', name: 'default' };
const text = (search?: Record<string, unknown>) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
  ...(search ? { search } : {}),
});
const number = (search?: Record<string, unknown>) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: numberRef,
  serializerName: 'number',
  ...(search ? { search } : {}),
});

const videoDef = {
  type: 'card-def',
  codeRef: videoRef,
  displayName: 'Video',
  fields: {
    title: 'title',
    youtubeId: 'id',
    source: 'source',
    visibility: 'source',
    channel: 'channel',
    hnScore: 'score',
    published: 'published',
    taste: 'vector',
  },
  fieldDefs: {
    title: text({ role: 'title' }),
    id: text(),
    source: text(),
    channel: text({ role: 'label', facet: true }),
    score: number({ rank: 'popularity', facet: true }),
    published: number({ rank: 'recency' }),
    vector: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: '@cardstack/base/vector', name: 'default' },
      serializerName: 'vector',
    },
  },
  search: { wordStatistics: true, rank: { recency: 'published' } },
} as unknown as Definition;

function videoLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (
        codeRef.module === videoRef.module &&
        codeRef.name === videoRef.name
      ) {
        return videoDef;
      }
      throw new Error(`unexpected definition lookup: ${codeRef.module}`);
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

type Video = {
  id: string;
  title: string;
  youtubeId: string;
  source: 'hn' | 'mine';
  visibility?: 'public' | 'private';
  channel: string;
  hnScore: number;
  published: number;
  taste: number[];
};

const hn: Video[] = [
  {
    id: 'h1',
    title: 'Rust ownership explained',
    youtubeId: 'y1',
    source: 'hn',
    channel: 'talks',
    hnScore: 400,
    published: 100,
    taste: [1, 0, 0],
  },
  {
    id: 'h2',
    title: 'Async Rust in practice',
    youtubeId: 'y2',
    source: 'hn',
    channel: 'talks',
    hnScore: 300,
    published: 200,
    taste: [0.9, 0.1, 0],
  },
  {
    id: 'h3',
    title: 'Postgres internals',
    youtubeId: 'y3',
    source: 'hn',
    channel: 'db',
    hnScore: 500,
    published: 300,
    taste: [0, 1, 0],
  },
  {
    id: 'h4',
    title: 'Rust and Postgres together',
    youtubeId: 'y4',
    source: 'hn',
    channel: 'db',
    hnScore: 100,
    published: 400,
    taste: [0.5, 0.5, 0],
  },
  {
    id: 'h5',
    title: 'Cooking pasta at home',
    youtubeId: 'y5',
    source: 'hn',
    channel: 'food',
    hnScore: 50,
    published: 500,
    taste: [0, 0, 1],
  },
];

// The caller's own: m1 is the same video as h1, so collapsing by video keeps
// one of the two.
const mine: Video[] = [
  {
    id: 'm1',
    title: 'My Rust notes, rust every day',
    youtubeId: 'y1',
    source: 'mine',
    visibility: 'public',
    channel: 'notes',
    hnScore: 0,
    published: 600,
    taste: [1, 0.1, 0],
  },
  {
    id: 'm2',
    title: 'Rust borrow checker',
    youtubeId: 'y6',
    source: 'mine',
    visibility: 'private',
    channel: 'talks',
    hnScore: 10,
    published: 700,
    taste: [0.8, 0.2, 0],
  },
  {
    id: 'm3',
    title: 'Weekend pasta',
    youtubeId: 'y7',
    source: 'mine',
    visibility: 'public',
    channel: 'food',
    hnScore: 5,
    published: 800,
    taste: [0.1, 0, 0.9],
  },
];

// 'http://union.test/hn/h1.json' and 'http://union.test/all/hn/h1.json'
// both read as 'hn/h1'.
const label = (url: string) =>
  url
    .replace(ALL, '')
    .replace('http://union.test/', '')
    .replace(/\.json$/, '');

type Answer = {
  rows: string[];
  scores: (number | null)[];
  collapseSizes: (number | null)[];
  total: number;
  hasMore: boolean | undefined;
  facets: unknown;
  realmTotals: Record<string, number> | undefined;
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let vectors = false;
  let network: VirtualNetwork;

  async function write(realm: string, rows: Video[], prefix = '') {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    let key = internalKeyFor(videoRef, undefined, network);
    for (let { id, taste, ...fields } of rows) {
      let cardURL = new URL(`${realm}${prefix}${id}.json`);
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(videoRef.module), name: 'Video' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          ...fields,
          ...(vectors
            ? {
                taste: VectorSerializer.queryableValue(
                  VectorSerializer.encodeVector(taste),
                ),
              }
            : {}),
          // what the render stamps: the title's words, and the declared
          // facet fields (facet-declarations.ts)
          _searchText: {
            A: fields.title,
            facets: { channel: {}, hnScore: {} },
          },
        },
        markdown: fields.title,
        deps: new Set(),
        displayNames: ['Video'],
        types: [key],
        isolatedHtml: `<div>${id}</div>`,
      });
    }
    await batch.done();
  }

  // Each realm's word statistics, built as the engine builds them, so a
  // text-ranked search reads them from its first run.
  async function buildWordStatistics(realm: string) {
    await adapter.execute(`DELETE FROM boxel_term_stats WHERE realm_url = $1`, {
      bind: [realm],
    });
    await adapter.execute(
      `INSERT INTO boxel_term_stats (realm_url, lexeme, df)
       SELECT i.realm_url, u.lexeme, COUNT(*)
         FROM boxel_index AS i CROSS JOIN LATERAL unnest(i.rank_tsv) AS u
        WHERE i.realm_url = $1 AND i.rank_tsv IS NOT NULL AND i.is_deleted IS NOT TRUE
        GROUP BY i.realm_url, u.lexeme`,
      { bind: [realm] },
    );
    await adapter.execute(
      `INSERT INTO boxel_realm_text_stats (realm_url, doc_count, rebuilt_at)
       SELECT $1, COUNT(*), now() FROM boxel_index
        WHERE realm_url = $1 AND rank_tsv IS NOT NULL AND is_deleted IS NOT TRUE
       ON CONFLICT (realm_url) DO UPDATE SET doc_count = EXCLUDED.doc_count, rebuilt_at = EXCLUDED.rebuilt_at`,
      { bind: [realm] },
    );
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    vectors = await hasVectorIndex(adapter);
    network = new VirtualNetwork();
    engine = new IndexQueryEngine(adapter, videoLookup(), network);
    await write(HN, hn);
    await write(MINE, mine);
    await write(ALL, hn, 'hn/');
    await write(ALL, mine, 'mine/');
    for (let realm of [HN, MINE, ALL]) {
      await buildWordStatistics(realm);
    }
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  async function ask(
    over: URL,
    query: Record<string, unknown>,
    opts: Record<string, unknown> = {},
  ): Promise<Answer> {
    let { results, meta } = await engine.search(over, query as Query, opts, {
      kind: 'dataOnly',
    });
    let num = (v: unknown) => (v == null ? null : Number(v));
    return {
      rows: results.map((row) => label(String(row.url))),
      scores: results.map((row: any) =>
        num(row._blendScore ?? row._matchRelevance ?? row._nearSimilarity),
      ),
      collapseSizes: results.map((row: any) => num(row._collapseSize)),
      total: meta.page.total,
      hasMore: meta.page.hasMore,
      facets: meta.facets,
      realmTotals: meta.realmTotals,
    };
  }

  const union = () => new RealmUnion([HN, MINE]);

  // The same answer, scores to within floating-point noise.
  function assertSameAnswer(
    assert: Assert,
    got: Answer,
    expected: Answer,
    what: string,
  ) {
    assert.deepEqual(got.rows, expected.rows, `${what}: rows and order`);
    assert.strictEqual(got.total, expected.total, `${what}: total`);
    assert.strictEqual(got.hasMore, expected.hasMore, `${what}: hasMore`);
    assert.deepEqual(got.facets, expected.facets, `${what}: facets`);
    assert.deepEqual(
      got.collapseSizes,
      expected.collapseSizes,
      `${what}: collapse sizes`,
    );
    assert.strictEqual(
      got.scores.length,
      expected.scores.length,
      `${what}: scores`,
    );
    got.scores.forEach((score, i) => {
      let want = expected.scores[i];
      assert.true(
        (score === null && want === null) ||
          (score !== null &&
            want !== null &&
            Math.abs(score - want) <= 1e-9 * Math.max(1, Math.abs(want))),
        `${what}: row ${i} scores ${score}, one realm ${want}`,
      );
    });
  }

  function videoFeed(page: number): Record<string, unknown> {
    return {
      type: videoRef,
      filter: { any: [{ matches: 'rust' }, { matches: 'pasta' }] },
      sort: [
        {
          blend: [
            { by: 'textRelevance' },
            ...(vectors ? [{ by: 'taste', near: [1, 0, 0] }] : []),
            { by: 'published' },
            { boost: { eq: { source: 'mine' } }, weight: 2 },
          ],
          k: 60,
        },
      ],
      collapse: 'youtubeId',
      facets: [{ by: 'channel' }],
      page: { size: 2, number: page },
    };
  }

  test('a blended, collapsed, faceted feed over two realms is the feed of one realm holding both', async function (assert) {
    for (let page of [0, 1, 2, 3]) {
      let got = await ask(union(), videoFeed(page));
      let one = await ask(new URL(ALL), videoFeed(page));
      assertSameAnswer(assert, got, one, `page ${page}`);
    }
    let first = await ask(union(), videoFeed(0));
    assert.strictEqual(first.total, 6, 'seven matches, two of one video');
    assert.deepEqual(
      first.realmTotals,
      { [HN]: 3, [MINE]: 3 },
      'each realm holds its share of the collapsed total',
    );
    assert.strictEqual(
      Object.values(first.realmTotals!).reduce((a, b) => a + b, 0),
      first.total,
      'the realm totals sum to the total',
    );
  });

  test('collapse across realms keeps the higher-ranked copy', async function (assert) {
    let feed = { ...videoFeed(0), page: { size: 10, number: 0 } };
    let got = await ask(union(), feed);
    // m1 (the caller's copy of y1) carries the boost and is newer, so it
    // outranks h1 and is the copy kept.
    assert.true(got.rows.includes('mine/m1'), 'the boosted copy is kept');
    assert.false(got.rows.includes('hn/h1'), 'the other copy is collapsed');
    assert.strictEqual(
      got.collapseSizes[got.rows.indexOf('mine/m1')],
      2,
      'its group holds both copies',
    );
    // Without the boost and by popularity alone, h1 outranks m1.
    let byScore = await ask(union(), {
      type: videoRef,
      filter: { matches: 'rust' },
      sort: [{ by: 'hnScore', direction: 'desc' }],
      collapse: 'youtubeId',
      page: { size: 10, number: 0 },
    });
    assert.true(byScore.rows.includes('hn/h1'));
    assert.false(byScore.rows.includes('mine/m1'));
  });

  test('text relevance reads the union’s word statistics', async function (assert) {
    let query = {
      type: videoRef,
      filter: { matches: 'rust postgres' },
      sort: [{ by: 'textRelevance' }],
      page: { size: 10, number: 0 },
    };
    assertSameAnswer(
      assert,
      await ask(union(), query),
      await ask(new URL(ALL), query),
      'textRelevance',
    );
    let relevance = {
      type: videoRef,
      filter: { matches: 'rust' },
      sort: [{ by: '_relevance' }],
      page: { size: 10, number: 0 },
    };
    assertSameAnswer(
      assert,
      await ask(union(), relevance),
      await ask(new URL(ALL), relevance),
      '_relevance',
    );
  });

  test('field sorts, totals and facets over the union', async function (assert) {
    let query = {
      type: videoRef,
      sort: [{ by: 'published', direction: 'desc' }],
      facets: [{ by: 'channel' }, { by: 'hnScore' }],
      page: { size: 3, number: 1 },
    };
    let got = await ask(union(), query);
    assertSameAnswer(assert, got, await ask(new URL(ALL), query), 'by date');
    assert.deepEqual(got.realmTotals, { [HN]: 5, [MINE]: 3 });
  });

  test('an expression sort and a window over a comparison set', async function (assert) {
    let expression = {
      type: videoRef,
      sort: [{ expression: 'hnScore / (published + 1)' }],
      page: { size: 4, number: 0 },
    };
    let gotExpression = await ask(union(), expression);
    assertSameAnswer(
      assert,
      gotExpression,
      await ask(new URL(ALL), expression),
      'expression',
    );
    assert.strictEqual(gotExpression.rows[0], 'hn/h1', 'highest score per day');
    // Each video against the median popularity of its channel, over the
    // union's own channel groups.
    let windowed = {
      type: videoRef,
      sort: [
        {
          expression: 'hnScore - stats.hnScore.median',
          compare: { by: 'channel' },
          top: 50,
        },
        { by: 'published', direction: 'desc' },
      ],
      page: { size: 5, number: 0 },
    };
    let got = await engine.search(
      union(),
      windowed as Query,
      {},
      {
        kind: 'dataOnly',
      },
    );
    let one = await engine.search(
      new URL(ALL),
      windowed as Query,
      {},
      {
        kind: 'dataOnly',
      },
    );
    assert.deepEqual(
      got.results.map((r: any) => [label(String(r.url)), Number(r._window)]),
      one.results.map((r: any) => [label(String(r.url)), Number(r._window)]),
      'the window values and order of one realm holding both',
    );
    assert.strictEqual(got.meta.page.total, one.meta.page.total);
  });

  test('a near sort over the union', async function (assert) {
    if (!vectors) {
      assert.ok(true, 'no vector index in this database');
      return;
    }
    let query = {
      type: videoRef,
      sort: [{ by: 'taste', near: [1, 0, 0] }],
      page: { size: 4, number: 0 },
    };
    assertSameAnswer(
      assert,
      await ask(union(), query),
      await ask(new URL(ALL), query),
      'near',
    );
  });

  module('a realm the caller reads only through its policy', function () {
    // The caller reads the corpus outright, and only the public videos of
    // the other realm.
    const grants = [{ on: videoRef, eq: { visibility: 'public' } }];
    function scopedOpts() {
      let admission = realmAdmissionFilter(
        [HN],
        [{ realm: MINE, grants: grants as any }],
      );
      return { grantFilter: admission, labelFilter: admission };
    }
    const scopedUnion = () =>
      new RealmUnion([HN, MINE], { statisticsRealms: [HN] });

    test('only the rows its grants admit, counted and faceted over those alone', async function (assert) {
      let got = await ask(scopedUnion(), videoFeed(0), scopedOpts());
      let all = await ask(
        scopedUnion(),
        { ...videoFeed(0), page: { size: 50, number: 0 } },
        scopedOpts(),
      );
      assert.false(all.rows.includes('mine/m2'), 'the private video is out');
      assert.true(all.rows.includes('mine/m1'));
      assert.true(all.rows.includes('mine/m3'));
      assert.strictEqual(got.total, 5, 'h1–h5 collapse m1 into y1; m3');
      assert.deepEqual(got.realmTotals, { [HN]: 3, [MINE]: 2 });
      let facets = got.facets as Record<string, { value: string }[]>;
      assert.deepEqual(facets.channel.map((c) => c.value).sort(), [
        'db',
        'food',
        'notes',
        'talks',
      ]);
    });

    test('a hidden row changes nothing the union shows', async function (assert) {
      let before = [];
      let queries = [
        videoFeed(0),
        videoFeed(1),
        {
          type: videoRef,
          filter: { matches: 'rust', typos: true },
          sort: [{ by: 'textRelevance' }],
          facets: [{ by: 'channel' }, { by: 'hnScore' }],
          page: { size: 10, number: 0 },
        },
      ];
      for (let q of queries) {
        before.push(await ask(scopedUnion(), q, scopedOpts()));
      }
      // Private videos that would move every count, rank and statistic.
      await write(MINE, [
        {
          id: 'm9',
          title: 'Rust rust rust rust secret',
          youtubeId: 'y2',
          source: 'mine',
          visibility: 'private',
          channel: 'secret',
          hnScore: 100_000,
          published: 100_000,
          taste: [1, 0, 0],
        },
        {
          id: 'm8',
          title: 'Rustacean pasta secrets',
          youtubeId: 'y9',
          source: 'mine',
          visibility: 'private',
          channel: 'secret',
          hnScore: 90_000,
          published: 90_000,
          taste: [1, 0, 0],
        },
      ]);
      await buildWordStatistics(MINE);
      for (let [i, q] of queries.entries()) {
        let after = await ask(scopedUnion(), q, scopedOpts());
        assertSameAnswer(assert, after, before[i], `query ${i}`);
        assert.deepEqual(after.realmTotals, before[i].realmTotals);
      }
    });

    test('an admission node only the union makes compiles', async function (assert) {
      // The same shape from a request is no filter the engine knows.
      await assert.rejects(
        ask(new URL(HN), {
          filter: {
            realmAdmission: { readable: [MINE], scoped: [] },
          } as any,
        }),
      );
    });
  });

  module('which searches take the union', function () {
    function realmStandIn(shares = true) {
      return { sharesIndexWith: () => shares } as unknown as Realm;
    }
    function merged(payload: Record<string, unknown> = {}) {
      return parseSearchEntryQueryFromPayload({
        realms: [HN, MINE],
        federation: { results: 'merged' },
        ...payload,
      });
    }

    test('a merged search of mounted realms on one database', async function (assert) {
      let realms = [
        { url: HN, realm: realmStandIn(), access: 'readable' as const },
        { url: MINE, realm: realmStandIn(), access: 'readable' as const },
      ];
      assert.strictEqual(unionPathRefusal(merged(), realms), undefined);
      assert.strictEqual(
        unionPathRefusal(
          parseSearchEntryQueryFromPayload({ realms: [HN, MINE] }),
          realms,
        ),
        'not merged',
        'a per-realm search keeps its sections',
      );
    });

    test('a realm not mounted here, or on another database, takes the merge', async function (assert) {
      assert.strictEqual(
        unionPathRefusal(merged(), [
          { url: HN, realm: realmStandIn(), access: 'readable' },
          { url: MINE, realm: undefined, access: 'readable' },
        ]),
        'a realm is not mounted on this server',
      );
      assert.strictEqual(
        unionPathRefusal(merged(), [
          { url: HN, realm: realmStandIn(false), access: 'readable' },
          { url: MINE, realm: realmStandIn(false), access: 'readable' },
        ]),
        'the realms do not share one index database',
      );
    });
  });
});
