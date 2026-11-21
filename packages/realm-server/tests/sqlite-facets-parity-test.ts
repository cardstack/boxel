import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  internalKeyFor,
  param,
  query as runQuery,
  type DBAdapter,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { QueryOptions } from '@cardstack/runtime-common/query-engine/types';
import type { Query } from '@cardstack/runtime-common/query';
import { NodeSQLiteAdapter } from '@cardstack/query-verification/sqlite-adapter';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { syncSeededValueStore } from './helpers/seed-index-rows.ts';

// The browser index (SQLite) keeps no value store, so it counts facets in
// JS over the matched rows' search docs (docs/search.md, "On SQLite"). Under
// its limits its counts are Postgres's: the same fixture is seeded into both
// indexes and every facet query is asked of both. Over a limit it counts
// what it read and says so.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const dateRef = ref('@cardstack/base/date', 'default');
const talkRef = ref(`${testRealm}talk`, 'Talk');
const conceptRef = ref(`${testRealm}concept`, 'Concept');

const field = (
  fieldOrCard: ResolvedCodeRef,
  extra: Record<string, unknown> = {},
) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard,
  search: { facet: true },
  ...extra,
});

const conceptDef = {
  type: 'card-def',
  codeRef: conceptRef,
  displayName: 'Concept',
  fields: { cardTitle: 'c0' },
  fieldDefs: { c0: field(stringRef) },
} as unknown as Definition;

