import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { format } from 'date-fns';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VirtualNetwork,
  assertQuery,
  combineSearchEntryResults,
  internalKeyFor,
  setCompareRowLimitForTests,
  setRerankScorer,
  setRerankTimeBudgetForTests,
  parseSearchEntryQueryFromPayload,
  policyScopedQuery,
  resolveRelativeDate,
  searchEntryWireQueryFromQuery,
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
import { RerankPool } from '@cardstack/runtime-common/rerank-pool';

const datetimeFormat = `yyyy-MM-dd'T'HH:mm`;

// Collapsing to one result per group, a facet's per-value measure, and
// relative dates in a range, on Postgres (docs/search.md).

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
    published: 'f6',
    day: 'f7',
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
    f6: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: ref('@cardstack/base/datetime', 'default'),
      serializerName: 'datetime',
    },
    f7: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: ref('@cardstack/base/date', 'default'),
      serializerName: 'date',
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
      // The base card, for a filter on `id` with no type anchor (the binding
      // a policy makes of linkedFrom).
      if (
        codeRef.module === '@cardstack/base/card-api' &&
        codeRef.name === 'CardDef'
      ) {
        return {
          type: 'card-def',
          codeRef,
          displayName: 'Card',
          fields: { id: 'id' },
          fieldDefs: {
            id: {
              type: 'contains',
              isPrimitive: true,
              isComputed: false,
              fieldOrCard: ref('@cardstack/base/string', 'default'),
            },
          },
        } as Definition;
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

const daysAgo = (n: number) => {
  let d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const asDatetime = (d: Date) => format(d, datetimeFormat);
const asDate = (d: Date) => d.toISOString().slice(0, 10);

const corpus: Record<string, Record<string, unknown>> = {
  a: {
    title: 'A',
    _title: 'A',
    speakers: ['Kleppmann'],
    channel: 'Strange Loop',
    hnScore: 10,
    published: asDatetime(daysAgo(1)),
    day: asDate(daysAgo(1)),
  },
  b: {
    title: 'B',
    channel: 'Strange Loop',
    hnScore: 30,
    published: asDatetime(daysAgo(10)),
    day: asDate(daysAgo(10)),
  },
  c: {
    title: 'C',
    channel: 'Strange Loop',
    hnScore: 20,
    published: asDatetime(daysAgo(45)),
    day: asDate(daysAgo(45)),
  },
  d: {
    title: 'D',
    channel: 'GOTO',
    hnScore: 50,
    published: asDatetime(daysAgo(400)),
    day: asDate(daysAgo(400)),
  },
  e: { title: 'E', channel: 'GOTO', hnScore: 40 },
  f: { title: 'F', hnScore: 5 },
  g: { title: 'G', hnScore: 1 },
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
  async function search(query: Query) {
    let { cards, meta } = await engine.searchCards(new URL(testRealm), query);
    return {
      titles: cards.map((c) => c.id!.split('/').pop()!.replace('.json', '')),
      meta,
    };
  }
  const byScore = [{ on, by: 'hnScore', direction: 'desc' as const }];

  test('collapse keeps the best card of each group by the sort', async function (assert) {
    let { titles, meta } = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on },
    });
    assert.deepEqual(
      titles,
      ['d', 'b', 'f', 'g'],
      'GOTO keeps d, Strange Loop keeps b, cards with no channel stay',
    );
    assert.strictEqual(meta.page.total, 4, 'the total counts what remains');
  });

  test('collapse keeps several per group, and pages over the groups', async function (assert) {
    let { titles, meta } = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on, keep: 2 },
      page: { number: 0, size: 3 },
    });
    assert.deepEqual(titles, ['d', 'e', 'b']);
    assert.strictEqual(meta.page.total, 6);
    let next = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on, keep: 2 },
      page: { number: 1, size: 3 },
    });
    assert.deepEqual(next.titles, ['c', 'f', 'g']);
    let past = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on },
      page: { number: 5, size: 3 },
    });
    assert.deepEqual(past.titles, []);
    assert.strictEqual(
      past.meta.page.total,
      4,
      'a page past the end still counts',
    );
  });

  test("each kept row carries its group's size", async function (assert) {
    let sizes = async (keep: number) =>
      (
        await engine.search(
          new URL(testRealm),
          {
            filter: { type: on },
            sort: byScore,
            collapse: { by: 'channel', on, keep },
          },
          {},
          { kind: 'renderSet' },
        )
      ).results.map((r: any) => [
        r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        Number(r._collapseSize),
      ]);
    assert.deepEqual(
      await sizes(1),
      [
        ['d', 2],
        ['b', 3],
        ['f', 1],
        ['g', 1],
      ],
      'GOTO holds 2, Strange Loop 3, a card with no channel stands alone',
    );
    assert.deepEqual(
      (await sizes(2)).slice(0, 2),
      [
        ['d', 2],
        ['e', 2],
      ],
      'every kept row of a group carries the same size',
    );
  });

  test('collapse takes the filter anchor, and facets count every match', async function (assert) {
    let { titles, meta } = await search({
      filter: { on, range: { hnScore: { gte: 10 } } },
      sort: byScore,
      collapse: 'channel',
      facets: [{ by: 'channel' }],
    });
    assert.deepEqual(titles, ['d', 'b']);
    assert.deepEqual(meta.facets?.channel, [
      { value: 'Strange Loop', count: 3 },
      { value: 'GOTO', count: 2 },
    ]);
  });

  test('a facet measure aggregates another field per value', async function (assert) {
    let { meta } = await search({
      filter: { type: on },
      facets: [
        { by: 'channel', measure: { avg: 'hnScore' }, order: 'measure' },
      ],
    });
    assert.deepEqual(meta.facets?.channel, [
      { value: 'GOTO', count: 2, measure: { avg: 45 } },
      { value: 'Strange Loop', count: 3, measure: { avg: 20 } },
    ]);
    let max = await search({
      filter: { type: on },
      facets: [{ by: 'channel', measure: { max: 'hnScore' } }],
    });
    assert.deepEqual(max.meta.facets?.channel, [
      { value: 'Strange Loop', count: 3, measure: { max: 30 } },
      { value: 'GOTO', count: 2, measure: { max: 50 } },
    ]);
  });

  test('a facet measure merges across realms', function (assert) {
    let merged = combineSearchEntryResults([
      {
        data: [],
        meta: {
          page: { total: 2 },
          facets: { brand: [{ value: 'X', count: 1, measure: { avg: 10 } }] },
        },
      },
      {
        data: [],
        meta: {
          page: { total: 3 },
          facets: { brand: [{ value: 'X', count: 3, measure: { avg: 30 } }] },
        },
      },
    ] as any);
    assert.deepEqual((merged as any).meta.facets.brand, [
      { value: 'X', count: 4, measure: { avg: 25 } },
    ]);
  });

  test('a range reads relative dates when the query runs', async function (assert) {
    let recent = await search({
      filter: { on, range: { published: { gte: 'now-30d' } } },
      sort: byScore,
    });
    assert.deepEqual(recent.titles, ['b', 'a'], 'datetime field');
    let days = await search({
      filter: { on, range: { day: { gte: 'now-30d/d', lt: 'now/d' } } },
      sort: byScore,
    });
    assert.deepEqual(days.titles, ['b', 'a'], 'date field, rounded to the day');
    let older = await search({
      filter: { on, range: { day: { lt: 'now-1y' } } },
    });
    assert.deepEqual(older.titles, ['d']);
  });

  test('relative dates resolve and round in UTC', function (assert) {
    let now = new Date('2026-11-07T15:42:10.500Z');
    assert.strictEqual(
      resolveRelativeDate('now', now),
      '2026-11-07T15:42:10.500Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now-30d', now),
      '2026-10-08T15:42:10.500Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now-1M/M', now),
      '2026-10-01T00:00:00.000Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now/w', now),
      '2026-11-02T00:00:00.000Z',
      'weeks start Monday',
    );
    assert.strictEqual(
      resolveRelativeDate('now+2h/h', now),
      '2026-11-07T17:00:00.000Z',
    );
    assert.strictEqual(
      resolveRelativeDate('2026-01-01', now),
      '2026-01-01',
      'a literal stays',
    );
  });

  test('a _when signal lifts matching cards without dropping the rest', async function (assert) {
    let plain = await search({
      filter: { type: on },
      sort: [{ by: '_blend', of: [{ on, by: 'hnScore' }] }],
    });
    assert.deepEqual(plain.titles, ['d', 'e', 'b', 'c', 'a', 'f', 'g']);
    let lifted = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            {
              by: '_when',
              when: { on, eq: { channel: 'Strange Loop' } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      lifted.titles,
      ['b', 'c', 'a', 'd', 'e', 'f', 'g'],
      'Strange Loop talks rise, and every card is still there',
    );
    assert.strictEqual(lifted.meta.page.total, 7);
  });

  test('a _when signal on a list field keeps cards whose list is empty', async function (assert) {
    let { titles } = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            {
              by: '_when',
              when: { on, eq: { speakers: 'Kleppmann' } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.strictEqual(titles[0], 'a', 'the speaker match leads');
    assert.strictEqual(titles.length, 7, 'no card dropped');
  });

  test('a negative blend weight inverts its signal', async function (assert) {
    let { titles } = await search({
      filter: { type: on },
      sort: [{ by: '_blend', of: [{ on, by: 'hnScore', weight: -1 }] }],
    });
    assert.deepEqual(
      titles,
      ['g', 'f', 'a', 'c', 'b', 'e', 'd'],
      'lowest score first',
    );
    let unless = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            { by: '_when', when: { on, eq: { channel: 'GOTO' } }, weight: -3 },
          ],
        },
      ],
    });
    assert.deepEqual(
      unless.titles,
      ['b', 'c', 'a', 'f', 'g', 'd', 'e'],
      'a negative _when lifts the cards that do not match',
    );
  });

  test('the entry wire grammar carries boost filters through item.', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      sort: [
        {
          blend: [
            { by: 'item.hnScore' },
            { boost: { eq: { 'item.channel': 'GOTO' } }, weight: 2 },
          ],
        },
      ],
    });
    assert.deepEqual((parsed.itemQuery.sort as any)[0].of[1], {
      by: '_when',
      when: { on, eq: { channel: 'GOTO' } },
      weight: 2,
    });
    assert.throws(
      () => assertQuery({ sort: [{ by: '_when', when: { type: on } }] }),
      /a boost ranks only inside a blend/,
    );
  });

  test('matches with fields searches only those fields, any case, stemmed', async function (assert) {
    let titles = async (filter: any) =>
      (
        await search({
          filter: { every: [{ type: on }, filter] },
          sort: byScore,
        })
      ).titles;
    assert.deepEqual(
      await titles({ on, matches: 'loops', fields: ['channel'] }),
      ['b', 'c', 'a'],
      'a stemmed word in the channel',
    );
    assert.deepEqual(
      await titles({ on, matches: 'goto', fields: ['channel'] }),
      ['d', 'e'],
      'case does not matter',
    );
    assert.deepEqual(
      await titles({ on, matches: 'kleppmann', fields: ['channel'] }),
      [],
      'a word in another field does not count',
    );
    assert.deepEqual(
      await titles({
        on,
        matches: 'kleppmann',
        fields: ['channel', 'speakers'],
      }),
      ['a'],
      'a list field counts its values',
    );
    assert.deepEqual(
      await titles({ not: { on, matches: 'strange', fields: ['channel'] } }),
      ['d', 'e', 'f', 'g'],
      'it negates cleanly, keeping cards with no value',
    );
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
      /card must be an absolute card URL/,
    );
  });

  async function addSavedList() {
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
      },
      markdown: 'Saved',
      deps: new Set(),
      displayNames: ['List'],
      types: [],
      isolatedHtml: '<div>saved</div>',
    });
    await batch.done();
    return `${testRealm}List/saved`;
  }

  test("a let binding of one card's links runs as a join", async function (assert) {
    let saved = await addSavedList();
    let { titles, meta } = await search({
      let: {
        saved: { from: { filter: { eq: { id: saved } } }, select: 'items.id' },
      },
      filter: { every: [{ type: on }, { in: { id: { $let: 'saved' } } }] },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'b', 'f']);
    assert.deepEqual(meta.lets, { saved: { strategy: 'join' } });
  });

  test('a let binding runs its query first and passes the values on', async function (assert) {
    // The channels of talks scoring 40 or more, then every talk on them.
    let { titles, meta } = await search({
      let: {
        hot: {
          from: { filter: { on, range: { hnScore: { gte: 40 } } } },
          select: 'channel',
        },
      },
      filter: {
        every: [{ type: on }, { on, in: { channel: { $let: 'hot' } } }],
      },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'e']);
    assert.deepEqual(meta.lets, { hot: { strategy: 'list', values: 1 } });

    // A card's links read some other way than by id fall back to a list.
    let saved = await addSavedList();
    let listed = await search({
      let: {
        saved: {
          from: { filter: { eq: { id: saved } } },
          select: 'items.id',
        },
      },
      filter: {
        every: [
          { type: on },
          { not: { in: { id: { $let: 'saved' } } } },
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

  test('a let list cut at its value limit says so', async function (assert) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let cardURL = new URL(url('h'));
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
      // a panel of 1,001 speakers, past the 1,000 values a list holds
      searchData: {
        title: 'H',
        hnScore: 2,
        speakers: Array.from({ length: 1001 }, (_, i) => `Speaker ${i}`),
      },
      markdown: 'H',
      deps: new Set(),
      displayNames: ['Talk'],
      types: [talkKey],
      isolatedHtml: '<div>h</div>',
    });
    await batch.done();
    let { titles, meta } = await search({
      let: {
        names: { from: { filter: { type: on } }, select: 'speakers' },
      },
      filter: { on, in: { speakers: { $let: 'names' } } },
      sort: byScore,
    });
    assert.deepEqual(titles, ['a', 'h'], 'the query ran with the first 1,000');
    assert.deepEqual(meta.lets, {
      names: { strategy: 'list', values: 1000, truncated: true },
    });
    assert.deepEqual(
      meta.warnings?.map((w) => w.code),
      ['binding-truncated'],
    );
    assert.ok(
      /"names" found more than 1,000 values/.test(meta.warnings![0].message),
      meta.warnings![0].message,
    );
  });

  test('a let binding reaches a _when signal, and an empty list matches nothing', async function (assert) {
    let { titles } = await search({
      let: {
        loop: {
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
              when: { on, in: { channel: { $let: 'loop' } } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.deepEqual(titles, ['b', 'c', 'a', 'd', 'e', 'f', 'g']);
    let none = await search({
      let: {
        nobody: {
          from: { filter: { on, eq: { channel: 'Nowhere' } } },
          select: 'channel',
        },
      },
      filter: {
        every: [{ type: on }, { on, in: { channel: { $let: 'nobody' } } }],
      },
    });
    assert.deepEqual(none.titles, []);
    assert.deepEqual(none.meta.lets, {
      nobody: { strategy: 'list', values: 0 },
    });
  });

  test('let bindings are checked, and travel the wire through item.', function (assert) {
    let bad = (query: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    bad(
      { filter: { in: { id: { $let: 'missing' } } } },
      /names no binding in let/,
    );
    bad({ let: { x: { select: 'a' } } }, /from must be a query/);
    bad(
      { let: { x: { from: { filter: { type: on } }, select: 'a b' } } },
      /select must be a field path/,
    );
    bad(
      {
        let: {
          x: {
            from: { filter: { type: on }, page: { size: 5000 } },
            select: 'a',
          },
        },
      },
      /page is \{ size \}/,
    );
    bad(
      {
        let: {
          x: { from: { filter: { in: { id: { $let: 'y' } } } }, select: 'a' },
          y: { from: { filter: { type: on } }, select: 'a' },
        },
      },
      /cannot use another binding/,
    );
    let parsed = parseSearchEntryQueryFromPayload({
      let: {
        hot: {
          from: {
            filter: { 'item.on': on, range: { 'item.hnScore': { gte: 40 } } },
          },
          select: 'item.channel',
        },
      },
      filter: { 'item.on': on, in: { 'item.channel': { $let: 'hot' } } },
    });
    assert.deepEqual(parsed.itemQuery.let, {
      hot: {
        from: { filter: { on, range: { hnScore: { gte: 40 } } } },
        select: 'channel',
      },
    });
    assert.deepEqual(parsed.itemQuery.filter, {
      on,
      in: { channel: { $let: 'hot' } },
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.strictEqual((wire.let as any).hot.select, 'item.channel');
  });

  test('a list binding goes only as the one value of an in', async function (assert) {
    let hot = {
      from: { filter: { on, range: { hnScore: { gte: 40 } } } },
      select: 'channel',
    };
    let refused = (filter: unknown, why: string) =>
      assert.throws(
        () => assertQuery({ let: { hot }, filter }),
        (err: unknown) =>
          err instanceof InvalidQueryError &&
          err.code === 'binding-kind' &&
          /only as the one value of an `in`/.test(err.message),
        why,
      );
    refused({ on, eq: { channel: { $let: 'hot' } } }, 'an eq value');
    refused(
      { on, in: { channel: { $let: 'hot' }, title: ['A'] } },
      'an in with another entry',
    );
    refused({ on, in: { channel: [{ $let: 'hot' }] } }, 'inside an in list');
    refused(
      { on, range: { hnScore: { gte: { $let: 'hot' } } } },
      'a range bound',
    );
    assert.throws(
      () =>
        assertQuery({
          let: { hot },
          filter: { type: on },
          sort: [{ on, by: 'hnScore' }],
          rerank: {
            expression: 'hnScore',
            compare: { filter: { on, eq: { channel: { $let: 'hot' } } } },
          },
        }),
      (err: unknown) =>
        err instanceof InvalidQueryError && err.code === 'binding-kind',
      "a rerank's comparison filter is checked too",
    );
    // The one place it goes still runs, in the filter and in a comparison set.
    let { titles } = await search({
      let: { hot },
      filter: { on, in: { channel: { $let: 'hot' } } },
      sort: byScore,
    });
    assert.deepEqual(titles, ['d', 'e']);
    let compared: Query = {
      let: { hot },
      filter: { type: on },
      sort: byScore,
      rerank: {
        expression: 'stats.hnScore.max',
        compare: { filter: { on, in: { channel: { $let: 'hot' } } } },
      },
    };
    assertQuery(compared);
    let { rows } = await reranked(compared);
    assert.deepEqual(
      [...new Set(rows.map((r) => r[1]))],
      [50],
      'the comparison set is the GOTO talks',
    );
  });

  test('under a policy, bindings and linkedFrom read only what the grants admit', function (assert) {
    let grant = { on, eq: { channel: 'GOTO' } };
    let scoped = policyScopedQuery(
      parseSearchEntryQueryFromPayload({
        let: {
          hot: {
            from: {
              filter: { 'item.on': on, range: { 'item.hnScore': { gte: 40 } } },
            },
            select: 'item.channel',
          },
        },
        filter: {
          every: [
            { 'item.on': on, in: { 'item.channel': { $let: 'hot' } } },
            { linkedFrom: { card: `${testRealm}List/saved`, field: 'items' } },
          ],
        },
      }),
      [grant],
    );
    let lets = scoped.itemQuery.let!;
    assert.deepEqual(lets.hot.from.filter, {
      every: [{ on, range: { hnScore: { gte: 40 } } }, { any: [grant] }],
    });
    assert.deepEqual(lets.__linkedFrom0, {
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
    assert.deepEqual(boosted.itemQuery.let?.__linkedFrom0?.from.filter, {
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
          mine: { from: { filter: saved }, select: 'item.channel' },
        },
        filter: { 'item.on': on, in: { 'item.channel': { $let: 'mine' } } },
      },
      /^\/let\/mine\/from\/filter:/,
    );
    refused(
      {
        filter: { 'item.on': on, range: { 'item.hnScore': { gte: 0 } } },
        rerank: {
          expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
          compare: { filter: saved },
        },
      },
      /^\/rerank\/compare\/filter:/,
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
        let: { __linkedFrom0: mine },
        filter: {
          every: [
            {
              'item.on': on,
              in: { 'item.channel': { $let: '__linkedFrom0' } },
            },
            { linkedFrom: { card: `${testRealm}List/saved`, field: 'items' } },
          ],
        },
      }),
      [grant],
    );
    let lets = scoped.itemQuery.let!;
    assert.deepEqual(
      lets.__linkedFrom0?.select,
      'channel',
      "the caller's binding keeps its name and its query",
    );
    let added = Object.keys(lets).filter((n) => n !== '__linkedFrom0');
    assert.strictEqual(
      added.length,
      1,
      'linkedFrom became a binding of its own',
    );
    assert.strictEqual(lets[added[0]].select, 'items.id');
    let text = JSON.stringify(scoped.itemQuery.filter);
    assert.true(
      text.includes('"$let":"__linkedFrom0"'),
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
        `b${n}`,
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

  test('explain gives each result its signals, ranks and shares', async function (assert) {
    let rows = async (query: Query) =>
      (
        await engine.search(
          new URL(testRealm),
          query,
          {},
          { kind: 'renderSet' },
        )
      ).results.map((r: any) => ({
        name: r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        explain: r._explain,
        score: Number(r._blendScore),
        stray: Object.keys(r).filter((k) => /^_x\d+_/.test(k)),
      }));
    let query: Query = {
      filter: { type: on },
      explain: true,
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            { by: '_when', when: { on, eq: { channel: 'GOTO' } }, weight: -2 },
          ],
        },
      ],
    };
    let all = await rows(query);
    let b = all.find((r) => r.name === 'b')!;
    assert.deepEqual(b.explain.signals, [
      {
        signal: 'hnScore',
        weight: 1,
        value: 30,
        rank: 3,
        contribution: 1 / 63,
      },
      {
        signal: 'when',
        weight: -2,
        inverted: true,
        value: 1,
        rank: 1,
        contribution: 2 / 61,
      },
    ]);
    assert.strictEqual(b.explain.k, 60);
    let d = all.find((r) => r.name === 'd')!;
    assert.strictEqual(
      d.explain.signals[1].rank,
      null,
      'a GOTO talk gets nothing from the inverted boost',
    );
    assert.strictEqual(d.explain.signals[1].contribution, 0);
    for (let r of all) {
      let sum = r.explain.signals.reduce(
        (t: number, x: any) => t + x.contribution,
        0,
      );
      assert.ok(
        Math.abs(sum - r.explain.score) < 1e-9,
        `${r.name}: the shares add up to the score`,
      );
      assert.deepEqual(
        r.stray,
        [],
        `${r.name}: no working columns left on the row`,
      );
    }
    let paged = await rows({ ...query, page: { number: 1, size: 2 } });
    assert.deepEqual(
      paged.map((r) => r.explain.signals[0].rank),
      [5, 6],
      'a page (a, f) carries ranks over the whole match set',
    );
    let plain = await rows({ ...query, explain: undefined });
    assert.strictEqual(plain[0].explain, undefined, 'nothing without explain');
  });

  test('explain names _relevance signals', async function (assert) {
    let { results } = await engine.search(
      new URL(testRealm),
      {
        filter: { on, matches: 'loop', fields: ['channel'] },
        explain: true,
        sort: [{ by: '_relevance', on, weights: { popularity: -1, text: 0 } }],
      },
      {},
      { kind: 'renderSet' },
    );
    let signals = (results[0] as any)._explain.signals;
    assert.deepEqual(
      signals.map((x: any) => [x.signal, x.weight, x.inverted ?? false]),
      [
        ['popularity', -1, true],
        ['recency', 0.5, false],
      ],
    );
    assert.strictEqual(
      (results[0] as any).url,
      `${testRealm}Talk/a.json`,
      'least popular first',
    );
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
      /an expression sort takes by, expr, on, direction and weight/,
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

  async function reranked(query: Query) {
    let { results, meta } = await engine.search(
      new URL(testRealm),
      query,
      {},
      { kind: 'renderSet' },
    );
    return {
      rows: results.map((r: any) => [
        r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        r._rerank == null ? null : Number(Number(r._rerank).toFixed(3)),
      ]),
      meta,
    };
  }
  const byScoreDesc = [{ on, by: 'hnScore', direction: 'desc' as const }];

  test('rerank orders the top of a result by any Excel formula', async function (assert) {
    // A text function the score profile refuses: Strange Loop talks first.
    let { rows, meta } = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      // `title` beside the engine's synthetic `_title`, as every card has.
      rerank: {
        expression:
          'IF(ISNUMBER(SEARCH("loop", channel)), 1, 0) + LEN(title) * 0',
      },
    });
    assert.deepEqual(
      rows.map((r) => r[0]),
      ['b', 'c', 'a', 'd', 'e', 'f', 'g'],
      'matching rows lead, each group keeping the query order',
    );
    // A SEARCH that finds nothing is #VALUE!, which ISNUMBER reads as FALSE,
    // as in Excel: every talk gets a value.
    assert.deepEqual(meta.rerank, { window: 7, scored: 7, ran: 'thread' });
    assert.strictEqual(meta.page.total, 7);

    let windowed = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      page: { number: 0, size: 3 },
      rerank: { expression: '100 - hnScore', top: 4 },
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
      sort: byScoreDesc,
      page: { number: 1, size: 4 },
      rerank: { expression: '100 - hnScore', top: 4 },
    });
    assert.deepEqual(
      past.rows.map((r) => r[0]),
      ['a', 'f', 'g'],
      'a page past the window keeps the query order',
    );
  });

  test('a page that runs past the rerank window is filled in the query order', async function (assert) {
    let pageOf = (number: number) =>
      reranked({
        filter: { type: on },
        sort: byScoreDesc,
        page: { number, size: 3 },
        rerank: { expression: '100 - hnScore', top: 4 },
      });
    let straddling = await pageOf(1);
    assert.deepEqual(
      straddling.rows,
      [
        ['d', 50],
        ['a', null],
        ['f', null],
      ],
      'the last re-ranked row, then the rows after the window, unscored',
    );
    let seen: string[] = [];
    for (let number of [0, 1, 2]) {
      seen.push(...(await pageOf(number)).rows.map((r) => r[0] as string));
    }
    assert.deepEqual(
      seen,
      ['c', 'b', 'e', 'd', 'a', 'f', 'g'],
      'every match once, with no gap after the window',
    );
    assert.strictEqual(straddling.meta.rerank?.window, 4);
    assert.true(straddling.meta.rerank?.truncated);
  });

  test('a reranked page keeps what the query computed for each row', async function (assert) {
    let page = async (query: Query, opts = {}) =>
      (
        await engine.search(new URL(testRealm), query, opts, {
          kind: 'renderSet',
        })
      ).results as Record<string, any>[];
    let rows = await page(
      {
        filter: { type: on },
        explain: true,
        sort: [{ by: '_blend', of: [{ on, by: 'hnScore' }] }],
        collapse: { by: 'channel', on },
        page: { number: 0, size: 3 },
        rerank: { expression: '100 - hnScore', top: 4 },
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
        [row._rerank],
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

    // A SQL expression sort keeps its own values and report beside a rerank.
    let both = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        sort: [{ by: '_expr', on, expr: 'hnScore * 2' }],
        rerank: { expression: '100 - hnScore', top: 3 },
      },
      {},
      { kind: 'renderSet' },
    );
    assert.deepEqual(both.meta.expression, { placement: 'sql' });
    let d = both.results.find((r: any) => r.url === url('d')) as any;
    assert.strictEqual(Number(d._expression), 100, "the sort's value");
    assert.strictEqual(Number(d._rerank), 50, "the rerank's value");

    // A rerank alone is not an expression of the query's.
    let alone = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        sort: byScore,
        rerank: { expression: '100 - hnScore', top: 3 },
      },
      {},
      { kind: 'renderSet' },
    );
    assert.strictEqual(alone.meta.expression, undefined);
    assert.ok(alone.meta.rerank, 'the rerank reports itself');
    assert.notOk(
      alone.results.some((r: any) => '_expression' in r),
      'no row carries an expression value',
    );

    // An expression placed over the top window still says so.
    let top = await engine.search(
      new URL(testRealm),
      {
        filter: { type: on },
        sort: [{ expression: '100 - hnScore', placement: 'top' }],
        type: on,
      } as unknown as Query,
      {},
      { kind: 'renderSet' },
    );
    assert.strictEqual(top.meta.expression?.placement, 'top');
    assert.ok(
      top.results.every((r: any) => r._expression === r._rerank),
      "each row's expression value is its rerank value",
    );
  });

  test('a rerank says when its window or its comparison set was cut short', async function (assert) {
    let whole = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      rerank: { expression: 'hnScore / stats.hnScore.median' },
    });
    assert.notOk(whole.meta.rerank?.truncated, 'a window holding every match');
    assert.notOk(whole.meta.rerank?.compareTruncated, 'a whole comparison set');

    let top = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      rerank: { expression: 'hnScore / stats.hnScore.median', top: 4 },
    });
    assert.true(
      top.meta.rerank?.truncated,
      'seven matches, four re-ranked: the rest keep the query order',
    );

    setCompareRowLimitForTests(3);
    try {
      let capped = await reranked({
        filter: { type: on },
        sort: byScoreDesc,
        rerank: { expression: 'hnScore / stats.hnScore.median' },
      });
      assert.deepEqual(
        capped.meta.rerank?.compareTruncated,
        { rows: 3, total: 7 },
        'the set read three of its seven rows, and says so',
      );
    } finally {
      setCompareRowLimitForTests(undefined);
    }
  });

  test('rerank compares each row with its peers', async function (assert) {
    let { rows } = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      rerank: {
        expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
        compare: { by: 'channel' },
      },
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
      sort: byScoreDesc,
      rerank: {
        expression: 'hnScore / stats.hnScore.median',
        direction: 'asc',
      },
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
      rerank: {
        expression: '(hnScore - stats.hnScore.avg) / stats.hnScore.stdev',
        compare: { filter: { type: on } },
      },
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

  test('rerank is checked, travels the wire, and a policy scopes its comparison set', function (assert) {
    assert.throws(
      () => assertQuery({ rerank: { expression: 'x', top: 501 } } as any),
      /top must be an integer from 1 to 500/,
    );
    assert.throws(
      () =>
        assertQuery({
          rerank: { expression: 'x', compare: { by: 'a b' } },
        } as any),
      /by must be a field path/,
    );
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      rerank: {
        expression: 'PERCENTRANK_INC(peers.hnScore, hnScore)',
        top: 50,
        compare: {
          filter: { 'item.on': on, eq: { 'item.channel': 'GOTO' } },
          by: 'item.channel',
        },
      },
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
        () => assertQuery({ rerank: { expression: 'x', compare } } as any),
        pattern,
      );
    bad({ near: 'embedding', by: 'channel' }, /near or by, not both/);
    bad({ near: 'embedding', k: 0 }, /k goes with near/);
    bad({ k: 5 }, /k goes with near/);
    bad({ minSimilarity: 0.5 }, /minSimilarity goes with near/);
    bad({ near: 'a b' }, /near names a vector field/);
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      rerank: {
        expression: 'priceMin / stats.priceMin.median',
        compare: { near: 'item.imageEmbedding', k: 20, minSimilarity: 0.8 },
      },
    });
    assert.deepEqual(parsed.itemQuery.rerank!.compare, {
      near: 'imageEmbedding',
      k: 20,
      minSimilarity: 0.8,
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.strictEqual(
      (wire.rerank as any).compare.near,
      'item.imageEmbedding',
    );
    let grant = { on, eq: { channel: 'GOTO' } };
    let scoped = policyScopedQuery(parsed, [grant]);
    assert.deepEqual(
      scoped.itemQuery.rerank!.compare!.filter,
      { any: [grant] },
      "a row's look-alikes reach only the cards the grants admit",
    );
  });

  test('a rerank formula that does not compile is refused', async function (assert) {
    await assert.rejects(
      engine.search(
        new URL(testRealm),
        { filter: { type: on }, rerank: { expression: 'IF(' } },
        {},
        { kind: 'renderSet' },
      ),
      /rerank: the formula does not compile/,
    );
  });

  test('a rerank formula SQL can run is scored in Postgres', async function (assert) {
    let { rows, meta } = await reranked({
      filter: { type: on },
      sort: byScoreDesc,
      rerank: { expression: 'IFERROR(100 / (hnScore - 30), -1)', top: 4 },
    });
    assert.strictEqual(meta.rerank?.ran, 'sql', 'it ran in Postgres');
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

  test('a rerank formula SQL cannot run is scored on the thread pool', async function (assert) {
    let pool = new RerankPool(1);
    setRerankScorer(pool.scorer);
    try {
      let { rows, meta } = await reranked({
        filter: { type: on },
        sort: byScoreDesc,
        rerank: {
          expression:
            'IF(ISNUMBER(SEARCH("loop", channel)), 1, 0) + LEN(title) * 0',
        },
      });
      assert.deepEqual(
        rows.map((r) => r[0]),
        ['b', 'c', 'a', 'd', 'e', 'f', 'g'],
        'the same order as in this thread',
      );
      assert.deepEqual(meta.rerank, { window: 7, scored: 7, ran: 'thread' });
      assert.strictEqual(pool.running, 1, 'one thread scored it');
      await assert.rejects(
        engine.search(
          new URL(testRealm),
          { filter: { type: on }, rerank: { expression: 'IF(' } },
          {},
          { kind: 'renderSet' },
        ),
        /rerank: the formula does not compile/,
        "a formula the thread cannot compile is the caller's error",
      );
    } finally {
      setRerankScorer(undefined);
      await pool.terminate();
    }
  });

  test('a rerank out of time keeps the query order and says so', async function (assert) {
    setRerankTimeBudgetForTests(0);
    try {
      let { rows, meta } = await reranked({
        filter: { type: on },
        sort: byScoreDesc,
        rerank: {
          expression:
            'IF(ISNUMBER(SEARCH("loop", channel)), 1, 0) + LEN(title) * 0',
        },
      });
      assert.deepEqual(
        rows,
        ['d', 'e', 'b', 'c', 'a', 'f', 'g'].map((k) => [k, null]),
        "the query's own order (by score), with no row scored",
      );
      assert.deepEqual(meta.rerank, { window: 7, scored: 0, ran: 'thread' });
      assert.deepEqual(
        meta.warnings?.map((w) => w.code),
        ['rerank-timeout'],
      );
    } finally {
      setRerankTimeBudgetForTests(undefined);
    }
  });

  test('the rerank pool stops a thread still scoring at its deadline', async function (assert) {
    let pool = new RerankPool(1);
    try {
      let past = await pool.scorer('1', [{}], Date.now() - 1);
      assert.deepEqual(past, { values: [], timedOut: true }, 'already late');
      assert.strictEqual(pool.running, 0, 'and no thread was started');
      // A new thread loads BXL before it scores, which takes far longer than
      // this: it is stopped at the deadline rather than left running.
      let late = await pool.scorer('1 + 1', [{}], Date.now() + 5);
      assert.true(late.timedOut, 'the slow start times out');
      assert.strictEqual(pool.running, 0, 'and its thread is gone');
      let fine = await pool.scorer(
        'rating * 2',
        [{ rating: 3 }, {}],
        Date.now() + 30_000,
      );
      assert.deepEqual(fine, { values: [6, 0], timedOut: false });
    } finally {
      await pool.terminate();
    }
  });

  test('the wire grammar checks collapse and measure', function (assert) {
    let bad = (query: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    bad({ collapse: 3 }, /collapse must be a field path/);
    bad({ collapse: { by: 'x', keep: 0 } }, /keep must be an integer/);
    bad({ collapse: { by: 'x', group: true } }, /unknown collapse member/);
    bad(
      { facets: [{ by: 'x', measure: { median: 'y' } }] },
      /measure must be one of/,
    );
    bad(
      { facets: [{ by: 'x', measure: { avg: 'y', max: 'y' } }] },
      /measure must be one of/,
    );
    bad({ facets: [{ by: 'x', order: 'measure' }] }, /needs a measure/);
    bad(
      { facets: [{ by: 'x', measure: { avg: 'y' }, interval: 'day' }] },
      /no ranges or interval/,
    );
  });

  test('the entry wire grammar carries collapse through item.', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, eq: { 'item.channel': 'GOTO' } },
      collapse: 'item.channel',
    });
    assert.deepEqual(parsed.itemQuery.collapse, { by: 'channel', on });
    let scoped = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, matches: 'metal', fields: ['item.channel'] },
    });
    assert.deepEqual(scoped.itemQuery.filter, {
      on,
      matches: 'metal',
      fields: ['channel'],
    });
    assert.throws(
      () => assertQuery({ filter: { on, matches: 'x', fields: [] } } as any),
      /fields must list 1 to 8 field paths/,
    );
    assert.throws(
      () =>
        assertQuery({
          filter: { on, matches: 'x', fields: ['a'], scope: 'title' },
        } as any),
      /takes no scope, within or prefix/,
    );
    let wire = searchEntryWireQueryFromQuery({
      collapse: { by: 'channel', on, keep: 2 },
    });
    assert.deepEqual(wire.collapse, {
      by: 'item.channel',
      'item.on': on,
      keep: 2,
    });
  });
  test("a one-card let binding's values stand in where values go", async function (assert) {
    let top = {
      from: { filter: { on, eq: { title: 'D' } } },
      one: true as const,
    };
    let same = await search({
      let: { top },
      filter: { on, eq: { channel: { $let: 'top', path: 'channel' } } },
      sort: byScore,
    });
    assert.deepEqual(same.titles, ['d', 'e'], "an eq reads the card's channel");
    assert.deepEqual(same.meta.lets, {
      top: { strategy: 'card', found: true },
    });
    let lower = await search({
      let: { top },
      filter: {
        on,
        range: { hnScore: { lt: { $let: 'top', path: 'hnScore' } } },
      },
      sort: byScore,
    });
    assert.deepEqual(
      lower.titles,
      ['e', 'b', 'c', 'a', 'f', 'g'],
      'a range bound reads its score',
    );
    let { rows } = await reranked({
      let: { top },
      filter: { type: on },
      sort: byScoreDesc,
      rerank: { expression: 'top.hnScore - hnScore', direction: 'asc' },
    });
    assert.deepEqual(
      rows.slice(0, 3),
      [
        ['d', 0],
        ['e', 10],
        ['b', 20],
      ],
      'a rerank formula reads the card under its name',
    );
  });

  test('a one-card binding that finds nothing reads null', async function (assert) {
    let none = {
      from: { filter: { on, eq: { title: 'Z' } } },
      one: true as const,
    };
    let bounded = await search({
      let: { none },
      filter: {
        on,
        range: { hnScore: { lt: { $let: 'none', path: 'hnScore' } } },
      },
    });
    assert.deepEqual(bounded.titles, [], 'a null bound matches nothing');
    assert.deepEqual(bounded.meta.lets, {
      none: { strategy: 'card', found: false },
    });
    let missing = await search({
      let: { none },
      filter: { on, eq: { channel: { $let: 'none', path: 'channel' } } },
      sort: byScore,
    });
    assert.deepEqual(
      missing.titles,
      ['f', 'g'],
      'eq null finds the cards with no value',
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
    bad({ let: { top: { ...top, select: 'a' } } }, /or \{ from, one: true \}/);
    bad({ let: { top: { ...top, one: 1 } } }, /or \{ from, one: true \}/);
    bad(
      { let: { top }, filter: { in: { id: { $let: 'top' } } } },
      /is one card/,
    );
    bad(
      {
        let: {
          top,
          x: {
            from: {
              filter: { on, eq: { channel: { $let: 'top', path: 'channel' } } },
            },
            select: 'a',
          },
        },
      },
      /cannot use another binding/,
    );
    assertQuery({
      let: { top },
      filter: {
        every: [
          { on, eq: { channel: { $let: 'top', path: 'channel' } } },
          { on, range: { hnScore: { lt: { $let: 'top', path: 'hnScore' } } } },
        ],
      },
      sort: [{ on, by: 'hnScore', direction: 'desc' }],
    });
    assert.ok(true, 'references pass where values go');
    let parsed = parseSearchEntryQueryFromPayload({
      let: {
        top: {
          from: { filter: { 'item.on': on, eq: { 'item.title': 'D' } } },
          one: true,
        },
      },
      filter: {
        'item.on': on,
        range: { 'item.hnScore': { lt: { $let: 'top', path: 'hnScore' } } },
      },
    });
    assert.deepEqual(parsed.itemQuery.let, {
      top: { from: { filter: { on, eq: { title: 'D' } } }, one: true },
    });
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery);
    assert.deepEqual((wire.let as any).top, {
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
        top: {
          from: {
            type: on,
            filter: { eq: { channel: 'GOTO' } },
            sort: [{ by: 'hnScore', direction: 'desc' }],
          },
          one: true,
        },
      },
      filter: { range: { hnScore: { lte: { $let: 'top', path: 'hnScore' } } } },
    });
    assert.deepEqual(
      (bound.itemQuery.let as any).top.from,
      {
        filter: { on, every: [{ eq: { channel: 'GOTO' } }] },
        sort: [{ by: 'hnScore', direction: 'desc', on }],
      },
      "a binding's own query lowers with its own type",
    );
    let topWindow = parseSearchEntryQueryFromPayload({
      type: on,
      sort: [{ expression: 'IF(ISNUMBER(SEARCH("a", title)), 1, 0)' }],
    });
    assert.strictEqual(
      topWindow.itemQuery.rerank?.expression,
      'IF(ISNUMBER(SEARCH("a", title)), 1, 0)',
      'a formula outside the score profile runs over the top window',
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
      /non-empty string/,
    );
    refused(
      { type: on, sort: [{ expression: 'hnScore', placement: 'gpu' }] },
      'invalid-expression',
      /"sql" or "top"/,
    );
    refused(
      { type: on, sort: [{ expression: textual, placement: 'sql' }] },
      'expression-placement',
      /cannot run as SQL/,
    );
    refused(
      { type: on, sort: [{ by: 'hnScore' }, { expression: textual }] },
      'expression-placement',
      /must be the first sort key/,
    );
    refused(
      { type: on, sort: [{ expression: textual }], collapse: 'channel' },
      'expression-placement',
      /collapse/,
    );
    refused(
      {
        type: on,
        sort: [{ expression: textual }],
        rerank: { expression: 'hnScore', top: 50 },
      },
      'expression-placement',
      /already has a rerank/,
    );
    refused(
      {
        type: on,
        sort: [{ blend: [{ by: 'hnScore' }, { expression: textual }] }],
      },
      'expression-placement',
      /in a blend runs as SQL/,
    );
    let sqlPlaced = parseSearchEntryQueryFromPayload({
      type: on,
      sort: [
        { by: 'hnScore' },
        { expression: 'hnScore * 2', placement: 'sql' },
      ],
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
  test('a formula that overflows in SQL runs over the top window instead', async function (assert) {
    let plain = await search({
      filter: { type: on },
      sort: [{ by: '_expr', expr: 'hnScore * 2', direction: 'desc' }],
    } as Query);
    assert.strictEqual(plain.meta.expression?.placement, 'sql');
    // 1e300 squared is past a double: Postgres raises, JavaScript gives #NUM!
    let { titles, meta } = await search({
      filter: { type: on },
      sort: [
        {
          by: '_expr',
          expr: 'IF(hnScore > 25, 1e300 * 1e300, hnScore)',
          direction: 'desc',
        },
      ],
    } as Query);
    assert.strictEqual(meta.expression?.placement, 'top');
    assert.ok(/overflows/.test(meta.expression?.reason ?? ''), 'it says why');
    assert.ok(titles.length > 0, 'the search still answers');
  });

  test('unknown members are refused with a code and the nearest name', function (assert) {
    let refused = (query: unknown, code: string, pattern?: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (e: any) =>
          e instanceof InvalidQueryError &&
          e.code === code &&
          (!pattern || pattern.test(e.message)),
      );
    refused({ fliter: { type: on } }, 'unknown-key', /did you mean "filter"/);
    refused(
      { sort: [{ on, by: 'hnScore', order: 'desc' }] },
      'unknown-key',
      /order/,
    );
    refused(
      { sort: [{ on, by: 'hnScore', directon: 'desc' }] },
      'unknown-key',
      /did you mean "direction"/,
    );
    refused(
      { filter: { on, eq: { title: 'A' }, colour: 'red' } },
      'unknown-key',
      /colour/,
    );
    refused(
      { filter: { type: on }, page: { size: 10, cursor: 'x' } },
      'unknown-key',
      /cursor/,
    );
    refused({ filter: { type: on }, page: { size: -1 } }, 'invalid-page');
    refused(
      { filter: { type: on }, page: { size: 10, number: -1 } },
      'invalid-page',
    );
    assertQuery({ filter: { type: on }, page: { size: 0 } });
    assert.ok(true, 'size 0 still asks for counts only');
    assert.throws(
      () =>
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          sort: [{ by: 'item.hnScore', 'item.on': on, ordr: 'desc' }],
        }),
      (e: any) => e.queryCode === 'unknown-key',
    );
  });

  test('a blend or a near sort refuses a member it does not have', function (assert) {
    let refused = (payload: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => parseSearchEntryQueryFromPayload(payload),
        (e: any) => e.queryCode === 'unknown-key' && pattern.test(e.message),
        pattern.source,
      );
    let signals = [{ by: 'item.hnScore', 'item.on': on }];
    refused(
      {
        filter: { 'item.on': on },
        sort: [{ blend: signals, fusion: 'linear' }],
      },
      /unknown blend member "fusion"; did you mean "method"\?/,
    );
    refused(
      { filter: { 'item.on': on }, sort: [{ blend: signals, zzz: 1 }] },
      /unknown blend member "zzz" \(a blend takes blend, method, k, direction\)/,
    );
    refused(
      { filter: { 'item.on': on }, sort: [{ blend: signals, metod: 'rrf' }] },
      /did you mean "method"/,
    );
    let near = { by: 'embedding', on, near: [1, 0] };
    assert.throws(
      () => assertQuery({ sort: [{ ...near, directon: 'asc' }] }),
      (e: any) =>
        e instanceof InvalidQueryError &&
        e.code === 'unknown-key' &&
        /did you mean "direction"/.test(e.message),
      'a near sort entry',
    );
    assert.throws(
      () =>
        assertQuery({
          sort: [{ by: '_blend', of: [{ ...near, zzz: 1 }] }],
        }),
      (e: any) => e instanceof InvalidQueryError && e.code === 'unknown-key',
      'a near signal in a blend',
    );
    assertQuery({ sort: [{ ...near, direction: 'asc' }] });
    assertQuery({
      sort: [{ by: '_blend', of: [{ ...near, weight: 2 }], k: 60 }],
    });
    assert.ok(true, 'the members they have still pass');
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
  test('relevance and textRelevance are the request names; the engine names are not', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      type: on,
      filter: { matches: 'talk' },
      sort: [
        { relevance: { text: 1, popularity: 0 } },
        { blend: [{ by: 'item.textRelevance' }, { by: 'item.hnScore' }] },
      ],
    });
    let [rel, blend] = parsed.itemQuery.sort as any[];
    assert.strictEqual(rel.by, '_relevance');
    assert.deepEqual(rel.weights, { text: 1, popularity: 0 });
    assert.strictEqual(blend.of[0].by, '_matchRelevance');
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery) as any;
    assert.deepEqual(wire.sort[0].relevance, { text: 1, popularity: 0 });
    assert.strictEqual(wire.sort[1].blend[0].by, 'item.textRelevance');
    for (let by of ['item._relevance', 'item._matchRelevance']) {
      assert.throws(
        () =>
          parseSearchEntryQueryFromPayload({
            filter: { 'item.on': on, matches: 'talk' },
            sort: [{ by, 'item.on': on }],
          }),
        (e: any) =>
          /is not a sort key/.test(e.message) && e.queryCode === 'unknown-key',
      );
    }
  });
});
