import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  RealmUnion,
  VirtualNetwork,
  internalKeyFor,
  query as runQuery,
  rri,
  syncValueStoreLiveness,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Expression,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
  type SerializedError,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// A counts-only search (`page.size: 0`) over a union of realms on one
// database counts from the value store, as one realm's does: its total, its
// per-realm totals and its facets come from the store's rows for every realm
// of the union, and an html search adds each realm's error cards, counted by
// their last good values. No statement pages the match set (`LIMIT 0`) and
// none reads the realms' index rows but the error rows'. The answer is a
// paged union search's, at any page size, and the general read's: the same
// search under a grant that admits every card, which the store's set does
// not answer.

const A = 'http://union-counts.test/a/';
const B = 'http://union-counts.test/b/';

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const mod = `${A}item`;
const itemRef = ref(mod, 'Item');

function field(fieldOrCard: ResolvedCodeRef): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(fieldOrCard === numberRef ? { serializerName: 'number' } : {}),
    search: { facet: true },
  } as FieldDefinition;
}
const itemFields = {
  cardTitle: field(stringRef),
  kind: field(stringRef),
  status: field(stringRef),
  size: field(numberRef),
};
const itemDef = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: Object.fromEntries(
    Object.keys(itemFields).map((name, i) => [name, `f${i}`]),
  ),
  fieldDefs: Object.fromEntries(
    Object.values(itemFields).map((f, i) => [`f${i}`, f]),
  ),
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === mod) {
        return itemDef;
      }
      throw new Error(
        `unexpected definition lookup: ${JSON.stringify(codeRef)}`,
      );
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

const items = (realm: string, n: number, offset: number) =>
  Array.from({ length: n }, (_, j) => {
    let i = j + offset;
    return {
      realm,
      name: `i${String(i).padStart(2, '0')}`,
      kind: ['chair', 'table', 'lamp'][i % 3],
      status: i % 2 ? 'open' : 'closed',
      size: i % 4,
    };
  });
// B holds a kind A does not.
const cards = [
  ...items(A, 14, 0),
  ...items(B, 9, 20).map((c, j) => (j === 0 ? { ...c, kind: 'rug' } : c)),
];

const genuineError: SerializedError = {
  status: 500,
  title: 'Error',
  message: 'Cannot read properties of undefined',
  additionalErrors: null,
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let network: VirtualNetwork;
  let statements: string[];

  const url = (c: { realm: string; name: string }) =>
    `${c.realm}Item/${c.name}.json`;

  async function pass(realm: string, write: (batch: any) => Promise<void>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    await write(batch);
    await batch.done();
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    network = new VirtualNetwork();
    engine = new IndexQueryEngine(adapter, makeDefinitionLookup(), network);
    let key = internalKeyFor(itemRef, undefined, network);
    for (let realm of [A, B]) {
      await pass(realm, async (batch) => {
        for (let c of cards.filter((c) => c.realm === realm)) {
          await batch.updateEntry(new URL(url(c)), {
            type: 'instance',
            resource: {
              id: rri(url(c).replace(/\.json$/, '')),
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: { module: rri(mod), name: 'Item' } },
            },
            lastModified: Date.now(),
            resourceCreatedAt: Date.now(),
            searchData: {
              cardTitle: c.name,
              kind: c.kind,
              status: c.status,
              size: c.size,
            },
            deps: new Set(),
            displayNames: ['Item'],
            types: [key],
            isolatedHtml: `<div>${c.name}</div>`,
          });
        }
      });
    }
    statements = [];
    let execute = adapter.execute.bind(adapter);
    adapter.execute = ((sql: string, opts?: unknown) => {
      statements.push(sql);
      return execute(sql, opts as never);
    }) as typeof adapter.execute;
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // Error cards in both realms: an index error in A, a render error in B.
  async function breakCards() {
    let key = internalKeyFor(itemRef, undefined, network);
    let a = cards.find((c) => c.realm === A && c.name === 'i03')!;
    await pass(A, async (batch) => {
      await batch.updateEntry(new URL(url(a)), {
        type: 'instance-error',
        error: { ...genuineError, id: url(a), deps: [] },
        types: [key],
      });
    });
    let b = cards.find((c) => c.realm === B && c.name === 'i21')!;
    await adapter.execute(
      `UPDATE prerendered_html SET error_doc = $1::jsonb WHERE url = $2 AND type = 'instance'`,
      { bind: [JSON.stringify(genuineError), url(b)] },
    );
    await syncValueStoreLiveness(
      {
        dbAdapter: adapter,
        query: (e: Expression) => runQuery(adapter, e),
      },
      B,
      [url(b)],
    );
  }

  const facets = [
    { by: 'kind', size: 100 },
    { by: 'status', size: 100 },
    { by: 'size', size: 100, stats: true },
  ];

  const filters: Record<string, unknown> = {
    'a whole type': { type: itemRef },
    'a type and a field test': {
      every: [{ type: itemRef }, { on: itemRef, eq: { status: 'open' } }],
    },
  };

  async function counted(
    q: Record<string, unknown>,
    size: number,
    { html = false, general = false } = {},
  ) {
    statements = [];
    let { meta } = await engine.search(
      new RealmUnion([A, B]),
      { ...q, facets, page: { size } } as unknown as Query,
      {
        ...(html ? { includeErrors: true as const } : {}),
        ...(general ? { grantFilter: { type: itemRef } } : {}),
      },
      html ? { kind: 'renderSet' } : { kind: 'dataOnly' },
      'all',
    );
    return {
      total: meta.page?.total,
      realmTotals: meta.realmTotals,
      facets: meta.facets,
      facetStats: meta.facetStats,
    };
  }

  const pagesMatches = () =>
    statements.some(
      (sql) => /LIMIT 0\b/.test(sql) && sql.includes('boxel_index'),
    );
  // A statement over the realms' index rows, other than the generation
  // probe and the error rows' own read (keyed off their partial indexes).
  const readsIndexRows = () =>
    statements.some(
      (sql) =>
        /FROM boxel_index AS i\b/.test(sql) &&
        !sql.includes('current_generation') &&
        !sql.includes('FROM boxel_index AS e WHERE'),
    );

  for (let html of [false, true]) {
    for (let [name, filter] of Object.entries(filters)) {
      for (let broken of [false, true]) {
        test(`${html ? 'an html' : 'a data'} search of ${name}${broken ? ', with error cards' : ''}: counts-only is the paged union search`, async function (assert) {
          if (broken) {
            await breakCards();
          }
          let q = { filter };
          let reference = await counted(q, 50, { html, general: true });
          assert.ok(Number(reference.total) > 0, 'the search matches cards');
          for (let size of [50, 3]) {
            assert.deepEqual(
              await counted(q, size, { html }),
              reference,
              `page size ${size}`,
            );
          }
          let countsOnly = await counted(q, 0, { html });
          assert.false(pagesMatches(), 'no statement pages the match set');
          assert.false(
            readsIndexRows(),
            'no statement reads the realms’ live index rows',
          );
          assert.deepEqual(countsOnly, reference, 'page size 0');
          assert.deepEqual(
            Object.keys(countsOnly.realmTotals ?? {}).sort(),
            [A, B],
            'a total for each realm',
          );
        });
      }
    }
  }
});
