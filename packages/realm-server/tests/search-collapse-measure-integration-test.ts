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
  parseSearchEntryQueryFromPayload,
  policyScopedQuery,
  resolveRelativeDate,
  searchEntryWireQueryFromQuery,
  hasWarning,
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
import { withFacetFields } from './helpers/facet-fields.ts';

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
      search: { facet: true },
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
        searchData: await withFacetFields(
          searchData,
          talkDef,
          makeDefinitionLookup(),
        ),
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

  // A query in the newer spelling (an expression sort entry), as the engine
  // takes it.
  async function reranked(query: Record<string, any>) {
    let { results, meta } = await engine.search(
      new URL(testRealm),
      query as Query,
      {},
      { kind: 'renderSet' },
    );
    return {
      rows: results.map((r: any) => [
        r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        r._window == null ? null : Number(Number(r._window).toFixed(3)),
      ]),
      meta,
    };
  }
  const byScoreDesc = [{ on, by: 'hnScore', direction: 'desc' as const }];

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
      /non-empty string/,
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

  // A failed assert.throws whose callback did not throw crashes QUnit 2.26's
  // TAP reporter (it prints an undefined `actual`), ending the whole run.
  // These read the outcome themselves, so a failure is one failed assertion.
  function refusal(run: () => unknown): { code?: string; message: string } {
    try {
      run();
    } catch (e: any) {
      return {
        code: e instanceof InvalidQueryError ? e.code : e?.queryCode,
        message: String(e?.message ?? e),
      };
    }
    return { message: 'accepted' };
  }

  test('unknown members are refused with a code and the nearest name', function (assert) {
    let refused = (
      run: () => unknown,
      code: string,
      pattern: RegExp | undefined,
      label: string,
    ) => {
      let got = refusal(run);
      assert.strictEqual(got.code, code, `${label}: ${got.message}`);
      if (pattern) {
        assert.true(pattern.test(got.message), `${label}: ${got.message}`);
      }
    };
    let accepted = (run: () => unknown, label: string) => {
      let got = refusal(run);
      assert.strictEqual(got.message, 'accepted', label);
    };
    let typed = (q: Record<string, unknown>) => () =>
      assertQuery({ type: on, ...q });
    // an unknown top-level member is refused in both spellings
    refused(
      () => assertQuery({ fliter: { type: on } }),
      'unknown-key',
      /did you mean "filter"/,
      'the top level, older spelling',
    );
    refused(
      typed({ fliter: { eq: { title: 'A' } } }),
      'unknown-key',
      /did you mean "filter"/,
      'the top level, newer spelling',
    );
    // the newer spelling refuses an unknown member of a sort entry, a
    // filter node and the page, naming the nearest real one
    refused(
      typed({ sort: [{ by: 'hnScore', order: 'desc' }] }),
      'unknown-key',
      /order/,
      'a sort entry',
    );
    refused(
      typed({ sort: [{ by: 'hnScore', directon: 'desc' }] }),
      'unknown-key',
      /did you mean "direction"/,
      'a misspelled direction',
    );
    refused(
      typed({ filter: { eq: { title: 'A' }, colour: 'red' } }),
      'unknown-key',
      /colour/,
      'a filter node',
    );
    refused(
      typed({ page: { size: 10, cursor: 'x' } }),
      'unknown-key',
      /cursor/,
      'the page',
    );
    refused(
      typed({ page: { size: -1 } }),
      'invalid-page',
      undefined,
      'a negative size, newer spelling',
    );
    // the older spelling reads them as it always did: ignored
    accepted(
      () => assertQuery({ sort: [{ on, by: 'hnScore', order: 'desc' }] }),
      'a sort entry, older spelling',
    );
    accepted(
      () => assertQuery({ sort: [{ on, by: 'hnScore', directon: 'desc' }] }),
      'a misspelled direction, older spelling',
    );
    accepted(
      () => assertQuery({ filter: { on, eq: { title: 'A' }, colour: 'red' } }),
      'a filter node, older spelling',
    );
    accepted(
      () =>
        assertQuery({ filter: { type: on }, page: { size: 10, cursor: 'x' } }),
      'the page, older spelling',
    );
    accepted(
      () => assertQuery({ filter: { type: on }, page: { size: -1 } }),
      'a negative size is read as the default, older spelling',
    );
    refused(
      () =>
        assertQuery({ filter: { type: on }, page: { size: 10, number: -1 } }),
      'invalid-page',
      undefined,
      'a negative page number',
    );
    accepted(
      () => assertQuery({ filter: { type: on }, page: { size: 0 } }),
      'size 0 still asks for counts only',
    );
    // the wire refuses an unknown sort member in both spellings, as it
    // always has
    refused(
      () =>
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          sort: [{ by: 'item.hnScore', 'item.on': on, ordr: 'desc' }],
        }),
      'unknown-key',
      /ordr/,
      'the wire, older spelling',
    );
    refused(
      () =>
        parseSearchEntryQueryFromPayload({
          type: on,
          sort: [{ by: 'item.hnScore', ordr: 'desc' }],
        }),
      'unknown-key',
      /did you mean "order"|ordr/,
      'the wire, newer spelling',
    );
  });

  test('a blend or a near sort refuses a member it does not have', function (assert) {
    let refused = (payload: Record<string, unknown>, pattern: RegExp) => {
      let got = refusal(() => parseSearchEntryQueryFromPayload(payload));
      assert.strictEqual(
        got.code,
        'unknown-key',
        `${pattern.source}: ${got.message}`,
      );
      assert.true(
        pattern.test(got.message),
        `${pattern.source}: ${got.message}`,
      );
    };
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
    let nearSort = refusal(() =>
      assertQuery({ sort: [{ ...near, directon: 'asc' }] }),
    );
    assert.strictEqual(
      nearSort.code,
      'unknown-key',
      `a near sort entry: ${nearSort.message}`,
    );
    assert.true(
      /did you mean "direction"/.test(nearSort.message),
      nearSort.message,
    );
    let nearSignal = refusal(() =>
      assertQuery({
        sort: [{ by: '_blend', of: [{ ...near, zzz: 1 }] }],
      }),
    );
    assert.strictEqual(
      nearSignal.code,
      'unknown-key',
      `a near signal in a blend: ${nearSignal.message}`,
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
    let internal = refusal(() =>
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, matches: 'talk' },
        sort: [{ by: 'item._relevance', 'item.on': on }],
      }),
    );
    assert.strictEqual(internal.code, 'unknown-key', internal.message);
    assert.true(/is not a sort key/.test(internal.message), internal.message);
    // `_matchRelevance` was the text-relevance key before `textRelevance`,
    // and queries saved in realms name it: an older spelling still read
    let older = refusal(() =>
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, matches: 'talk' },
        sort: [{ by: 'item._matchRelevance', 'item.on': on }],
      }),
    );
    assert.strictEqual(older.message, 'accepted', 'item._matchRelevance');
  });
});