const talkDef = {
  type: 'card-def',
  codeRef: talkRef,
  displayName: 'Talk',
  fields: {
    cardTitle: 'f0',
    channel: 'f1',
    speakers: 'f2',
    hnScore: 'f3',
    lastDiscussed: 'f4',
    released: 'f5',
    concepts: 'f6',
  },
  fieldDefs: {
    f0: field(stringRef),
    f1: field(stringRef),
    f2: field(stringRef, { type: 'containsMany' }),
    f3: field(numberRef, { serializerName: 'number' }),
    f4: field(numberRef, { serializerName: 'number' }),
    f5: field(dateRef, { serializerName: 'date' }),
    f6: {
      type: 'linksToMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: conceptRef,
      search: { facet: true },
    },
  },
} as unknown as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      for (let def of [talkDef, conceptDef]) {
        let r = def.codeRef as ResolvedCodeRef;
        if (r.module === codeRef.module && r.name === codeRef.name) {
          return def;
        }
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

const JAN = 1705276800; // 2024-01-15, in seconds
const FEB = 1707523200; // 2024-02-10
const MAR_MS = 1709424000000; // 2024-03-03, in milliseconds
const concept = (name: string) => ({ id: `${testRealm}Concept/${name}` });

const talks: Record<string, Record<string, unknown>> = {
  a: {
    cardTitle: 'a talk',
    channel: 'strange loop',
    speakers: ['kleppmann', 'ada'],
    hnScore: 10,
    lastDiscussed: JAN,
    released: '2024-01-15',
    concepts: [concept('crdt'), concept('logs')],
  },
  b: {
    cardTitle: 'b talk',
    channel: 'strange loop',
    speakers: ['kleppmann'],
    hnScore: 20,
    lastDiscussed: FEB,
    released: '2024-01-17',
    concepts: [concept('crdt')],
  },
  c: {
    cardTitle: 'c talk',
    channel: 'goto',
    speakers: ['klein'],
    hnScore: 35,
    lastDiscussed: FEB,
    released: '2024-02-29',
    concepts: [],
  },
  d: {
    cardTitle: 'd talk',
    channel: 'qcon',
    speakers: ['bob'],
    hnScore: 50,
    lastDiscussed: MAR_MS,
    released: '2023-12-31',
    concepts: [concept('logs')],
  },
  e: { cardTitle: 'e talk', speakers: [], hnScore: 5, lastDiscussed: JAN },
};
const concepts: Record<string, Record<string, unknown>> = {
  crdt: { cardTitle: 'CRDTs' },
  logs: { cardTitle: 'Logs' },
};

// The same rows in either index, as the index writer leaves them (with the
// value store's rows on Postgres).
async function seed(adapter: DBAdapter, vn: VirtualNetwork) {
  let json = (value: unknown) =>
    adapter.kind === 'pg'
      ? [param(JSON.stringify(value)), '::jsonb']
      : [param(JSON.stringify(value))];
  let rows = [
    ...Object.entries(talks).map(([name, doc]) => ({
      url: `${testRealm}Talk/${name}`,
      def: talkRef,
      displayName: 'Talk',
      doc,
    })),
    ...Object.entries(concepts).map(([name, doc]) => ({
      url: `${testRealm}Concept/${name}`,
      def: conceptRef,
      displayName: 'Concept',
      doc,
    })),
  ];
  for (let [i, row] of rows.entries()) {
    await runQuery(adapter, [
      'INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, display_names, is_deleted, has_error, indexed_at, last_modified, resource_created_at) VALUES (',
      param(`${row.url}.json`),
      ',',
      param(row.url),
      ',',
      param(testRealm),
      ', 1,',
      param('instance'),
      ',',
      ...json({ id: row.url, type: 'card' }),
      ',',
      ...json({ id: row.url, ...row.doc }),
      ',',
      ...json([]),
      ',',
      ...json([internalKeyFor(row.def, undefined, vn)]),
      ',',
      ...json([row.displayName]),
      ',',
      param(false),
      ',',
      param(false),
      ',',
      param(Date.now()),
      ',',
      param(1_700_000_000 + i * 86_400),
      ',',
      param(1_700_000_000_000 + i * 3_600_000),
      ')',
    ] as any);
  }
  if (adapter.kind === 'pg') {
    await syncSeededValueStore(adapter as PgAdapter, testRealm);
  }
}

const on = talkRef;
const PARITY: [string, Query][] = [
  [
    'value facets: scalar, list and link, with stats, missing and prefix',
    {
      filter: { type: on },
      facets: [
        { by: 'channel', missing: true },
        { by: 'speakers', prefix: 'kle', order: 'value' },
        { by: 'concepts' },
        { by: 'cardTitle', stats: true },
        { by: 'hnScore', stats: true },
      ],
    },
  ],
  [
    'a facet counted without its own selection',
    {
      filter: { on, eq: { channel: 'strange loop' } },
      facets: [{ by: 'channel', own: 'ignore' }, { by: 'speakers' }],
    },
  ],
  [
    'a size cuts the values',
    {
      filter: { type: on },
      facets: [{ by: 'speakers', size: 2 }],
    },
  ],
  [
    'number and date ranges',
    {
      filter: { type: on },
      facets: [
        {
          by: 'hnScore',
          ranges: [
            { to: 10 },
            { from: 10, to: 30 },
            { key: 'hot', from: 30 },
            { from: 100 },
          ],
        },
        {
          by: 'released',
          ranges: [{ to: '2024-01-01' }, { from: '2024-01-01' }],
        },
      ],
    },
  ],
  [
    'date intervals over epochs and dates',
    {
      filter: { type: on },
      facets: [
        { by: 'lastDiscussed', interval: 'month' },
        { by: 'released', interval: 'week' },
      ],
    },
  ],
  [
    'a year interval',
    {
      filter: { type: on },
      facets: [{ by: 'released', interval: 'year' }],
    },
  ],
  [
    'a day interval in count order',
    {
      filter: { type: on },
      facets: [{ by: 'released', interval: 'day', order: 'count' }],
    },
  ],
  [
    'index fields',
    {
      filter: { type: on },
      facets: [{ by: '_type' }, { by: 'lastModified', interval: 'day' }],
    },
  ],
];

module(basename(import.meta.filename), function (hooks) {
  let pg: PgAdapter;
  let sqlite: NodeSQLiteAdapter;
  let pgEngine: IndexQueryEngine;
  let sqliteEngine: IndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    pg = await createTestPgAdapter();
    sqlite = new NodeSQLiteAdapter();
    let vn = new VirtualNetwork();
    pgEngine = new IndexQueryEngine(pg, makeDefinitionLookup(), vn);
    sqliteEngine = new IndexQueryEngine(
      sqlite as unknown as DBAdapter,
      makeDefinitionLookup(),
      vn,
    );
    await seed(pg, vn);
    await seed(sqlite as unknown as DBAdapter, vn);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(pg);
    await sqlite.close();
  });

  let realm = new URL(testRealm);
  let codes = (meta: { warnings?: { code: string }[] }) =>
    (meta.warnings ?? []).map((w) => w.code);

  for (let [name, q] of PARITY) {
    test(`parity: ${name}`, async function (assert) {
      let expected = (await pgEngine.searchCards(realm, q)).meta;
      let actual = (await sqliteEngine.searchCards(realm, q)).meta;
      assert.deepEqual(actual.facets, expected.facets, 'the counts');
      assert.deepEqual(actual.facetStats, expected.facetStats, 'the stats');
      assert.deepEqual(codes(actual), [], 'nothing approximated');
    });
  }

  test('over the row bound, the counts are of the rows read, and say so', async function (assert) {
    let { meta } = await sqliteEngine.searchCards(
      realm,
      {
        filter: { type: on },
        sort: [{ by: 'cardTitle', on }],
        facets: [{ by: 'channel' }],
      },
      { sqliteFacetLimits: { rows: 2 } } as QueryOptions,
    );
    assert.deepEqual(meta.facets?.channel, [
      { value: 'strange loop', count: 2 },
    ]);
    assert.deepEqual(codes(meta), ['sqlite-facet-sampled']);
    assert.true(
      /2 of 5/.test(meta.warnings![0].message),
      meta.warnings![0].message,
    );
  });

  test('out of time after the first chunk, the counts are of that chunk', async function (assert) {
    let ticks = 0;
    let { meta } = await sqliteEngine.searchCards(
      realm,
      {
        filter: { type: on },
        sort: [{ by: 'cardTitle', on }],
        facets: [{ by: 'channel' }],
      },
      {
        sqliteFacetLimits: {
          chunk: 3,
          budgetMs: 250,
          // each reading of the clock is a second later
          clock: () => ticks++ * 1000,
        },
      } as QueryOptions,
    );
    assert.deepEqual(meta.facets?.channel, [
      { value: 'strange loop', count: 2 },
      { value: 'goto', count: 1 },
    ]);
    assert.deepEqual(codes(meta), ['sqlite-facet-sampled']);
    assert.true(
      /3 of 5/.test(meta.warnings![0].message),
      meta.warnings![0].message,
    );
  });

  test('an interval in another zone buckets in UTC, and says so', async function (assert) {
    let q: Query = {
      filter: { type: on },
      facets: [{ by: 'released', interval: 'month' }],
    };
    let utc = (await pgEngine.searchCards(realm, q)).meta;
    let { meta } = await sqliteEngine.searchCards(realm, {
      ...q,
      timeZone: 'America/New_York',
    } as Query);
    assert.deepEqual(meta.facets, utc.facets, 'the UTC buckets');
    assert.deepEqual(codes(meta), ['sqlite-facet-interval-utc']);
  });

  test('a measure order answers without counts, and says so', async function (assert) {
    let { meta } = await sqliteEngine.searchCards(realm, {
      filter: { type: on },
      facets: [
        { by: 'channel', measure: { max: 'hnScore' }, order: 'measure' },
        { by: 'speakers' },
      ],
    } as Query);
    assert.deepEqual(meta.facets?.channel, []);
    assert.strictEqual(meta.facets?.speakers?.length, 4, 'the others count');
    assert.deepEqual(codes(meta), ['sqlite-facet-not-counted']);
  });

  test('an invalid facet is still refused', async function (assert) {
    try {
      await sqliteEngine.searchCards(realm, {
        filter: { type: on },
        facets: [{ by: 'released', interval: 'decade' }],
      } as unknown as Query);
      assert.ok(false, 'expected a refusal');
    } catch (e: any) {
      assert.strictEqual(e.code, 'invalid-value');
    }
  });

  test('a name the type lacks answers without counts: only the value store knows which cards hold it', async function (assert) {
    let { meta } = await sqliteEngine.searchCards(realm, {
      filter: { type: on },
      facets: [{ by: 'nope' }],
    });
    assert.deepEqual(meta.facets, { nope: [] });
    assert.deepEqual(codes(meta), ['sqlite-facet-not-counted']);
  });
});
