import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VirtualNetwork,
  assertQuery,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// Facets beyond plain values, on Postgres (docs/search-intent.md, Facets):
// counting without a facet's own selection, statistics, range and date
// buckets, prefixes, missing counts, value order, and the shapes a field's
// `search: { facet }` declaration implies.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const talkRef = ref(`${testRealm}talk`, 'Talk');

const talkDef: Definition = {
  type: 'card-def',
  codeRef: talkRef,
  displayName: 'Talk',
  fields: {
    title: 'f0',
    channel: 'f4',
    speakers: 'f5',
    hnScore: 'f2',
    lastDiscussed: 'f3',
  },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'title' },
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'body' },
    },
    f2: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
      search: { rank: 'popularity', facet: true },
    },
    f3: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
      search: { facet: 'date' },
    },
    f4: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'label', facet: true },
    },
    f5: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'name', facet: true },
    },
  },
  search: { rank: { recency: 'lastDiscussed' } },
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === talkRef.module && codeRef.name === talkRef.name) {
        return talkDef;
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

const url = (name: string) => `${testRealm}Talk/${name}.json`;

const JAN = 1705276800; // 2024-01-15, in seconds
const FEB = 1707523200; // 2024-02-10
const MAR_MS = 1709424000000; // 2024-03-03, in milliseconds

const corpus: Record<string, Record<string, unknown>> = {
  a: {
    title: 'A',
    channel: 'Strange Loop',
    speakers: ['Kleppmann', 'Ada'],
    hnScore: 10,
    lastDiscussed: JAN,
  },
  b: {
    title: 'B',
    channel: 'Strange Loop',
    speakers: ['Kleppmann'],
    hnScore: 20,
    lastDiscussed: FEB,
  },
  c: {
    title: 'C',
    channel: 'GOTO',
    speakers: ['Klein'],
    hnScore: 35,
    lastDiscussed: FEB,
  },
  d: {
    title: 'D',
    channel: 'QCon',
    speakers: ['Bob'],
    hnScore: 50,
    lastDiscussed: MAR_MS,
  },
  e: { title: 'E', speakers: [], hnScore: 5, lastDiscussed: JAN },
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;
  let talkKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    talkKey = internalKeyFor(talkRef, undefined, virtualNetwork);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let [name, searchData] of Object.entries(corpus)) {
      let cardURL = new URL(url(name));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(talkRef.module), name: 'Talk' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData,
        markdown: String(searchData.title),
        deps: new Set(),
        displayNames: ['Talk'],
        types: [talkKey],
        isolatedHtml: `<div>${name}</div>`,
      });
    }
    await batch.done();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const on = talkRef;
  async function meta(query: Query) {
    return (await engine.searchCards(new URL(testRealm), query)).meta;
  }

  test("own: 'ignore' counts a facet without its own selection", async function (assert) {
    let { facets, page } = await meta({
      filter: {
        every: [{ type: on }, { on, in: { channel: ['Strange Loop'] } }],
      },
      facets: [{ by: 'channel', own: 'ignore' }, { by: 'speakers' }],
    });
    assert.strictEqual(page.total, 2, 'the selection still filters the page');
    assert.deepEqual(
      facets?.channel,
      [
        { value: 'Strange Loop', count: 2 },
        { value: 'GOTO', count: 1 },
        { value: 'QCon', count: 1 },
      ],
      'the channel list keeps its other values',
    );
    assert.deepEqual(
      facets?.speakers,
      [
        { value: 'Kleppmann', count: 2 },
        { value: 'Ada', count: 1 },
      ],
      'another facet counts under the selection',
    );
  });

  test('stats, prefix, missing and value order', async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [
        { by: 'speakers', prefix: 'kle', order: 'value' },
        { by: 'channel', missing: true },
        { by: 'title', stats: true },
      ],
    });
    assert.deepEqual(facets?.speakers, [
      { value: 'Klein', count: 1 },
      { value: 'Kleppmann', count: 2 },
    ]);
    assert.strictEqual(facetStats?.speakers?.order, 'value');
    assert.strictEqual(facetStats?.channel?.missing, 1, 'e has no channel');
    assert.deepEqual(
      { min: facetStats?.title?.min, max: facetStats?.title?.max },
      { min: 'A', max: 'E' },
      'text stats are min and max',
    );
  });

  test('explicit ranges count each bucket, empty ones too', async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [
        {
          by: 'hnScore',
          stats: true,
          ranges: [
            { to: 10 },
            { from: 10, to: 30 },
            { key: 'hot', from: 30 },
            { from: 100 },
          ],
        },
      ],
    });
    assert.deepEqual(facets?.hnScore, [
      { value: '*-10', count: 1 },
      { value: '10-30', count: 2 },
      { value: 'hot', count: 2 },
      { value: '100-*', count: 0 },
    ]);
    assert.deepEqual(facetStats?.hnScore, {
      count: 5,
      distinct: 5,
      values: 5,
      min: 5,
      max: 50,
      sum: 120,
      avg: 24,
    });
  });

  test('a number field declared facet: true comes back as range buckets with stats', async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [{ by: 'hnScore' }],
    });
    assert.deepEqual(facets?.hnScore, [
      { value: '0-10', count: 1 },
      { value: '10-20', count: 1 },
      { value: '20-30', count: 1 },
      { value: '30-40', count: 1 },
      { value: '40-50', count: 0 },
      { value: '50-60', count: 1 },
    ]);
    assert.strictEqual(facetStats?.hnScore?.max, 50);
  });

  test("a field declared facet: 'date' comes back as a monthly histogram", async function (assert) {
    let { facets, facetStats } = await meta({
      filter: { type: on },
      facets: [{ by: 'lastDiscussed' }],
    });
    assert.deepEqual(
      facets?.lastDiscussed,
      [
        { value: '2024-01-01', count: 2 },
        { value: '2024-02-01', count: 2 },
        { value: '2024-03-01', count: 1 },
      ],
      'seconds and milliseconds both read as instants',
    );
    assert.strictEqual(facetStats?.lastDiscussed?.order, 'value');
    let weekly = await meta({
      filter: { type: on },
      facets: [{ by: 'lastDiscussed', interval: 'week' }],
    });
    assert.strictEqual(
      weekly.facets?.lastDiscussed?.[0]?.value,
      '2024-01-15',
      'a week starts on Monday',
    );
  });

  test('a paged search counts plain and extended facets together', async function (assert) {
    let { facets, page } = await meta({
      filter: { type: on },
      page: { size: 2 },
      facets: [{ by: 'channel' }, { by: 'hnScore', ranges: [{ from: 30 }] }],
    });
    assert.strictEqual(page.total, 5);
    assert.deepEqual(facets?.channel?.[0], { value: 'Strange Loop', count: 2 });
    assert.deepEqual(facets?.hnScore, [{ value: '30-*', count: 2 }]);
  });

  test('the wire grammar checks the facet members', function (assert) {
    let bad = (facet: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery({ facets: [{ by: 'x', ...facet }] }),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    bad({ own: 'keep' }, /own must be "ignore"/);
    bad({ interval: 'hour' }, /interval must be one of/);
    bad({ ranges: [] }, /ranges must be a list/);
    bad({ ranges: [{}] }, /needs from or to/);
    bad({ ranges: [{ from: 1, to: 'z' }] }, /both be numbers or both/);
    bad({ ranges: [{ to: 1 }], interval: 'day' }, /ranges or interval/);
    bad({ order: 'random' }, /order must be/);
  });
});
