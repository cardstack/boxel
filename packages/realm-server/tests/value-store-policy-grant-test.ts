import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import stringify from 'safe-stable-stringify';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  RealmUnion,
  type VirtualNetwork,
  baseCardRef,
  internalKeyFor,
  policyFilterFromWire,
  policyScopedQuery,
  realmAdmissionFilter,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Filter,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { realmPolicyRef } from '@cardstack/runtime-common/card-operations';
import { cardIdentityFilter } from '@cardstack/runtime-common/card-identity-filter';
import { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';
import { filterWithout } from '@cardstack/runtime-common/query-engine/facet-sql';
import {
  STORE_GRANT_EXCLUDED_TYPE,
  callerFilterUnder,
  storeGrantOf,
} from '@cardstack/runtime-common/query-engine/store-grant';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  createVirtualNetwork,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { comparePolicyStorePaths } from './helpers/policy-store-differential.ts';

// A caller a realm policy scopes by grants that each admit every card of a
// type reads through the value store, as a caller who reads the realm
// outright does (store-grant.ts). Each search here runs twice: told to read
// its grants the general way (`grantsOnGeneralPath`), and as it would. The
// two documents must be byte-identical, and the test says whether a store
// path carried the grant. The grant filters are composed exactly as a realm
// composes the ones its policy compiled (`policyScopedQuery` over the
// filters `withoutAuthorization` makes), so what is recognized is the
// compiled form; realm-policy-store-grant-test.ts compiles real policies.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const mod = `${testRealm}shop`;
const productRef = ref(mod, 'Product');
const gadgetRef = ref(mod, 'Gadget');
const variantRef = ref(mod, 'Variant');
const realmConfigRef = ref('@cardstack/base/realm-config', 'RealmConfig');
const policyRef = realmPolicyRef as ResolvedCodeRef;
const OTHER = 'http://other-realm/';

function field(
  fieldOrCard: ResolvedCodeRef,
  serializerName?: string,
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(serializerName ? { serializerName } : {}),
    search: { facet: true },
  } as FieldDefinition;
}
const shopFields = {
  cardTitle: field(stringRef),
  productType: field(stringRef),
  color: field(stringRef),
  status: field(stringRef),
  rating: field(numberRef, 'number'),
  reviewCount: field(numberRef, 'number'),
  priceMin: field(numberRef, 'number'),
  inStock: field(booleanRef, 'boolean'),
};
function definitionOf(codeRef: ResolvedCodeRef): Definition {
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(
      Object.keys(shopFields).map((name, i) => [name, `f${i}`]),
    ),
    fieldDefs: Object.fromEntries(
      Object.values(shopFields).map((f, i) => [`f${i}`, f]),
    ),
  } as Definition;
}
const definitions = [
  productRef,
  gadgetRef,
  variantRef,
  realmConfigRef,
  policyRef,
  baseCardRef,
];

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      let found = definitions.find((d) => stringify(d) === stringify(codeRef));
      if (found) {
        return definitionOf(found);
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

const productTypes = ['SHOES', 'LAMP', 'HOME', 'GROCERY'];
const colors = ['red', 'blue', 'black'];
// A card's values; a Variant's are its own, so a Variant counted anywhere
// shows as a value no Product holds.
function valuesOf(kind: string, i: number) {
  let secret = kind === 'variant';
  return {
    productType: secret ? 'VARIANT-ONLY' : productTypes[i % 4],
    color: secret ? 'variant-color' : i % 7 === 0 ? undefined : colors[i % 3],
    status: i % 3 === 0 ? 'draft' : 'published',
    rating: [3.5, 4, 4.5, 4.8, 5][i % 5],
    reviewCount: (i * 13) % 140,
    priceMin: secret ? 9999 : (i * 37) % 600,
    inStock: i % 3 === 0,
  };
}

// The realm's cards: products, gadgets (a Product subclass), variants (a
// type no grant here admits, with the same paths), the realm's config card,
// its policy card and a draft policy card.
interface Seeded {
  url: string;
  types: ResolvedCodeRef[];
  title: string;
  values: Record<string, unknown>;
}
function seededCards(realm: string): Seeded[] {
  let cards: Seeded[] = [];
  for (let i = 0; i < 30; i++) {
    cards.push({
      url: `${realm}Product/p${String(i).padStart(2, '0')}`,
      types: [productRef, baseCardRef],
      title: `p${i}`,
      values: valuesOf('product', i),
    });
  }
  for (let i = 0; i < 6; i++) {
    cards.push({
      url: `${realm}Gadget/g${i}`,
      types: [gadgetRef, productRef, baseCardRef],
      title: `g${i}`,
      values: valuesOf('product', i + 100),
    });
  }
  for (let i = 0; i < 20; i++) {
    cards.push({
      url: `${realm}Variant/v${String(i).padStart(2, '0')}`,
      types: [variantRef, baseCardRef],
      title: `v${i}`,
      values: valuesOf('variant', i),
    });
  }
  cards.push(
    {
      url: `${realm}realm`,
      types: [realmConfigRef, baseCardRef],
      title: 'Shop',
      values: { productType: 'CONFIG' },
    },
    {
      url: `${realm}policies/public`,
      types: [policyRef, baseCardRef],
      title: 'Public',
      values: { productType: 'POLICY' },
    },
    {
      url: `${realm}policies/draft`,
      types: [policyRef, baseCardRef],
      title: 'Draft',
      // A rating far from every product's, so a comparison set that took
      // this policy card in would move its statistics.
      values: { productType: 'POLICY', rating: 1000 },
    },
  );
  return cards;
}

// The ids every scope here leaves out: the realm's config card and the card
// its policy key names.
const AUTH_IDS = [`${testRealm}realm`, `${testRealm}policies/public`];

// A scope as `withoutAuthorization` makes it of the grants' filters.
function scope(granted: Filter, ids: string[] = AUTH_IDS): Filter {
  return {
    every: [
      granted,
      {
        not: { any: [cardIdentityFilter(ids), { type: realmPolicyRef }] },
      },
    ],
  };
}
// A grant's filter as the policy compiler and `grantFilters` produce it.
const unconditional = (type: ResolvedCodeRef) =>
  policyFilterFromWire({ 'item.on': type } as never);
const predicated = (type: ResolvedCodeRef, eq: Record<string, unknown>) =>
  policyFilterFromWire({
    'item.on': type,
    eq: Object.fromEntries(
      Object.entries(eq).map(([k, v]) => [`item.${k}`, v]),
    ),
  } as never);

const product = { module: productRef.module, name: productRef.name };

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  function realmEngine(realm = testRealm) {
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

  async function seed(realm: string) {
    let key = (r: ResolvedCodeRef) =>
      internalKeyFor(r, undefined, virtualNetwork);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let card of seededCards(realm)) {
      let [own] = card.types;
      await batch.updateEntry(new URL(`${card.url}.json`), {
        type: 'instance',
        resource: {
          id: rri(card.url),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(own.module), name: own.name } },
        },
        lastModified: 1000,
        resourceCreatedAt: 1000,
        searchData: {
          cardTitle: card.title,
          ...Object.fromEntries(
            Object.entries(card.values).filter(([, v]) => v !== undefined),
          ),
        },
        deps: new Set(),
        displayNames: card.types.map((t) => t.name),
        types: card.types.map(key),
        isolatedHtml: `<div>${card.title}</div>`,
        embeddedHtml: { [key(own)]: `<div class="e">${card.title}</div>` },
        fittedHtml: { [key(own)]: `<div class="f">${card.title}</div>` },
      });
    }
    await batch.done();
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = createVirtualNetwork();
    await seed(testRealm);
    await seed(OTHER);
    await adapter.execute('ANALYZE');
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // The query a realm runs for a caller its policy scopes by `scopes`.
  function scoped(payload: Record<string, unknown>, scopes: Filter[]) {
    let { htmlFormat: html, ...wire } = payload as {
      htmlFormat?: string;
    } & Record<string, unknown>;
    let parsed = parseSearchEntryQueryFromPayload(wire);
    let query = policyScopedQuery(
      html
        ? ({ ...parsed, htmlQuery: { eq: { format: html } } } as typeof parsed)
        : parsed,
      scopes,
    );
    return query;
  }

  // The search on both reads: the two documents (which must be identical)
  // and whether a store path carried the grant.
  async function both(
    payload: Record<string, unknown>,
    scopes: Filter[],
    opts: Record<string, unknown> = {},
  ) {
    let query = scoped(payload, scopes);
    let compared = comparePolicyStorePaths();
    let doc;
    try {
      doc = await realmEngine().searchEntries(query, opts as never);
    } finally {
      compared.restore();
    }
    let { observation } = compared;
    return {
      doc,
      compared: observation.compared,
      carried: observation.carried > 0,
      mismatches: observation.mismatches,
      ids: (doc.data ?? []).map((e: { id: string }) => e.id),
      total: doc.meta?.page?.total,
      facets: doc.meta?.facets,
    };
  }

  const productIds = seededCards(testRealm)
    .filter((c) => c.types.some((t) => t.name === 'Product'))
    .map((c) => c.url)
    .sort();
  const variantIds = seededCards(testRealm)
    .filter((c) => c.types[0].name === 'Variant')
    .map((c) => c.url);
  const excludedIds = [
    `${testRealm}realm`,
    `${testRealm}policies/public`,
    `${testRealm}policies/draft`,
  ];

  // ---- What is recognized --------------------------------------------------

  test('the excluded type is the policy card type the policy compiler excludes', function (assert) {
    assert.deepEqual(STORE_GRANT_EXCLUDED_TYPE, realmPolicyRef);
  });

  test('recognized: the compiled forms of grants that each admit every card of a type', function (assert) {
    let grantFilterOf = (granted: Filter) =>
      scoped({ type: product, page: { size: 0 } }, [scope(granted)])
        .grantFilter;
    assert.deepEqual(storeGrantOf(grantFilterOf(unconditional(productRef))), {
      types: [productRef],
      excludedType: realmPolicyRef,
      excludedIds: AUTH_IDS,
    });
    assert.deepEqual(
      storeGrantOf(
        grantFilterOf({
          any: [unconditional(productRef), unconditional(baseCardRef)],
        }),
      )?.types,
      [productRef, baseCardRef],
      'several grants on the searched type',
    );
    assert.deepEqual(
      storeGrantOf(
        grantFilterOf({
          any: [
            { on: productRef, any: [unconditional(productRef)] },
            { on: variantRef, any: [unconditional(variantRef)] },
          ],
        }),
      )?.types,
      [productRef, variantRef],
      'a search of several types, each branch confined to its type',
    );
    assert.deepEqual(
      storeGrantOf(
        grantFilterOf({ on: productRef, any: [unconditional(productRef)] }),
      )?.types,
      [productRef],
      'a search of several types of which one is granted',
    );
  });

  test('not recognized: a grant narrowed by realm path, in any position', function (assert) {
    let grantFilterOf = (granted: Filter) =>
      scoped({ type: product, page: { size: 0 } }, [scope(granted)])
        .grantFilter;
    assert.ok(
      storeGrantOf(grantFilterOf(unconditional(productRef))),
      'the same grant without paths is carried',
    );
    assert.strictEqual(
      storeGrantOf(
        grantFilterOf({
          every: [unconditional(productRef), { paths: ['blog/'] }],
        } as Filter),
      ),
      undefined,
      'a path-narrowed grant keeps the general read',
    );
    assert.strictEqual(
      storeGrantOf(
        grantFilterOf({
          any: [
            unconditional(productRef),
            { every: [unconditional(baseCardRef), { paths: ['a.json'] }] },
          ],
        } as Filter),
      ),
      undefined,
      'one path-narrowed grant among several keeps the general read',
    );
  });

  test('not recognized: a grant that reads a card field, and every other shape', function (assert) {
    let base = scoped({ type: product, page: { size: 0 } }, [
      scope(unconditional(productRef)),
    ]).grantFilter!;
    let rejected: Record<string, unknown> = {
      'a card predicate': scope(
        predicated(productRef, { status: 'published' }),
      ),
      'a card predicate beside a type test': scope({
        any: [
          unconditional(productRef),
          predicated(productRef, { status: 'published' }),
        ],
      }),
      'a misreading guard': scope({
        every: [
          predicated(productRef, { status: 'published' }),
          { not: { any: [{ type: gadgetRef }] } },
        ],
      }),
      'a branch whose grant tests an ancestor': scope({
        any: [
          { on: productRef, any: [unconditional(baseCardRef)] },
          { on: variantRef, any: [unconditional(variantRef)] },
        ],
      }),
      'a branch with a card predicate': scope({
        on: productRef,
        any: [predicated(productRef, { status: 'published' })],
      }),
      'a mix of type tests and branches': scope({
        any: [
          unconditional(productRef),
          { on: variantRef, any: [unconditional(variantRef)] },
        ],
      }),
      'no exclusion': unconditional(productRef),
      'the exclusion without the id test': {
        every: [
          unconditional(productRef),
          { not: { any: [{ type: realmPolicyRef }] } },
        ],
      },
      'the exclusion of another type': {
        every: [
          unconditional(productRef),
          {
            not: {
              any: [cardIdentityFilter(AUTH_IDS), { type: variantRef }],
            },
          },
        ],
      },
      'the id test as an eq': {
        every: [
          unconditional(productRef),
          {
            not: {
              any: [{ eq: { id: AUTH_IDS[0] } }, { type: realmPolicyRef }],
            },
          },
        ],
      },
    };
    for (let [name, filter] of Object.entries(rejected)) {
      assert.strictEqual(
        storeGrantOf({ any: [filter] }),
        undefined,
        `${name}: not recognized`,
      );
    }
    assert.strictEqual(
      storeGrantOf({
        any: [
          scope(unconditional(productRef)),
          scope(unconditional(variantRef)),
        ],
      }),
      undefined,
      'two scopes',
    );
    assert.strictEqual(
      storeGrantOf(scope(unconditional(productRef))),
      undefined,
      'a scope not composed as a grant filter',
    );
    assert.strictEqual(
      storeGrantOf(
        realmAdmissionFilter(
          [testRealm],
          [{ realm: OTHER, grants: [scope(unconditional(productRef))] }],
        ),
      ),
      undefined,
      "a union's admission",
    );
    assert.strictEqual(
      storeGrantOf({ type: productRef }),
      undefined,
      'a bare type test',
    );

    // The exclusion's ids: the compiler always names at least the config
    // card, each id a non-empty string.
    let withIds = (ids: unknown) => ({
      any: [
        {
          every: [
            unconditional(productRef),
            {
              not: {
                any: [{ cardIdentity: { ids } }, { type: realmPolicyRef }],
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      storeGrantOf(withIds(AUTH_IDS))?.excludedIds,
      AUTH_IDS,
      'the ids as the compiler writes them',
    );
    for (let [name, ids] of Object.entries({
      'ids as a string': AUTH_IDS[0],
      'ids with a non-string member': [AUTH_IDS[0], 7],
      'ids with a null member': [AUTH_IDS[0], null],
      'ids with an empty string': [AUTH_IDS[0], ''],
      'an empty list': [],
      'ids as an object': { 0: AUTH_IDS[0] },
    })) {
      assert.strictEqual(
        storeGrantOf(withIds(ids)),
        undefined,
        `${name}: not recognized`,
      );
    }

    // Any member added anywhere: a shape a later compiler might produce.
    let paths: (string | number)[][] = [];
    let walk = (node: unknown, at: (string | number)[]) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, [...at, i]));
      } else if (node && typeof node === 'object') {
        paths.push(at);
        for (let [k, v] of Object.entries(node)) {
          walk(v, [...at, k]);
        }
      }
    };
    walk(base, []);
    assert.true(paths.length > 8, 'the filter has nodes to mutate');
    for (let path of paths) {
      for (let extra of [
        { eq: { status: 'published' } },
        { on: productRef },
        { storeKeep: true },
      ]) {
        let copy = JSON.parse(JSON.stringify(base));
        let node = path.reduce((n: any, k) => n[k], copy);
        Object.assign(node, extra);
        assert.strictEqual(
          storeGrantOf(copy),
          undefined,
          `${Object.keys(extra)[0]} added at /${path.join('/')}: not recognized`,
        );
      }
    }
  });

  test('the caller filter is the conjunct beside the grant filter, and nothing else', function (assert) {
    let query = scoped(
      { type: product, filter: { eq: { color: 'red' } }, page: { size: 0 } },
      [scope(unconditional(productRef))],
    );
    let { filter } = query.itemQuery;
    let grant = query.grantFilter!;
    assert.deepEqual(
      callerFilterUnder(filter, grant),
      (filter as { every: Filter[] }).every[0],
    );
    assert.strictEqual(
      callerFilterUnder(grant, grant),
      undefined,
      'no caller filter',
    );
    assert.strictEqual(
      callerFilterUnder(
        { every: [{ type: productRef }, grant, { type: productRef }] },
        grant,
      ),
      undefined,
      'three conjuncts',
    );
    assert.strictEqual(
      callerFilterUnder(
        {
          every: [
            { type: productRef },
            { any: [scope(unconditional(variantRef))] },
          ],
        },
        grant,
      ),
      undefined,
      'another grant',
    );
  });

  test("a facet's selection removed from the filter leaves the grant conjunct as composed", function (assert) {
    let query = scoped(
      {
        type: product,
        filter: {
          every: [{ eq: { color: 'red' } }, { eq: { status: 'published' } }],
        },
        page: { size: 0 },
      },
      [scope(unconditional(productRef))],
    );
    let filter = query.itemQuery.filter!;
    let grant = query.grantFilter!;
    for (let by of ['color', 'priceMin']) {
      let without = filterWithout(filter, by)!;
      assert.notStrictEqual(
        callerFilterUnder(without, grant),
        undefined,
        `without ${by}: the grant conjunct is the grant filter`,
      );
    }
    assert.strictEqual(
      filterWithout(filter, 'priceMin'),
      filter,
      'nothing removed: the filter itself',
    );
    // An `any` of conjunctions, none testing the facet's field, is kept
    // whole (it was cut to its first branch, or to its anchor, before).
    let either: Filter = {
      on: productRef,
      any: [
        { every: [{ eq: { color: 'red' } }, { eq: { status: 'draft' } }] },
        { every: [{ eq: { color: 'blue' } }] },
      ],
    } as Filter;
    assert.strictEqual(filterWithout(either, 'priceMin'), either);
  });

  // An `own: 'ignore'` facet over an `any` of conjunctions, none of which
  // tests the facet's field, counts the whole filter's matches, as the
  // facet without `ignore` does. (`filterWithout` cut such an `any` to its
  // first branch, or widened it to the query's type.)
  for (let [name, filter] of Object.entries({
    'an any of conjunctions': {
      any: [
        { every: [{ eq: { color: 'red' } }, { eq: { status: 'draft' } }] },
        { every: [{ eq: { color: 'blue' } }] },
      ],
    },
    'an any of a conjunction and a test': {
      any: [
        { every: [{ eq: { color: 'red' } }, { eq: { status: 'draft' } }] },
        { eq: { color: 'blue' } },
      ],
    },
  })) {
    test(`${name}: an ignore facet on a field it does not test counts all its matches`, async function (assert) {
      let count = async (own?: 'ignore') => {
        let doc = await realmEngine().searchEntries(
          parseSearchEntryQueryFromPayload({
            type: product,
            filter,
            facets: [{ by: 'productType', size: 100, ...(own ? { own } : {}) }],
            page: { size: 0 },
          }),
        );
        return {
          total: doc.meta?.page?.total,
          facet: doc.meta?.facets?.productType,
        };
      };
      let expected = seededCards(testRealm).filter(
        (c) =>
          c.types.some((t) => t.name === 'Product') &&
          ((c.values.color === 'red' && c.values.status === 'draft') ||
            c.values.color === 'blue'),
      );
      let plain = await count();
      let ignored = await count('ignore');
      assert.strictEqual(plain.total, expected.length, 'the matches');
      assert.deepEqual(ignored.facet, plain.facet, 'the same counts');
      let summed = (ignored.facet ?? []).reduce(
        (n: number, b: { count: number }) => n + b.count,
        0,
      );
      assert.strictEqual(summed, expected.length, 'one count per match');
    });
  }

  test('an ignore facet on a field each branch tests counts every branch without it', async function (assert) {
    let doc = await realmEngine().searchEntries(
      parseSearchEntryQueryFromPayload({
        type: product,
        filter: {
          any: [
            { every: [{ eq: { color: 'red' } }, { eq: { status: 'draft' } }] },
            {
              every: [
                { eq: { color: 'blue' } },
                { range: { priceMin: { gte: 300 } } },
              ],
            },
          ],
        },
        facets: [{ by: 'color', size: 100, own: 'ignore' }],
        page: { size: 0 },
      }),
    );
    let matched = seededCards(testRealm).filter(
      (c) =>
        c.types.some((t) => t.name === 'Product') &&
        (c.values.status === 'draft' || Number(c.values.priceMin) >= 300),
    );
    let summed = (doc.meta?.facets?.color ?? []).reduce(
      (n: number, b: { count: number }) => n + b.count,
      0,
    );
    let withColor = matched.filter((c) => c.values.color !== undefined);
    assert.strictEqual(
      summed,
      withColor.length,
      'draft or priced from 300, any color',
    );
  });

  // ---- Carried, and the general read's answer -----------------------------

  const html = 'fitted';
  const facets = [
    { by: 'productType', size: 100 },
    { by: 'color', own: 'ignore', size: 100 },
    {
      by: 'priceMin',
      own: 'ignore',
      stats: true,
      ranges: [
        { key: '0', from: 0, to: 100 },
        { key: '1', from: 100, to: 300 },
        { key: '2', from: 300 },
      ],
    },
    {
      by: 'rating',
      ranges: [
        { key: '4.5', from: 4.5 },
        { key: '4', from: 4 },
      ],
    },
    { by: 'inStock', own: 'ignore' },
  ];
  const measures = [
    { by: 'productType', measure: { avg: 'priceMin' }, size: 100 },
    { by: 'color', measure: { sum: 'reviewCount' }, order: 'measure' },
    { by: 'inStock', measure: { max: 'rating' }, own: 'ignore' },
  ];
  const caseEight = {
    filter: {
      every: [
        { range: { rating: { gte: 4.5 } } },
        { range: { reviewCount: { gte: 20 } } },
      ],
    },
  };
  // Each store path, with its search shape.
  const shapes: Record<string, Record<string, unknown>> = {
    'counts-only facets (a whole type)': { facets, page: { size: 0 } },
    'counts-only facets (a filtered set)': {
      ...caseEight,
      facets,
      page: { size: 0 },
    },
    'counts-only html (a whole type)': {
      facets,
      page: { size: 0 },
      fields: { entry: ['html'] },
      htmlFormat: html,
    },
    'counts-only html (case 8)': {
      ...caseEight,
      facets,
      page: { size: 0 },
      fields: { entry: ['html'] },
      htmlFormat: html,
    },
    'paged html, the case-8 rule': {
      ...caseEight,
      facets,
      sort: [{ by: 'priceMin', direction: 'desc' }, { by: 'cardTitle' }],
      page: { size: 7 },
      fields: { entry: ['html'] },
      htmlFormat: html,
    },
    'paged data with facets': {
      facets,
      sort: [{ by: 'cardTitle' }],
      page: { size: 50 },
    },
    'facet measures': { facets: measures, page: { size: 0 } },
    'facet measures, paged': {
      ...caseEight,
      facets: measures,
      page: { size: 5 },
    },
    'a blend page': {
      sort: [
        {
          blend: [
            { by: 'rating', on: product },
            { by: 'reviewCount', on: product, weight: 0.5 },
          ],
        },
      ],
      page: { size: 9 },
    },
    'a comparison set (case 8 rerank)': {
      ...caseEight,
      sort: [
        {
          expression:
            'STANDARDIZE(rating, stats.rating.avg, stats.rating.stdev) * LOG10(reviewCount + 1)',
          top: 50,
          compare: { by: 'productType', filter: { type: product } },
        },
        { expression: '(rating * reviewCount + 4 * 50) / (reviewCount + 50)' },
      ],
      facets: [
        { by: 'productType', size: 10 },
        { by: 'color', own: 'ignore' },
      ],
      page: { size: 10 },
    },
    'a whole-type total': { page: { size: 3 }, sort: [{ by: 'cardTitle' }] },
  };

  for (let [name, shape] of Object.entries(shapes)) {
    test(`${name}: an unconditional grant is carried, and answers as the general read`, async function (assert) {
      let found = await both({ type: product, ...shape }, [
        scope(unconditional(productRef)),
      ]);
      assert.deepEqual(found.mismatches, [], 'the general read’s document');
      assert.strictEqual(found.compared, 1, 'one policy-scoped search');
      assert.true(found.carried, 'a store path carried the grant');
      let text = JSON.stringify(found.doc);
      assert.false(text.includes('VARIANT-ONLY'), 'no variant is counted');
      assert.false(text.includes('CONFIG'), 'no config card is counted');
      assert.false(text.includes('"POLICY"'), 'no policy card is counted');
      for (let id of found.ids) {
        assert.true(productIds.includes(id), `${id} is a product`);
      }
    });
  }

  // A grant narrower than the searched type (a subclass), and one wider
  // that reaches policy cards (CardDef, in a realm whose config card holds
  // no live row): every path reads the grant's own tests.
  async function dropConfigCard() {
    await adapter.execute(
      `DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
      { bind: [`${testRealm}realm.json`] },
    );
    await adapter.execute(`DELETE FROM boxel_index WHERE url = $1`, {
      bind: [`${testRealm}realm.json`],
    });
  }
  for (let [name, shape] of Object.entries(shapes)) {
    test(`${name}: a grant on a subclass is carried, and admits only its cards`, async function (assert) {
      let found = await both({ type: product, ...shape }, [
        scope(unconditional(gadgetRef)),
      ]);
      assert.deepEqual(found.mismatches, []);
      assert.true(found.carried, 'a store path carried the grant');
      for (let id of found.ids) {
        assert.true(id.includes('/Gadget/'), `${id} is a gadget`);
      }
      if (found.total !== undefined) {
        assert.true(Number(found.total) <= 6, 'at most the gadgets');
      }
    });
    test(`${name}: a grant on CardDef is carried where no excluded card is live, and leaves out policy cards`, async function (assert) {
      await dropConfigCard();
      let found = await both(
        {
          type: { module: baseCardRef.module, name: baseCardRef.name },
          ...shape,
        },
        [scope(unconditional(baseCardRef))],
      );
      assert.deepEqual(found.mismatches, []);
      assert.true(found.carried, 'a store path carried the grant');
      let text = JSON.stringify(found.doc);
      assert.false(text.includes('"POLICY"'), 'no policy card is counted');
      for (let id of excludedIds) {
        assert.false(found.ids.includes(id), `${id} is not served`);
      }
    });
  }

  test('the whole-type total is the granted cards of the type, products and gadgets', async function (assert) {
    let found = await both({ type: product, page: { size: 0 } }, [
      scope(unconditional(productRef)),
    ]);
    assert.true(found.carried);
    assert.strictEqual(found.total, productIds.length);
    let all = await both(
      { type: product, page: { size: 100 }, sort: [{ by: 'cardTitle' }] },
      [scope(unconditional(productRef))],
    );
    assert.deepEqual([...all.ids].sort(), productIds);
  });

  // ---- Grants a store path must not carry ----------------------------------

  const notCarried: Record<string, Filter[]> = {
    'a grant that reads a card field': [
      scope(predicated(productRef, { status: 'published' })),
    ],
    'an unconditional grant beside one that reads a card field': [
      scope({
        any: [
          unconditional(productRef),
          predicated(productRef, { status: 'published' }),
        ],
      }),
    ],
    'a branch whose grant tests an ancestor': [
      scope({ on: productRef, any: [unconditional(baseCardRef)] }),
    ],
  };
  for (let [name, scopes] of Object.entries(notCarried)) {
    for (let [shapeName, shape] of Object.entries({
      'counts-only facets': shapes['counts-only facets (a filtered set)'],
      'paged html': shapes['paged html, the case-8 rule'],
      'a comparison set': shapes['a comparison set (case 8 rerank)'],
      'a whole-type total': shapes['a whole-type total'],
    })) {
      test(`${name}, ${shapeName}: the general read`, async function (assert) {
        let found = await both({ type: product, ...shape }, scopes);
        assert.deepEqual(found.mismatches, []);
        assert.strictEqual(found.compared, 1);
        assert.false(found.carried, 'no store path carried the grant');
      });
    }
  }

  test('a grant that reads a card field admits only the cards it admits', async function (assert) {
    let found = await both(
      { type: product, page: { size: 100 }, sort: [{ by: 'cardTitle' }] },
      [scope(predicated(productRef, { status: 'published' }))],
    );
    assert.false(found.carried);
    let published = seededCards(testRealm).filter(
      (c) =>
        c.types.some((t) => t.name === 'Product') &&
        c.values.status === 'published',
    );
    assert.strictEqual(found.total, published.length);
  });

  // ---- The exclusion -------------------------------------------------------

  for (let spelling of ['id', 'id.json']) {
    let spelled = (ids: string[]) =>
      spelling === 'id' ? ids : ids.map((id) => `${id}.json`);

    test(`a grant on CardDef (exclusion ids spelled ${spelling}): the config card is a live card it admits, so the general read, and no authorization card`, async function (assert) {
      let found = await both(
        { type: baseCardRef, page: { size: 200 }, sort: [{ by: 'cardTitle' }] },
        [scope(unconditional(baseCardRef), spelled(AUTH_IDS))],
      );
      assert.deepEqual(found.mismatches, []);
      assert.false(found.carried, 'no store path carried the grant');
      for (let id of excludedIds) {
        assert.false(found.ids.includes(id), `${id} is not served`);
      }
      assert.strictEqual(
        found.total,
        seededCards(testRealm).length - excludedIds.length,
        'every other card',
      );
      let counted = await both({ type: baseCardRef, page: { size: 0 } }, [
        scope(unconditional(baseCardRef), spelled(AUTH_IDS)),
      ]);
      assert.false(counted.carried);
      assert.strictEqual(counted.total, found.total, 'counted alike');
    });

    test(`a policy key naming a granted card (spelled ${spelling}): the general read leaves it out`, async function (assert) {
      let named = `${testRealm}Product/p05`;
      for (let shape of [
        shapes['counts-only facets (a whole type)'],
        shapes['paged data with facets'],
        shapes['a whole-type total'],
      ]) {
        let found = await both({ type: product, ...shape }, [
          scope(
            unconditional(productRef),
            spelled([`${testRealm}realm`, named]),
          ),
        ]);
        assert.deepEqual(found.mismatches, []);
        assert.false(found.carried, 'no store path carried the grant');
        assert.false(found.ids.includes(named), 'the named card is not served');
        if (Number((shape.page as { size: number }).size) === 0) {
          assert.strictEqual(found.total, productIds.length - 1);
        }
      }
    });
  }

  test('a grant on CardDef where the config card holds no live row: carried, and RealmPolicy cards are left out by type', async function (assert) {
    await adapter.execute(
      `DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
      { bind: [`${testRealm}realm.json`] },
    );
    await adapter.execute(`DELETE FROM boxel_index WHERE url = $1`, {
      bind: [`${testRealm}realm.json`],
    });
    let found = await both(
      { type: baseCardRef, page: { size: 200 }, sort: [{ by: 'cardTitle' }] },
      [scope(unconditional(baseCardRef))],
    );
    assert.deepEqual(found.mismatches, []);
    assert.true(found.carried, 'a store path carried the grant');
    for (let id of excludedIds) {
      assert.false(found.ids.includes(id), `${id} is not served`);
    }
    assert.strictEqual(
      found.total,
      seededCards(testRealm).length - excludedIds.length,
    );
    let draftOnly = await both(
      {
        type: baseCardRef,
        filter: { eq: { productType: 'POLICY' } },
        page: { size: 0 },
        facets: [{ by: 'productType' }],
      },
      [scope(unconditional(baseCardRef))],
    );
    assert.deepEqual(draftOnly.mismatches, []);
    assert.strictEqual(
      draftOnly.total,
      0,
      'the draft policy card is not counted',
    );
  });

  test('a comparison set over CardDef leaves out policy cards, whose values would move its statistics', async function (assert) {
    await adapter.execute(
      `DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
      { bind: [`${testRealm}realm.json`] },
    );
    await adapter.execute(`DELETE FROM boxel_index WHERE url = $1`, {
      bind: [`${testRealm}realm.json`],
    });
    // The order depends on the comparison set's average rating: the draft
    // policy card's 1000, taken in, would turn it around.
    let found = await both(
      {
        type: baseCardRef,
        filter: { type: product },
        sort: [
          {
            expression: 'ABS(rating - stats.rating.avg)',
            top: 50,
            compare: { filter: { type: baseCardRef } },
          },
          { by: 'cardTitle' },
        ],
        page: { size: 20 },
      },
      [scope(unconditional(baseCardRef))],
    );
    assert.deepEqual(found.mismatches, [], 'the general read’s document');
    assert.true(found.carried, 'a store path carried the grant');
  });

  test('a live card of a granted type with no search document: the general read', async function (assert) {
    await adapter.execute(
      `UPDATE boxel_index SET search_doc = NULL WHERE url = $1`,
      { bind: [`${testRealm}Product/p07.json`] },
    );
    await adapter.execute(
      `DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
      { bind: [`${testRealm}Product/p07.json`] },
    );
    let [{ id: cardId }] = (await adapter.execute(
      `SELECT id FROM boxel_index_value_cards WHERE url = $1`,
      { bind: [`${testRealm}Product/p07.json`] },
    )) as { id: number }[];
    // its rows as the store writes a card whose search_keys are not an
    // object: the empty-path marker and card row
    await adapter.execute(
      `INSERT INTO boxel_index_values (realm_id, type_id, path_id, card_id, kind, txt) SELECT r.id, t.id, p.id, $1, k.kind, k.txt FROM boxel_index_value_realms r, boxel_index_value_types t, boxel_index_value_paths p, (VALUES ('m'::"char", NULL::text), ('c'::"char", '')) AS k (kind, txt) WHERE r.realm_url = $2 AND t.realm_url = $2 AND t.type = $3 AND p.path = ''`,
      {
        bind: [
          cardId,
          testRealm,
          internalKeyFor(productRef, undefined, virtualNetwork),
        ],
      },
    );
    let found = await both({ type: product, facets, page: { size: 0 } }, [
      scope(unconditional(productRef)),
    ]);
    assert.deepEqual(found.mismatches, []);
    assert.false(found.carried, 'no store path carried the grant');
    assert.strictEqual(
      found.total,
      productIds.length - 1,
      'that card is left out',
    );
  });

  // ---- Types -----------------------------------------------------------------

  test('subclasses: a grant on Product admits gadgets; a grant on Gadget admits no plain product', async function (assert) {
    let onProduct = await both(
      {
        type: product,
        page: { size: 100 },
        sort: [{ by: 'cardTitle' }],
        facets,
      },
      [scope(unconditional(productRef))],
    );
    assert.true(onProduct.carried);
    assert.true(
      onProduct.ids.some((id) => id.includes('/Gadget/')),
      'gadgets',
    );
    let onGadget = await both(
      {
        type: product,
        page: { size: 100 },
        sort: [{ by: 'cardTitle' }],
        facets,
      },
      [scope(unconditional(gadgetRef))],
    );
    assert.deepEqual(onGadget.mismatches, []);
    assert.true(onGadget.carried);
    assert.strictEqual(onGadget.total, 6);
    assert.true(
      onGadget.ids.every((id) => id.includes('/Gadget/')),
      'gadgets only',
    );
    let counted = await both({ type: product, page: { size: 0 }, facets }, [
      scope(unconditional(gadgetRef)),
    ]);
    assert.true(counted.carried);
    assert.strictEqual(counted.total, 6, 'counted: gadgets only');
    assert.deepEqual(counted.facets, onGadget.facets, 'the same facets');
  });

  test('a type the grant does not admit: no row, count or facet value, carried or not', async function (assert) {
    for (let shape of Object.values(shapes)) {
      let found = await both(
        {
          type: { module: variantRef.module, name: variantRef.name },
          ...shape,
        },
        [scope(unconditional(productRef))],
      );
      assert.deepEqual(found.mismatches, []);
      let total = found.total === undefined ? 0 : found.total;
      assert.strictEqual(total, 0, 'nothing counted');
      assert.deepEqual(found.ids, [], 'no row');
      assert.false(JSON.stringify(found.doc).includes('VARIANT-ONLY'));
      for (let id of variantIds) {
        assert.false(JSON.stringify(found.doc).includes(id));
      }
    }
  });

  test('several types: each granted type, and no other', async function (assert) {
    let either = {
      any: [
        { 'item.on': product },
        { 'item.on': { module: variantRef.module, name: variantRef.name } },
      ],
    };
    let one = await both({ filter: either, page: { size: 100 } }, [
      scope({ on: productRef, any: [unconditional(productRef)] }),
    ]);
    assert.deepEqual(one.mismatches, []);
    assert.deepEqual([...one.ids].sort(), productIds, 'products only');
    let two = await both({ filter: either, page: { size: 100 } }, [
      scope({
        any: [
          { on: productRef, any: [unconditional(productRef)] },
          { on: variantRef, any: [unconditional(variantRef)] },
        ],
      }),
    ]);
    assert.deepEqual(two.mismatches, []);
    assert.strictEqual(two.total, productIds.length + variantIds.length);
  });

  // ---- Unions ------------------------------------------------------------------

  test('a union of a realm read outright and one a policy scopes: never carried, the general read', async function (assert) {
    let engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    let admission = realmAdmissionFilter(
      [OTHER],
      [{ realm: testRealm, grants: [scope(unconditional(productRef))] }],
    );
    for (let size of [0, 5]) {
      let compared = comparePolicyStorePaths();
      let result;
      try {
        result = await engine.search(
          new RealmUnion([testRealm, OTHER]),
          {
            filter: { type: productRef },
            facets,
            page: { size },
          } as unknown as Query,
          { grantFilter: admission, labelFilter: admission },
          { kind: 'dataOnly' },
          'all',
        );
      } finally {
        compared.restore();
      }
      assert.deepEqual(compared.observation.mismatches, [], `size ${size}`);
      assert.strictEqual(compared.observation.compared, 1);
      assert.strictEqual(compared.observation.carried, 0, 'not carried');
      assert.strictEqual(result.meta.page?.total, productIds.length * 2);
    }
    // One realm of a union under its own policy is a realm's own search.
    let single = await both({ type: product, facets, page: { size: 0 } }, [
      scope(unconditional(productRef)),
    ]);
    assert.true(single.carried);
  });

  test('a search told to read grants the general way reads no store path for them', async function (assert) {
    let compared = comparePolicyStorePaths();
    try {
      await realmEngine().searchEntries(
        scoped({ type: product, facets, page: { size: 0 } }, [
          scope(unconditional(productRef)),
        ]),
        { grantsOnGeneralPath: true } as never,
      );
    } finally {
      compared.restore();
    }
    assert.strictEqual(compared.observation.compared, 0, 'not compared');
  });
});
