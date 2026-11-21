import type { SearchEntryQuery } from '@cardstack/runtime-common/query-v2/search-entry';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { hasVectorIndex } from '@cardstack/runtime-common/vector-index';
import type { EntryCollectionDocument } from '@cardstack/runtime-common/query-v2/document-types';
import type { EntryResource } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './index.ts';
import { definitionsLookup } from './definition-lookup.ts';

// Realms on the real engine, for federated search tests. Each realm's rows
// are written to one test database through the real index writer, under that
// realm's URL, as cards of one type. A realm stand-in answers a search of its
// own rows with `IndexQueryEngine.search` and carries on each entry what a
// realm's entries carry: its scores and, when the merge asks, its sort values.

export type RealmStandIn = {
  url: string;
  searchEntries: (q: SearchEntryQuery) => Promise<EntryCollectionDocument>;
};

export interface EngineRealms {
  adapter: PgAdapter;
  engine: IndexQueryEngine;
  // whether the database has the vector index
  vectors: boolean;
  lookup: DefinitionLookup;
  realm: (url: string) => RealmStandIn;
}

// The row meta a realm's entries carry; numbers except these two.
const SCORES = [
  '_matchRelevance',
  '_nearSimilarity',
  '_blendScore',
  '_collapseSize',
  '_sortValues',
];
const AS_IS = new Set(['_sortValues', '_explain']);

export const cardURLOf = (realm: string, id: string) => `${realm}${id}.json`;

export function engineRealms<R extends { id: string }>(
  hooks: NestedHooks,
  opts: {
    definition: Definition;
    corpus: Record<string, R[]>;
    // a row's search doc and markdown
    entry: (
      row: R,
      ctx: EngineRealms,
    ) => Promise<{ searchData: Record<string, unknown>; markdown?: string }>;
    // row meta carried beside the default scores
    moreScores?: string[];
  },
): EngineRealms {
  let { definition, corpus } = opts;
  let ref = definition.codeRef as ResolvedCodeRef;
  let scores = [...SCORES, ...(opts.moreScores ?? [])];
  let ctx = {} as EngineRealms;
  hooks.beforeEach(async function () {
    prepareTestDB();
    ctx.adapter = await createTestPgAdapter();
    ctx.vectors = await hasVectorIndex(ctx.adapter);
    ctx.lookup = definitionsLookup([definition]);
    let network = new VirtualNetwork();
    ctx.engine = new IndexQueryEngine(ctx.adapter, ctx.lookup, network);
    let typeKey = internalKeyFor(ref, undefined, network);
    for (let [realmURL, rows] of Object.entries(corpus)) {
      let batch = await new IndexWriter(ctx.adapter).createBatch(
        new URL(realmURL),
        network,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let row of rows) {
        let cardURL = new URL(cardURLOf(realmURL, row.id));
        let { searchData, markdown } = await opts.entry(row, ctx);
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(ref.module), name: ref.name } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData,
          ...(markdown !== undefined ? { markdown } : {}),
          deps: new Set(),
          displayNames: [definition.displayName ?? ref.name],
          types: [typeKey],
          isolatedHtml: `<div>${row.id}</div>`,
        });
      }
      await batch.done();
    }
    ctx.realm = (url: string) => ({
      url,
      searchEntries: async (q: SearchEntryQuery) => {
        let { results, meta } = await ctx.engine.search(
          new URL(url),
          q.itemQuery,
          q.exposeSortValues ? { exposeSortValues: true } : {},
          { kind: 'dataOnly' },
        );
        return {
          data: results.map((row: any) => ({
            type: 'entry' as const,
            id: row.url,
            relationships: {},
            meta: Object.fromEntries(
              scores
                .filter((k) => row[k] !== undefined)
                .map((k) => [
                  k,
                  AS_IS.has(k) || row[k] == null ? row[k] : Number(row[k]),
                ]),
            ) as EntryResource['meta'],
          })),
          meta,
        } as EntryCollectionDocument;
      },
    });
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(ctx.adapter);
  });
  return ctx;
}
