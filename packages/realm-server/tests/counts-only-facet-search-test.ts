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
import { applyServerSearchPageBound } from '@cardstack/runtime-common/search-bounds';
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

// A counts-only search (`page.size: 0`, as facet chips send) asks for its
// total and its facets and no rows. Through a realm's `_search` it is an html
// search (the default fieldset), which reads error rows too, so it never
// reached the value store: it ran the page's statement, which read every
// match's index row (12,060 heap pages of boxel_index for 12,084 products on
// a 12,000-product shop realm) to return none. It now runs no page
// statement and reads no index row: the store counts the type's cards and
// the facets, once two index-only reads tell the realm holds no error row
// (counts-only-error-cards-test covers a realm that does).

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
const PRODUCTS = 60;
const brandOf = (i: number) => brands[i % 3 === 0 ? 1 : 0];

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let search: RealmIndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    let virtualNetwork = new VirtualNetwork();
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
    await seedOtherRealmRows(adapter, 5_000);
    await adapter.execute('ANALYZE');
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // The facet chips' request, as `_search` parses it.
  const chips = (page: { size: number | string }) =>
    parseSearchEntryQueryFromPayload({
      type: productRef,
      page,
      facets: [
        { by: 'productType', size: 1000 },
        { by: 'brand.name', size: 1000 },
        { by: 'material', size: 1000 },
        { by: 'color', size: 1000 },
      ],
    });

  test('a counts-only html search runs no page statement and reads no index row', async function (assert) {
    let query = chips({ size: 0 });
    assert.true(query.fieldset.html, 'the default fieldset is html');
    let found: Awaited<ReturnType<RealmIndexQueryEngine['searchEntryRows']>>;
    let statements = await captureStatements(adapter, async () => {
      found = await search.searchEntryRows(query);
    });
    assert.deepEqual(found!.results, [], 'no rows');
    assert.strictEqual(found!.meta.page.total, PRODUCTS, 'the total');
    assert.deepEqual(found!.meta.facets, {
      productType: [
        { value: 'hat', count: 20 },
        { value: 'shirt', count: 20 },
        { value: 'shoe', count: 20 },
      ],
      'brand.name': [
        { value: 'acme', count: 40 },
        { value: 'globex', count: 20 },
      ],
      material: [
        { value: 'cotton', count: 30 },
        { value: 'wool', count: 30 },
      ],
      color: [
        { value: 'black', count: 15 },
        { value: 'blue', count: 15 },
        { value: 'green', count: 15 },
        { value: 'red', count: 15 },
      ],
    });
    assert.deepEqual(
      statements
        .filter((s) => /\bLIMIT 0\b/.test(s.sql))
        .map((s) => s.sql.slice(0, 120)),
      [],
      'no page statement',
    );
    // The realm's time zone is read off its realm card, one row by its URL
    // (realm-time-zone.ts), on every search; it reads no match.
    let reads = statements.filter(
      (s) => isRead(s) && !/current_generation AS generation/.test(s.sql),
    );
    let indexReads: string[] = [];
    for (let statement of reads) {
      for (let scan of await tableScans(adapter, statement)) {
        // An index-only existence check that finds no error row reads none.
        if (
          (scan.table === 'boxel_index' || scan.table === 'prerendered_html') &&
          scan.rowsExamined > 0
        ) {
          indexReads.push(
            `${scan.node} on ${scan.table}: ${scan.rowsExamined} rows, ${scan.blocks} blocks: ${statement.sql.slice(0, 200)}`,
          );
        }
      }
    }
    assert.deepEqual(indexReads, [], 'no index row is read');
  });

  test('a counts-only page counts what a paged search of the same matches counts', async function (assert) {
    let counted = await search.searchEntryRows(chips({ size: 0 }));
    let paged = await search.searchEntryRows(chips({ size: 5 }));
    assert.strictEqual(paged.results.length, 5, 'a page of rows');
    assert.strictEqual(counted.meta.page.total, paged.meta.page.total);
    assert.deepEqual(counted.meta.facets, paged.meta.facets);
  });

  test('a counts-only page keeps its size through the server page bound', function (assert) {
    for (let size of [0, '0']) {
      let bounded = applyServerSearchPageBound(chips({ size }).itemQuery);
      assert.strictEqual(
        Number((bounded.page as { size: unknown }).size),
        0,
        `size ${JSON.stringify(size)} stays a counts-only page`,
      );
    }
  });
});
