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
  seedOtherRealmRows,
  tableScans,
} from './helpers/statement-plans.ts';

// A counts-only html search (`page.size: 0`) reports the total a paged
// html search of the same filter reports, error cards included: the store
// counts the live cards and the realm's error rows the filter matches are
// added (non-live-rows.ts). A realm with no error row is counted from the
// store alone; one with a few counts just those rows, read off their own
// partial indexes. The facets of a counts-only search count live cards.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
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
  price: field(numberRef, { ...facet, serializerName: 'number' }),
  tags: field(stringRef, { type: 'containsMany', ...facet }),
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
const PRODUCTS = 60;
const brandOf = (i: number) => brands[i % 3 === 0 ? 1 : 0];

const cleanRealm = testRealm;
const brokenRealm = 'http://broken-realm/';
// The products of the broken realm whose latest render failed: each keeps
// its last good types and search doc.
const ERRORED = [0, 1, 2, 4];

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let lookup: DefinitionLookup;

  function searchOf(realm: string) {
    return new RealmIndexQueryEngine({
      realm: {
        url: realm,
        virtualNetwork,
        readLogFileForQuery: undefined,
      } as unknown as Realm,
      dbAdapter: adapter,
      fetch: globalThis.fetch,
      definitionLookup: lookup,
    });
  }

  async function batchOf(realm: string, work: (batch: any) => Promise<void>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await work(batch);
    await batch.done();
  }

  async function seed(realm: string) {
    await batchOf(realm, async (batch) => {
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
        await write(`${realm}Brand/${b}`, brandRef, { cardTitle: b, name: b });
      }
      for (let i = 0; i < PRODUCTS; i++) {
        await write(`${realm}Product/p${i}`, productRef, {
          cardTitle: `Product ${i}`,
          productType: types[i % types.length],
          material: materials[i % materials.length],
          color: colors[i % colors.length],
          price: 10 + (i % 7) * 15,
          // An error card's own tag is a value only an error card holds.
          tags: [`t${i % 5}`, ...(ERRORED.includes(i) ? [`only-p${i}`] : [])],
          brand: { id: `${realm}Brand/${brandOf(i)}`, name: brandOf(i) },
        });
      }
    });
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    lookup = makeDefinitionLookup();
    await seed(cleanRealm);
    await seed(brokenRealm);
    await batchOf(brokenRealm, async (batch) => {
      let urls = ERRORED.map(
        (i) => new URL(`${brokenRealm}Product/p${i}.json`),
      );
      await batch.invalidate(urls);
      for (let url of urls) {
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
      }
    });
    await seedOtherRealmRows(adapter, 5_000);
    await adapter.execute('ANALYZE');
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const typeOnly = () => ({ type: productRef });
  const byField = () => ({
    type: productRef,
    filter: { eq: { productType: 'shirt' } },
  });
  const chips = () => ({
    type: productRef,
    facets: [
      { by: 'productType', size: 1000 },
      { by: 'brand.name', size: 1000 },
      { by: 'material', size: 1000 },
      { by: 'color', size: 1000 },
    ],
  });

  async function totals(realm: string, request: Record<string, unknown>) {
    let search = searchOf(realm);
    let counted = await search.searchEntryRows(
      parseSearchEntryQueryFromPayload({ ...request, page: { size: 0 } }),
    );
    let paged = await search.searchEntryRows(
      parseSearchEntryQueryFromPayload({
        ...request,
        page: { size: 20, total: 'exact' },
      }),
    );
    return { counted, paged };
  }

  for (let [name, request, expected, expectedErrored] of [
    ['a type filter', typeOnly, PRODUCTS, ERRORED.length],
    [
      'a field filter',
      byField,
      PRODUCTS / 3,
      ERRORED.filter((i) => types[i % types.length] === 'shirt').length,
    ],
    ['a facet request', chips, PRODUCTS, ERRORED.length],
  ] as const) {
    test(`${name}: size 0 and size 20 report one total, with and without error cards`, async function (assert) {
      let clean = await totals(cleanRealm, request());
      assert.strictEqual(
        clean.counted.meta.page.total,
        expected,
        'clean, size 0',
      );
      assert.strictEqual(
        clean.paged.meta.page.total,
        expected,
        'clean, size 20',
      );
      let broken = await totals(brokenRealm, request());
      assert.true(expectedErrored > 0, 'the filter matches an error card');
      assert.strictEqual(
        broken.paged.meta.page.total,
        expected,
        'a paged html search lists the error cards',
      );
      assert.strictEqual(
        broken.counted.meta.page.total,
        expected,
        'the counts-only total counts them too',
      );
      assert.deepEqual(broken.counted.results, [], 'no rows');
    });
  }

  for (let realm of [cleanRealm, brokenRealm]) {
    test(`size 0 and size 20 give the same facets (${realm})`, async function (assert) {
      let request = {
        type: productRef,
        facets: [
          { by: 'productType' },
          {
            by: 'price',
            ranges: [{ to: 40 }, { from: 40, to: 70 }, { from: 70 }],
          },
          { by: 'tags', size: 1000, stats: true, missing: true },
          { by: 'brand.name' },
        ],
      };
      let { counted, paged } = await totals(realm, request);
      assert.deepEqual(counted.meta.facets, paged.meta.facets, 'meta.facets');
      assert.deepEqual(
        counted.meta.facetStats,
        paged.meta.facetStats,
        'meta.facetStats',
      );
      assert.strictEqual(counted.meta.page.total, paged.meta.page.total);
      if (realm === brokenRealm) {
        assert.deepEqual(
          counted.meta.facets?.tags
            ?.filter((c) => c.value.startsWith('only-'))
            .map((c) => c.value),
          ERRORED.map((i) => `only-p${i}`),
          'a value only an error card holds is counted',
        );
      }
    });
  }

  test('a facet size cut applies after the error cards are counted', async function (assert) {
    // Counting live cards alone, "shoe" (two error cards) would trail and
    // the one value kept would carry a count one short; the cut is taken
    // over the counts the paged search takes it over.
    let request = {
      type: productRef,
      facets: [{ by: 'productType', size: 2 }],
    };
    let { counted, paged } = await totals(brokenRealm, request);
    assert.deepEqual(counted.meta.facets, paged.meta.facets);
  });

  test('a realm with error rows reads only those rows for the count', async function (assert) {
    let search = searchOf(brokenRealm);
    let statements = await captureStatements(adapter, async () => {
      await search.searchEntryRows(
        parseSearchEntryQueryFromPayload({ ...typeOnly(), page: { size: 0 } }),
      );
    });
    // The index rows read off the heap: the error rows, each once. (The
    // existence check and the candidates are index-only reads.)
    let fromHeap = 0;
    let scanned: string[] = [];
    for (let statement of statements.filter(
      (s) => isRead(s) && !/current_generation AS generation/.test(s.sql),
    )) {
      for (let scan of await tableScans(adapter, statement)) {
        if (scan.table !== 'boxel_index' || scan.rowsExamined === 0) {
          continue;
        }
        if (scan.node === 'Seq Scan') {
          scanned.push(`${scan.rowsExamined} rows`);
        }
        if (scan.node !== 'Index Only Scan') {
          fromHeap += scan.rowsExamined;
        }
      }
    }
    assert.deepEqual(scanned, [], 'no scan of the index');
    assert.strictEqual(fromHeap, ERRORED.length, 'only the error rows');
  });
});
