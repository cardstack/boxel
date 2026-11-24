// A corpus of talks on Postgres, seeded fresh for each test, that the
// search-cases-*-integration-test.ts files search.

import { format } from 'date-fns';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './index.ts';
const datetimeFormat = `yyyy-MM-dd'T'HH:mm`;

// Collapsing to one result per group, a facet's per-value measure, and
// relative dates in a range, on Postgres (docs/search.md).

export function ref(module: string, name: string): ResolvedCodeRef {
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

export const url = (name: string) => `${testRealm}Talk/${name}.json`;

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
export function setupTalkCorpus(hooks: NestedHooks) {
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
        searchData: searchData,
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
  return {
    get adapter() {
      return adapter;
    },
    get virtualNetwork() {
      return virtualNetwork;
    },
    get engine() {
      return engine;
    },
    get talkKey() {
      return talkKey;
    },
    on,
    search,
    byScore,
    addSavedList,
    reranked,
    byScoreDesc,
    refusal,
  };
}
