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
import { PRERENDERED_HTML_FORMATS } from '@cardstack/runtime-common/prerendered-html-format';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { captureStatements, isRead } from './helpers/statement-plans.ts';

// A paged html search lists error cards (their renderings flagged
// `isError`), which the value store does not hold. When the realm holds
// error rows but none of them matches the search's filter, the page is the
// one a search of live cards gives, so it is read the way a data search is,
// through the value store, as a counts-only html search already is
// (non-live-rows.ts). Where an error row matches, the search keeps the
// general read, and the error card comes back.
//
// "Without the rule" is the same search with the engine's internal
// `countsOnlySplit` mark, which keeps it on the general read; the answers
// must be byte-identical, in every format the html fieldset serves.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const mod = `${testRealm}product`;
const productRef = ref(mod, 'Product');
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
const productDef = {
  type: 'card-def',
  codeRef: productRef,
  displayName: 'Product',
  fields: { cardTitle: 'f0', productType: 'f1', color: 'f2', price: 'f3' },
  fieldDefs: {
    f0: field(stringRef),
    f1: field(stringRef, facet),
    f2: field(stringRef, facet),
    f3: field(numberRef, { ...facet, serializerName: 'number' }),
  },
} as unknown as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === mod) {
        return productDef;
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

const types = ['shirt', 'shoe', 'hat'];
const colors = ['red', 'blue', 'green', 'black'];
const PRODUCTS = 60;
const priceOf = (i: number) => 10 + (i % 7) * 15;

const realm = 'http://paged-html-errors/';
// Error rows: an index error (the latest index failed) on each of these,
// and a standing render error on RENDER_ERRORED. Their prices are 10, 25,
// 40 and 70 (index) and 55 (render), so `price >= 85` matches none of them
// and `price >= 55` matches p3 and p4.
const ERRORED = [0, 1, 2, 4];
const RENDER_ERRORED = [3];
const noErrorMatches = { range: { price: { gte: 85 } } };
const someErrorMatch = { range: { price: { gte: 55 } } };

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let productKey: string;

  function search() {
    return new RealmIndexQueryEngine({
      realm: {
        url: realm,
        virtualNetwork,
        readLogFileForQuery: undefined,
        getRealmInfo: async () => ({ name: 'shop' }),
      } as unknown as Realm,
      dbAdapter: adapter,
      fetch: globalThis.fetch,
      definitionLookup: makeDefinitionLookup(),
    });
  }

  async function batchOf(work: (batch: any) => Promise<void>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await work(batch);
    await batch.done();
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    productKey = internalKeyFor(productRef, undefined, virtualNetwork);
    await batchOf(async (batch) => {
      for (let i = 0; i < PRODUCTS; i++) {
        let url = `${realm}Product/p${i}`;
        await batch.updateEntry(new URL(`${url}.json`), {
          type: 'instance',
          resource: {
            id: rri(url),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(mod), name: 'Product' } },
          },
          lastModified: 1000 + i,
          resourceCreatedAt: 1000 + i,
          searchData: {
            cardTitle: `Product ${i}`,
            productType: types[i % types.length],
            color: colors[i % colors.length],
            price: priceOf(i),
          },
          deps: new Set(),
          displayNames: ['Product'],
          types: [productKey],
          isolatedHtml: `<div class="isolated">p${i}</div>`,
          headHtml: `<title>p${i}</title>`,
          atomHtml: `<span class="atom">p${i}</span>`,
          embeddedHtml: { [productKey]: `<div class="embedded">p${i}</div>` },
          fittedHtml: { [productKey]: `<div class="fitted">p${i}</div>` },
        });
      }
    });
    await batchOf(async (batch) => {
      let urls = ERRORED.map((i) => new URL(`${realm}Product/p${i}.json`));
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
    // A standing render error: the card's index row is good, its latest
    // render failed.
    for (let i of RENDER_ERRORED) {
      await adapter.execute(
        `UPDATE prerendered_html SET error_doc = '{"message":"render failed","status":500}'::jsonb, generation = (SELECT generation FROM boxel_index WHERE url = $1 AND type = 'instance') WHERE url = $1 AND type = 'instance'`,
        { bind: [`${realm}Product/p${i}.json`] },
      );
      // The store holds live cards only, as the index writer keeps it.
      await adapter.execute(
        `DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
        { bind: [`${realm}Product/p${i}.json`] },
      );
    }
    await adapter.execute('ANALYZE');
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  function pagedHtml(filter: Record<string, unknown>, format: string) {
    let parsed = parseSearchEntryQueryFromPayload({
      type: productRef,
      filter,
      sort: [{ by: 'price', direction: 'desc' }, { by: 'cardTitle' }],
      facets: [
        { by: 'productType', size: 10 },
        { by: 'color', own: 'ignore', size: 10 },
      ],
      page: { size: PRODUCTS },
      fields: { entry: ['html'] },
    });
    return { ...parsed, htmlQuery: { eq: { format } } } as typeof parsed;
  }

  async function both(filter: Record<string, unknown>, format: string) {
    let query = pagedHtml(filter, format);
    let general = await search().searchEntries(query, {
      countsOnlySplit: true,
    } as any);
    let ruled: Awaited<ReturnType<RealmIndexQueryEngine['searchEntries']>>;
    let statements = await captureStatements(adapter, async () => {
      ruled = await search().searchEntries(query);
    });
    return { general, ruled: ruled!, statements: statements.filter(isRead) };
  }

  // The value store decides the match set: its prep read of the realm's
  // dictionaries (store-blend.ts, `storeFacetSet`) runs. (The facet
  // statement reads the store's values on the general read too.)
  const readsTheStore = (statements: { sql: string }[]) =>
    statements.some((s) =>
      /json_object_agg\(r\.id, r\.realm_url\) FROM boxel_index_value_realms/.test(
        s.sql,
      ),
    );

  for (let format of PRERENDERED_HTML_FORMATS) {
    test(`${format}: error rows the filter does not match leave the page byte-identical, and it reads the value store`, async function (assert) {
      let { general, ruled, statements } = await both(noErrorMatches, format);
      assert.true(
        (general.data?.length ?? 0) > 0,
        'the filter matches live cards',
      );
      assert.strictEqual(
        JSON.stringify(ruled),
        JSON.stringify(general),
        'the same document, byte for byte',
      );
      assert.false(
        JSON.stringify(ruled).includes('"isError":true'),
        'no error card',
      );
      assert.true(
        readsTheStore(statements),
        'the search reads the value store',
      );
    });

    test(`${format}: an error row the filter matches still comes back as an error card`, async function (assert) {
      let { general, ruled, statements } = await both(someErrorMatch, format);
      assert.strictEqual(
        JSON.stringify(ruled),
        JSON.stringify(general),
        'the same document, byte for byte',
      );
      let ids = (ruled.data ?? []).map((entry) => entry.id);
      for (let i of [3, 4]) {
        assert.true(
          ids.includes(`${realm}Product/p${i}`),
          `p${i}, an error card, is listed`,
        );
      }
      let errorHtml = (ruled.included ?? []).filter(
        (resource: any) =>
          resource.type === 'html' && resource.attributes?.isError,
      );
      assert.true(errorHtml.length > 0, 'its rendering is flagged isError');
      assert.false(readsTheStore(statements), 'kept on the general read');
    });
  }

  test('a realm with no error row reads the value store', async function (assert) {
    // The error cards deleted outright.
    for (let table of ['boxel_index', 'prerendered_html']) {
      await adapter.execute(
        `DELETE FROM ${table} WHERE realm_url = $1 AND url = ANY ($2::text[])`,
        {
          bind: [
            realm,
            [...ERRORED, ...RENDER_ERRORED].map(
              (i) => `${realm}Product/p${i}.json`,
            ),
          ],
        },
      );
    }
    let { general, ruled, statements } = await both(noErrorMatches, 'fitted');
    assert.strictEqual(JSON.stringify(ruled), JSON.stringify(general));
    assert.true(readsTheStore(statements));
  });
});
