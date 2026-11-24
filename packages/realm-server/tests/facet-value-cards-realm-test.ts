import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import {
  captureStatements,
  isRead,
  tableScans,
} from './helpers/statement-plans.ts';

// A search's facets read the value store's card ids for its matches
// (`boxel_index_value_cards`, keyed by realm and URL). The statement read
// that table for every realm on the database: on a 12,000-product shop realm
// it scanned all 117k rows (2,855 pages) and hash-joined them to one realm's
// matches. It reads the search's own realms' rows now, through the table's
// (realm_url, url) key.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const mod = `${testRealm}product`;
const productRef = ref(mod, 'Product');
const brandRef = ref(mod, 'Brand');
const facet = { search: { facet: true } };

function field(
  fieldOrCard: ResolvedCodeRef,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...extra,
  } as FieldDefinition;
}
function def(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
): Definition {
  let names: Record<string, string> = {};
  let defs: Record<string, FieldDefinition> = {};
  Object.entries(fields).forEach(([name, f], i) => {
    names[name] = `f${i}`;
    defs[`f${i}`] = f;
  });
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: names,
    fieldDefs: defs,
  } as Definition;
}
const brandDef = def(brandRef, {
  cardTitle: field(stringRef),
  name: field(stringRef, facet),
});
const productDef = def(productRef, {
  cardTitle: field(stringRef),
  productType: field(stringRef, facet),
  material: field(stringRef, facet),
  color: field(stringRef, facet),
  brand: {
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: brandRef,
    ...facet,
  } as FieldDefinition,
});

function makeDefinitionLookup(): DefinitionLookup {
  let lookupDefinition = async (codeRef: CodeRef) => {
    if ('name' in codeRef && 'module' in codeRef && codeRef.module === mod) {
      if (codeRef.name === 'Product') return productDef;
      if (codeRef.name === 'Brand') return brandDef;
    }
    throw new Error(`unexpected definition lookup: ${JSON.stringify(codeRef)}`);
  };
  const lookup = {
    lookupDefinition,
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

const types = ['shirt', 'shoe', 'hat'];
const materials = ['cotton', 'wool'];
const colors = ['red', 'blue', 'green', 'black'];
const brands = ['acme', 'globex'];
// Enough matches that the planner would rather hash-join a scan of the
// whole table than probe its key once per match.
const PRODUCTS = 1_500;
// Cards of other realms on the same database.
const OTHER_CARDS = 20_000;
const brandOf = (i: number) => brands[i % 3 === 0 ? 1 : 0];

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let search: RealmIndexQueryEngine;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    let lookup = makeDefinitionLookup();
    search = new RealmIndexQueryEngine({
      realm: {
        url: testRealm,
        virtualNetwork,
        readLogFileForQuery: undefined,
      } as unknown as Realm,
      dbAdapter: adapter,
      fetch: globalThis.fetch,
      definitionLookup: lookup,
    });
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let write = async (
      url: string,
      codeRef: ResolvedCodeRef,
      searchData: Record<string, unknown>,
    ) =>
      await batch.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: { module: rri(codeRef.module), name: codeRef.name },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData,
        deps: new Set(),
        displayNames: [codeRef.name],
        types: [internalKeyFor(codeRef, undefined, virtualNetwork)],
        isolatedHtml: '<div></div>',
      });
    for (let b of brands) {
      await write(`${testRealm}Brand/${b}`, brandRef, {
        cardTitle: b,
        name: b,
      });
    }
    for (let i = 0; i < PRODUCTS; i++) {
      await write(`${testRealm}Product/p${i}`, productRef, {
        cardTitle: `Product ${i}`,
        productType: types[i % types.length],
        material: materials[i % materials.length],
        color: colors[i % colors.length],
        brand: { id: `${testRealm}Brand/${brandOf(i)}`, name: brandOf(i) },
      });
    }
    await batch.done();
    await adapter.execute(
      `INSERT INTO boxel_index_value_cards (realm_url, url) SELECT 'http://other-realm-' || (n % 4) || '/', 'http://other-realm-' || (n % 4) || '/Product/p' || n FROM generate_series(1, ${OTHER_CARDS}) AS n`,
    );
    await adapter.execute('ANALYZE');
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const productSearch = (page: { size: number }) =>
    parseSearchEntryQueryFromPayload({
      type: productRef,
      page,
      sort: [{ by: 'cardTitle' }],
      facets: [
        { by: 'productType', size: 1000 },
        { by: 'brand.name', size: 1000 },
        { by: 'material', size: 1000 },
        { by: 'color', size: 1000 },
      ],
    });

  // A paged html search lists the error cards its filter matches, so with
  // one in the realm it keeps the general read, whose facets join the
  // matches to the value-store cards. Its last good values still count.
  async function errorCard(i: number) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let url = new URL(`${testRealm}Product/p${i}.json`);
    await batch.invalidate([url]);
    await batch.updateEntry(url, {
      type: 'instance-error',
      error: {
        id: url.href,
        status: 500,
        title: 'broken',
        message: 'a render that failed',
        additionalErrors: null,
        deps: [],
      },
    });
    await batch.done();
    await adapter.execute('ANALYZE');
  }

  test("a search's facets read only its own realm's value-store cards", async function (assert) {
    await errorCard(0);
    let found: Awaited<ReturnType<RealmIndexQueryEngine['searchEntryRows']>>;
    let statements = await captureStatements(adapter, async () => {
      found = await search.searchEntryRows(productSearch({ size: 10 }));
    });
    assert.strictEqual(found!.results.length, 10, 'a page of rows');
    assert.deepEqual(found!.meta.facets?.['brand.name'], [
      { value: 'acme', count: (PRODUCTS * 2) / 3 },
      { value: 'globex', count: PRODUCTS / 3 },
    ]);
    assert.deepEqual(found!.meta.facets?.material, [
      { value: 'cotton', count: PRODUCTS / 2 },
      { value: 'wool', count: PRODUCTS / 2 },
    ]);
    let [own] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index_value_cards WHERE realm_url = '${testRealm}'`,
    )) as { n: number }[];
    let reading = statements.filter(
      (s) => isRead(s) && /boxel_index_value_cards/.test(s.sql),
    );
    assert.true(reading.length > 0, 'a statement reads the value-store cards');
    let scans: string[] = [];
    for (let statement of reading) {
      for (let scan of await tableScans(adapter, statement)) {
        if (
          scan.table === 'boxel_index_value_cards' &&
          (scan.node === 'Seq Scan' || scan.rowsExamined > own.n)
        ) {
          scans.push(
            `${scan.node}: ${scan.rowsExamined} rows, ${scan.blocks} blocks`,
          );
        }
      }
    }
    assert.deepEqual(
      scans,
      [],
      `no scan of the value-store cards reads past this realm's ${own.n} cards`,
    );
  });

  test('with no error card the filter matches, the search reads its facets from the value store, with the same rows and counts', async function (assert) {
    let general = await search.searchEntryRows(productSearch({ size: 10 }), {
      countsOnlySplit: true,
    } as any);
    let found: Awaited<ReturnType<RealmIndexQueryEngine['searchEntryRows']>>;
    let statements = await captureStatements(adapter, async () => {
      found = await search.searchEntryRows(productSearch({ size: 10 }));
    });
    assert.deepEqual(
      found!.results.map((row) => row.url),
      general.results.map((row) => row.url),
      'the same page of rows as the general read',
    );
    assert.strictEqual(found!.results.length, 10, 'a page of rows');
    assert.deepEqual(
      found!.meta.facets,
      general.meta.facets,
      'the same facets',
    );
    assert.deepEqual(found!.meta.facets?.['brand.name'], [
      { value: 'acme', count: (PRODUCTS * 2) / 3 },
      { value: 'globex', count: PRODUCTS / 3 },
    ]);
    assert.strictEqual(found!.meta.page?.total, general.meta.page?.total);
    assert.deepEqual(
      statements
        .filter((s) => isRead(s) && /boxel_index_value_cards/.test(s.sql))
        .map((s) => s.sql.replace(/\s+/g, ' ').slice(0, 80)),
      [],
      'no statement reads the value-store cards',
    );
    assert.true(
      statements.some(
        (s) =>
          isRead(s) &&
          /json_object_agg\(r\.id, r\.realm_url\) FROM boxel_index_value_realms/.test(
            s.sql,
          ),
      ),
      'the value store decides the match set',
    );
  });
});
