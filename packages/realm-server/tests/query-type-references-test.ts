import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  InvalidQueryError,
  SearchRequestError,
  VirtualNetwork,
  assertQuery,
  canonicalQuerySignature,
  isResolvedCodeRef,
  normalizeQueryDefinition,
  normalizeQueryForSignature,
  parseTypeReference,
  resolveTypeReferences,
  rri,
  searchEntryWireQueryFromQuery,
  searchTypeReferenceContext,
  type CodeRef,
  type FieldDefinition,
  type Query,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
  type RealmPermissions,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  admitsNothing,
  resolveNamedQuery,
  type OperationCore,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import type { Definition } from '@cardstack/runtime-common/definitions';
import {
  lowerQuery,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-syntax';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  runTestRealmServerWithRealms,
  searchCardsForTest,
  setupDB,
} from './helpers/index.ts';

// How a query names a card type where no JavaScript hands it a class: the
// code ref `{ module, name }`, its shorthand `"<module>#<Name>"`, and in
// either a realm-relative module `$REALM/<path>` (docs/search.md, "One type
// for the whole query"). Each spelling of one type is one query: the same
// lowered form, the same signature and the same rows.
//
// The first module needs no index; the second runs the spellings against two
// realms on one test server, through `_search`, `_federated-search`, a
// query-backed field and a named query.

const REALM = 'http://type-refs.test/shop/';
const PEER = 'http://type-refs.test/peer/';
const PRODUCT = { module: `${REALM}product`, name: 'Product' };

type Outcome = { code?: string; message: string } | 'accepted';
function outcome(run: () => unknown): Outcome {
  try {
    run();
    return 'accepted';
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      return { code: e.code, message: e.message };
    }
    if (e instanceof SearchRequestError) {
      return { code: e.queryCode, message: e.message };
    }
    throw e;
  }
}
const viaAssert = (query: unknown) => outcome(() => assertQuery(query as any));
const viaWire = (payload: unknown, realm = REALM) =>
  outcome(() =>
    parseSearchEntryQueryFromPayload(
      JSON.parse(JSON.stringify(payload)),
      searchTypeReferenceContext([realm]),
    ),
  );
// What the engine is handed for a request to the realm: the wire parsed,
// with the request's type references resolved against it.
const itemQuery = (payload: unknown, realms = [REALM]) =>
  parseSearchEntryQueryFromPayload(
    JSON.parse(JSON.stringify(payload)),
    searchTypeReferenceContext(realms),
  ).itemQuery;

function refusedWithInvalidType(
  assert: Assert,
  got: Outcome,
  door: string,
  says?: string,
) {
  if (got === 'accepted') {
    assert.ok(false, `${door}: refused (was accepted)`);
    return;
  }
  assert.strictEqual(got.code, 'invalid-type', `${door}: ${got.message}`);
  if (says) {
    assert.true(
      got.message.includes(says),
      `${door}: the message says "${says}" (${got.message})`,
    );
  }
}

module(basename(import.meta.filename), function () {
  module('reading a type reference', function () {
    test('the shorthand reads as the code ref it stands for', function (assert) {
      assert.deepEqual(
        parseTypeReference(`${REALM}product#Product`),
        PRODUCT,
        'an absolute module',
      );
      assert.deepEqual(
        parseTypeReference('@cardstack/base/card-api#CardDef'),
        { module: '@cardstack/base/card-api', name: 'CardDef' },
        'a registered prefix',
      );
      assert.deepEqual(
        parseTypeReference('$REALM/catalog/product#Product'),
        { module: '$REALM/catalog/product', name: 'Product' },
        'a realm-relative module, as written until a realm is known',
      );
      assert.deepEqual(
        resolveTypeReferences(
          { type: '$REALM/catalog/product#Product' },
          { realm: REALM },
        ) as unknown,
        { type: { module: `${REALM}catalog/product`, name: 'Product' } },
        'and resolved against the realm it belongs to',
      );
    });

    test('every place a query names a type takes the shorthand', function (assert) {
      let s = '$REALM/product#Product';
      let resolved = resolveTypeReferences(
        {
          type: s,
          filter: {
            every: [
              { type: s },
              { on: s, eq: { type: 'not a type: a field named type' } },
              { not: { 'item.on': s, eq: { 'item.status': 'x' } } },
              { any: [{ 'item.type': s }] },
            ],
          },
          sort: [
            { expression: 'rank', compare: { filter: { type: s } } },
            { by: 'rank', on: s },
            {
              blend: [
                { by: 'rank', on: s },
                { boost: { on: s, eq: { a: 1 } } },
              ],
            },
            { by: '_when', when: { type: s } },
          ],
          collapse: { by: 'status', on: s },
          facets: [{ by: 'status', on: s }],
          let: {
            $names: {
              from: { type: s, filter: { on: s, eq: { a: 1 } } },
              select: 'title',
            },
          },
        },
        { realm: REALM },
      ) as any;
      let p = PRODUCT;
      assert.deepEqual(resolved.type, p, 'type');
      assert.deepEqual(resolved.filter.every[0].type, p, 'a filter’s type');
      assert.deepEqual(resolved.filter.every[1].on, p, 'a filter’s on');
      assert.deepEqual(
        resolved.filter.every[1].eq,
        { type: 'not a type: a field named type' },
        'a field named type inside an operator is a value, left alone',
      );
      assert.deepEqual(
        resolved.filter.every[2].not['item.on'],
        p,
        'the wire’s item.on, under not',
      );
      assert.deepEqual(
        resolved.filter.every[3].any[0]['item.type'],
        p,
        'item.type, under any',
      );
      assert.deepEqual(resolved.sort[1].on, p, 'a sort’s on');
      assert.deepEqual(resolved.sort[2].blend[0].on, p, 'a blend signal’s on');
      assert.deepEqual(
        resolved.sort[2].blend[1].boost.on,
        p,
        'a boost’s filter',
      );
      assert.deepEqual(
        resolved.sort[3].when.type,
        p,
        'a lowered boost’s filter',
      );
      assert.deepEqual(resolved.collapse.on, p, 'collapse');
      assert.deepEqual(resolved.facets[0].on, p, 'a facet');
      assert.deepEqual(
        resolved.sort[0].compare.filter.type,
        p,
        'a sort entry’s compare.filter, in the outer query’s realm',
      );
      assert.deepEqual(
        resolved.let.$names.from.type,
        p,
        'a let binding’s type, in the outer query’s realm',
      );
      assert.deepEqual(
        resolved.let.$names.from.filter.on,
        p,
        'a let binding’s filter',
      );
    });

    test('a query with nothing to rewrite is passed through as it is', function (assert) {
      let query = { filter: { on: PRODUCT, eq: { status: 'open' } } };
      assert.strictEqual(resolveTypeReferences(query, { realm: REALM }), query);
    });

    test('a shorthand that names no type is refused with invalid-type', function (assert) {
      let mistakes: [string, string, string][] = [
        ['no #', `${REALM}product`, 'names no type'],
        ['an empty name', `${REALM}product#`, 'names no type after "#"'],
        [
          'a name that is no identifier',
          `${REALM}product#Pro duct`,
          'is not a type',
        ],
        ['a bare module', 'product#Product', 'names no module'],
        ['a relative module', './product#Product', 'names no module'],
        ['an empty module', '#Product', 'names no module'],
        ['a scope with no package', '@cardstack#Product', 'names no module'],
        ['$REALM with no path', '$REALM/#Product', 'names no module'],
        [
          '$REALM leaving its realm',
          '$REALM/../other/product#Product',
          'leaves its realm',
        ],
      ];
      for (let [name, shorthand, says] of mistakes) {
        refusedWithInvalidType(
          assert,
          viaAssert({ type: shorthand }),
          `${name}, top-level type (assertQuery)`,
          says,
        );
        refusedWithInvalidType(
          assert,
          viaAssert({ filter: { type: shorthand } }),
          `${name}, older spelling (assertQuery)`,
          says,
        );
        refusedWithInvalidType(
          assert,
          viaWire({ type: shorthand }),
          `${name}, on the wire`,
          says,
        );
        refusedWithInvalidType(
          assert,
          viaWire({
            filter: { 'item.on': shorthand, eq: { 'item.status': 'x' } },
          }),
          `${name}, item.on on the wire`,
          says,
        );
      }
      refusedWithInvalidType(
        assert,
        viaAssert({ type: 7 }),
        'a number',
        'card type',
      );
    });
  });

  module('one type, three spellings, one query', function () {
    const spellings: Record<string, unknown> = {
      'the code ref': PRODUCT,
      'the shorthand': `${REALM}product#Product`,
      'the realm-relative shorthand': '$REALM/product#Product',
      'the realm-relative code ref': {
        module: '$REALM/product',
        name: 'Product',
      },
    };
    const query = (type: unknown) => ({
      type,
      filter: { eq: { status: 'open' } },
      sort: [{ by: 'rank' }],
    });

    test('lower to the same query and sign alike', function (assert) {
      let network = new VirtualNetwork();
      let resolved = Object.entries(spellings).map(
        ([name, type]) =>
          [
            name,
            resolveTypeReferences(query(type), { realm: REALM }) as Query,
          ] as const,
      );
      let [, first] = resolved[0];
      let lowered = JSON.stringify(lowerQuery(first as any).query);
      for (let [name, q] of resolved) {
        assert.strictEqual(
          JSON.stringify(lowerQuery(q as any).query),
          lowered,
          `${name}: lowered`,
        );
        assert.deepEqual(
          normalizeQueryForSignature(q),
          normalizeQueryForSignature(first),
          `${name}: signature`,
        );
        assert.strictEqual(
          canonicalQuerySignature(q, network),
          canonicalQuerySignature(first, network),
          `${name}: canonical signature`,
        );
      }
    });

    test('the shorthand and the code ref sign alike before a realm is known', function (assert) {
      assert.deepEqual(
        normalizeQueryForSignature(query(`${REALM}product#Product`) as Query),
        normalizeQueryForSignature(query(PRODUCT) as Query),
      );
      assert.deepEqual(
        normalizeQueryForSignature(query('$REALM/product#Product') as Query),
        normalizeQueryForSignature(
          query({ module: '$REALM/product', name: 'Product' }) as Query,
        ),
      );
    });

    test('a request in each spelling reaches the engine as one query', function (assert) {
      let wire = (type: unknown) => ({
        type,
        filter: { eq: { status: 'open' } },
        page: { size: 5 },
      });
      let expected = itemQuery(wire(PRODUCT));
      for (let [name, type] of Object.entries(spellings)) {
        assert.deepEqual(itemQuery(wire(type)), expected, name);
      }
      assert.deepEqual(
        itemQuery({
          filter: {
            'item.on': '$REALM/product#Product',
            eq: { 'item.status': 'open' },
          },
        }),
        itemQuery({
          filter: { 'item.on': PRODUCT, eq: { 'item.status': 'open' } },
        }),
        'the wire’s own item.on',
      );
    });

    test('a client carries $REALM to the realm, which resolves it', function (assert) {
      let wire = searchEntryWireQueryFromQuery(
        query('$REALM/product#Product') as Query,
      ) as any;
      assert.deepEqual(
        wire.filter['item.on'],
        { module: '$REALM/product', name: 'Product' },
        'the client parses the shorthand and leaves the realm to the boundary',
      );
      assert.deepEqual(
        itemQuery(wire),
        itemQuery(searchEntryWireQueryFromQuery(query(PRODUCT) as Query)),
        'which reads it as the absolute type',
      );
    });

    test('let bindings and a comparison set resolve in the outer query’s realm', function (assert) {
      let q = itemQuery({
        type: '$REALM/product#Product',
        let: {
          $special: {
            from: { type: '$REALM/product#Special' },
            select: 'title',
          },
        },
        filter: { in: { title: '$special' } },
        sort: [
          {
            expression: 'rank / stats.rank.max',
            compare: { filter: { type: '$REALM/product#Special' } },
          },
        ],
      }) as any;
      let special = { module: `${REALM}product`, name: 'Special' };
      assert.true(
        JSON.stringify(q.let.$special.from).includes(JSON.stringify(special)),
        `the binding's type: ${JSON.stringify(q.let.$special.from)}`,
      );
      assert.true(
        JSON.stringify(q.rerank.compare.filter).includes(
          JSON.stringify(special),
        ),
        `the comparison set's type: ${JSON.stringify(q.rerank.compare.filter)}`,
      );
      assert.false(JSON.stringify(q).includes('$REALM'), 'no $REALM is left');
    });

    test('a registered prefix keeps its spelling', function (assert) {
      assert.deepEqual(
        itemQuery({ type: '@cardstack/base/card-api#CardDef' }),
        itemQuery({
          type: { module: '@cardstack/base/card-api', name: 'CardDef' },
        }),
      );
    });

    test('a mapped realm’s $REALM resolves to its canonical prefix form', function (assert) {
      let network = new VirtualNetwork();
      network.addRealmMapping('@test/shop/', REALM);
      let resolved = resolveTypeReferences(
        { type: '$REALM/product#Product' },
        { realm: REALM, canonicalize: (url) => network.unresolveURL(url) },
      );
      assert.deepEqual(resolved as unknown, {
        type: { module: '@test/shop/product', name: 'Product' },
      });
    });
  });

  module('a search across several realms', function () {
    test('refuses $REALM, which names no one realm', function (assert) {
      for (let type of [
        '$REALM/product#Product',
        { module: '$REALM/product', name: 'Product' },
      ]) {
        refusedWithInvalidType(
          assert,
          outcome(() => itemQuery({ type }, [REALM, PEER])),
          `${JSON.stringify(type)} over two realms`,
          'use an absolute or @scope/… module',
        );
      }
    });

    test('takes absolute types, and $REALM over one realm', function (assert) {
      assert.strictEqual(
        outcome(() =>
          itemQuery({ type: `${REALM}product#Product` }, [REALM, PEER]),
        ),
        'accepted',
      );
      assert.deepEqual(
        itemQuery({ type: '$REALM/product#Product' }, [PEER]),
        itemQuery({ type: `${PEER}product#Product` }, [PEER]),
        'one realm is the realm $REALM names',
      );
      assert.deepEqual(
        itemQuery({ type: '$REALM/product#Product' }, [REALM, REALM]),
        itemQuery({ type: PRODUCT }),
        'a realm named twice is one realm',
      );
    });
  });

  module('the older spelling', function () {
    // On main a string `type` or `on` is refused in both spellings ("type is
    // not valid", and a top-level `type` is an unknown member there), so the
    // shorthand is additive in both, and an older query that adopts it is
    // still read as the older spelling.
    test('a shorthand does not make a query the newer spelling', function (assert) {
      assert.false(
        usesNewSyntax({ filter: { type: `${REALM}product#Product` } }),
      );
      assert.false(
        usesNewSyntax({
          filter: { on: `${REALM}product#Product`, eq: { status: 'open' } },
        }),
      );
    });

    test('an older query with a shorthand is checked as the older spelling', function (assert) {
      assert.strictEqual(
        viaAssert({
          filter: { on: `${REALM}product#Product`, eq: { status: 'open' } },
          sort: [{ by: 'rank', on: `${REALM}product#Product` }],
          // a member the older spelling ignores rather than refuses
          page: { size: 5, cursor: 'saved-with-the-query' },
        }),
        'accepted',
      );
      assert.deepEqual(
        itemQuery({
          filter: {
            'item.on': `${REALM}product#Product`,
            eq: { 'item.status': 'open' },
          },
        }),
        itemQuery({
          filter: { 'item.on': PRODUCT, eq: { 'item.status': 'open' } },
        }),
      );
    });
  });

  module('a query-backed field', function () {
    const fieldDefinition = {
      type: 'linksToMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: PRODUCT,
    } as unknown as FieldDefinition;
    function fieldQuery(
      queryDefinition: Record<string, any>,
      resource = { id: `${REALM}shelves/1` },
    ) {
      return normalizeQueryDefinition({
        fieldDefinition,
        queryDefinition: queryDefinition as any,
        realmURL: new URL(REALM),
        fieldName: 'picks',
        resolvePathValue: () => undefined,
        resource: resource as any,
      })!.query as any;
    }

    test('names modules in the realm of the card declaring it', function (assert) {
      let q = fieldQuery({
        filter: { on: '$REALM/product#Product', eq: { status: 'open' } },
        sort: [
          { by: 'rank', on: { module: '$REALM/product', name: 'Product' } },
        ],
      });
      assert.deepEqual(q.filter.on, PRODUCT, 'a filter’s on');
      assert.deepEqual(q.sort[0].on, PRODUCT, 'a sort’s on');
      assert.deepEqual(
        fieldQuery({ type: '$REALM/product#Special' }).type,
        { module: `${REALM}product`, name: 'Special' },
        'a top-level type',
      );
      assert.deepEqual(
        fieldQuery({
          let: {
            $s: { from: { type: '$REALM/product#Special' }, select: 'title' },
          },
          filter: { in: { title: '$s' } },
        }).let.$s.from.type,
        { module: `${REALM}product`, name: 'Special' },
        'a let binding',
      );
    });

    test('names a mapped realm by its prefix', function (assert) {
      let q = fieldQuery(
        { filter: { type: '$REALM/product#Product' } },
        { id: '@test/shop/shelves/1' },
      );
      assert.true(
        JSON.stringify(q).includes('"@test/shop/product"'),
        JSON.stringify(q.filter),
      );
    });

    test('a bad shorthand is refused, naming the field', function (assert) {
      let got = outcome(() => fieldQuery({ filter: { type: 'Product' } }));
      refusedWithInvalidType(assert, got, 'the field', 'picks:');
    });
  });

  module('a named query', function () {
    const REPORT: ResolvedCodeRef = {
      module: rri(`${REALM}report`),
      name: 'Report',
    };
    const OPERATIONS: Record<string, OperationDefinition> = {
      openHere: {
        base: 'query',
        deterministic: true,
        query: {
          filter: {
            'item.on': { module: '$REALM/report', name: 'Report' } as any,
            eq: { 'item.status': 'open' },
          },
        },
      },
    };
    function stubCore() {
      let definition = {
        type: 'card-def',
        codeRef: REPORT,
        displayName: 'Report',
        fields: {},
        fieldDefs: {},
        operations: OPERATIONS,
      } as unknown as Definition;
      return {
        realmURL: REALM,
        definitionLookup: {
          async lookupDefinition() {
            return definition;
          },
          async lookupDefinitionEntry() {
            return { definition, types: [`${REPORT.module}/${REPORT.name}`] };
          },
        },
        resolveCodeRef: (codeRef: CodeRef) =>
          isResolvedCodeRef(codeRef) ? codeRef : undefined,
        async readsRealmOf() {
          return { realm: REALM, read: true };
        },
      } as unknown as OperationCore;
    }

    test('its declaration’s $REALM is the realm that holds it, wherever it searches', async function (assert) {
      let resolved = await resolveNamedQuery(
        stubCore(),
        { operation: 'openHere', on: REPORT, realms: [REALM, PEER] },
        {
          principal: { kind: 'user', user: '@caller:localhost' },
          realms: [REALM, PEER],
        },
      );
      assert.false(admitsNothing(resolved), 'a query');
      let query = (resolved as { query: Record<string, any> }).query;
      assert.deepEqual(query.filter['item.on'], REPORT);
      assert.deepEqual(query.realms, [REALM, PEER]);
    });
  });

  // -------------------------------------------------------------------------
  // Against real realms
  // -------------------------------------------------------------------------

  module('over HTTP', function (hooks) {
    const SHOP = 'http://127.0.0.1:4444/type-refs-shop/';
    const OTHER = 'http://127.0.0.1:4444/type-refs-other/';
    const OWNER = '@owner:localhost';
    const SHOP_PRODUCT = { module: `${SHOP}product`, name: 'Product' };

    // The modules a card's own JavaScript writes are evaluated by the
    // prerenderer, which runs the host's build of runtime-common: a module
    // whose declarations use the shorthand is checked there as well. Each
    // spelling is kept in a module of its own, so one the build does not read
    // yet fails that module's cards only.
    const PRODUCT_MODULE = `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";
      import { operation } from "@cardstack/base/operations";

      export class Product extends CardDef {
        @field title = contains(StringField);
        @field status = contains(StringField);
        @field rank = contains(NumberField);

        // a declaration names a module in the realm that holds it
        @operation static openHere = {
          base: 'query',
          query: {
            filter: {
              on: { module: '$REALM/product', name: 'Product' },
              eq: { status: 'open' },
            },
          },
        };
      }
      export class Special extends Product {}
    `;
    const LISTING_MODULE = `
      import { operation } from "@cardstack/base/operations";
      import { Product } from "./product";

      export class Listing extends Product {
        @operation static openProducts = {
          base: 'query',
          query: { filter: { on: '$REALM/product#Product', eq: { status: 'open' } } },
        };
      }
    `;
    const SHELF_MODULE = `
      import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { Product } from "./product";

      export class Shelf extends CardDef {
        @field want = contains(StringField);
        @field wanted = linksToMany(() => Product, {
          query: { filter: { on: '$REALM/product#Product', eq: { status: '$this.want' } } },
        });
        @field specials = linksToMany(() => Product, {
          query: { filter: { type: { module: '$REALM/product', name: 'Special' } } },
        });
      }
    `;
    const NARROW_SHELF_MODULE = `
      import { field, linksToMany, CardDef } from "@cardstack/base/card-api";
      import { Product } from "./product";

      export class NarrowShelf extends CardDef {
        @field narrowed = linksToMany(() => Product, {
          query: { type: '$REALM/product#Special' },
        });
      }
    `;
    function card(
      module: string,
      name: string,
      attributes: Record<string, unknown>,
    ) {
      return JSON.stringify({
        data: {
          type: 'card',
          attributes,
          meta: { adoptsFrom: { module: rri(module), name } },
        },
      });
    }

    let shop: Realm;
    let other: Realm;
    let request: SuperTest<Test>;
    let server: Server;

    async function start({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      let permissions: RealmPermissions = {
        [OWNER]: ['read', 'write', 'realm-owner'],
        '*': ['read'],
      };
      let result = await runTestRealmServerWithRealms({
        virtualNetwork: createVirtualNetwork(),
        realmsRootPath: join(dirSync().name, 'realm_server_1'),
        realms: [
          {
            realmURL: new URL(SHOP),
            fileSystem: {
              'product.gts': PRODUCT_MODULE,
              'listing.gts': LISTING_MODULE,
              'shelf.gts': SHELF_MODULE,
              'narrow-shelf.gts': NARROW_SHELF_MODULE,
              'p1.json': card('./product', 'Product', {
                title: 'p1',
                status: 'open',
                rank: 2,
              }),
              'p2.json': card('./product', 'Product', {
                title: 'p2',
                status: 'open',
                rank: 1,
              }),
              'p3.json': card('./product', 'Product', {
                title: 'p3',
                status: 'closed',
                rank: 4,
              }),
              's1.json': card('./product', 'Special', {
                title: 's1',
                status: 'open',
                rank: 3,
              }),
              'shelf.json': card('./shelf', 'Shelf', { want: 'open' }),
              'narrow-shelf.json': card('./narrow-shelf', 'NarrowShelf', {}),
            },
            permissions,
          },
          {
            realmURL: new URL(OTHER),
            fileSystem: {
              'q1.json': card(`${SHOP}product`, 'Product', {
                title: 'q1',
                status: 'open',
                rank: 5,
              }),
            },
            permissions,
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      server = result.testRealmHttpServer;
      request = supertest(server);
      shop = result.realms.find((r) => r.url === SHOP)!;
      other = result.realms.find((r) => r.url === OTHER)!;
    }

    hooks.before(function (assert) {
      assert.timeout(300_000);
    });
    setupDB(hooks, {
      before: async (dbAdapter, publisher, runner) => {
        await start({ dbAdapter, publisher, runner });
      },
      after: async () => {
        for (let realm of [shop, other]) {
          realm?.unsubscribe();
        }
        if (server) {
          await closeServer(server);
        }
        resetCatalogRealms();
      },
    });

    function search(path: string, body: Record<string, unknown>) {
      return request
        .post(path)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(body);
    }
    const realmSearch = (body: Record<string, unknown>) =>
      search(`${new URL(SHOP).pathname}_search`, body);
    const federated = (body: Record<string, unknown>) =>
      search('/_federated-search', body);
    const ids = (response: { status: number; text: string; body: any }) => {
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }
      return (response.body.data as { id: string }[])
        .map((entry) =>
          entry.id.replace(SHOP, 'shop/').replace(OTHER, 'other/'),
        )
        .sort();
    };

    test('_search: every spelling of the type finds the same cards', async function (assert) {
      let spellings: unknown[] = [
        SHOP_PRODUCT,
        `${SHOP}product#Product`,
        '$REALM/product#Product',
        { module: '$REALM/product', name: 'Product' },
      ];
      let expected = ['shop/p1', 'shop/p2', 'shop/s1'];
      for (let type of spellings) {
        assert.deepEqual(
          ids(await realmSearch({ type, filter: { eq: { status: 'open' } } })),
          expected,
          `type: ${JSON.stringify(type)}`,
        );
        assert.deepEqual(
          ids(
            await realmSearch({
              filter: { 'item.on': type, eq: { 'item.status': 'open' } },
            }),
          ),
          expected,
          `older spelling, item.on: ${JSON.stringify(type)}`,
        );
      }
      assert.deepEqual(
        ids(
          await realmSearch({
            filter: { 'item.on': '$REALM/product#Special' },
          }),
        ),
        ['shop/s1'],
        'a filter’s type alone',
      );
    });

    test('_search: a let binding names its type in the realm searched', async function (assert) {
      assert.deepEqual(
        ids(
          await realmSearch({
            type: '$REALM/product#Product',
            let: {
              $special: {
                from: { type: '$REALM/product#Special' },
                select: 'title',
              },
            },
            filter: { in: { title: '$special' } },
          }),
        ),
        ['shop/s1'],
      );
    });

    test('_search: a bad shorthand is refused with invalid-type', async function (assert) {
      for (let type of ['Product', `${SHOP}product#`, 'product#Product']) {
        let response = await realmSearch({ type });
        assert.strictEqual(response.status, 400, `${type}: ${response.text}`);
        assert.strictEqual(
          response.body.errors?.[0]?.code,
          'invalid-type',
          type,
        );
      }
    });

    async function linkedBy(module: string, name: string, file: string) {
      let { data } = await searchCardsForTest(
        shop.realmIndexQueryEngine,
        { filter: { type: { module: rri(`${SHOP}${module}`), name } } },
        { loadLinks: true },
      );
      let card = data.find((r) => r.id === `${SHOP}${file}`) as any;
      return {
        indexed: Boolean(card),
        linked: (field: string) =>
          ((card?.relationships?.[field]?.data ?? []) as { id: string }[])
            .map((m) => String(m.id).replace(SHOP, 'shop/'))
            .sort(),
        errors: (field: string) =>
          card?.relationships?.[field]?.meta?.errors ?? [],
      };
    }

    test('a query-backed field’s $REALM is its card’s realm', async function (assert) {
      let shelf = await linkedBy('shelf', 'Shelf', 'shelf');
      assert.true(shelf.indexed, 'the shelf is indexed');
      assert.deepEqual(shelf.errors('wanted'), [], 'wanted: no errors');
      assert.deepEqual(
        shelf.linked('wanted'),
        ['shop/p1', 'shop/p2', 'shop/s1'],
        'a filter’s on in shorthand, with $this',
      );
      assert.deepEqual(
        shelf.linked('specials'),
        ['shop/s1'],
        'a filter’s type, as a realm-relative code ref',
      );
    });

    test('a query-backed field’s top-level type in shorthand', async function (assert) {
      let shelf = await linkedBy('narrow-shelf', 'NarrowShelf', 'narrow-shelf');
      assert.true(shelf.indexed, 'the shelf is indexed');
      assert.deepEqual(shelf.linked('narrowed'), ['shop/s1']);
    });

    test('_federated-search: $REALM over one realm is that realm', async function (assert) {
      assert.deepEqual(
        ids(
          await federated({
            type: '$REALM/product#Product',
            filter: { eq: { status: 'open' } },
            realms: [SHOP],
          }),
        ),
        ['shop/p1', 'shop/p2', 'shop/s1'],
      );
    });

    test('_federated-search: $REALM over several realms is refused', async function (assert) {
      let response = await federated({
        type: '$REALM/product#Product',
        realms: [SHOP, OTHER],
      });
      assert.strictEqual(response.status, 400, response.text);
      assert.strictEqual(response.body.errors?.[0]?.code, 'invalid-type');
      assert.true(
        String(response.body.errors?.[0]?.message).includes(
          'use an absolute or @scope/… module',
        ),
        response.body.errors?.[0]?.message,
      );
      assert.deepEqual(
        ids(
          await federated({
            type: `${SHOP}product#Product`,
            filter: { eq: { status: 'open' } },
            realms: [SHOP, OTHER],
          }),
        ),
        ['other/q1', 'shop/p1', 'shop/p2', 'shop/s1'],
        'an absolute shorthand searches both',
      );
    });

    test('a named query’s $REALM is the realm that declares it', async function (assert) {
      assert.deepEqual(
        ids(
          await realmSearch({
            operation: 'openHere',
            on: '$REALM/product#Product',
          }),
        ),
        ['shop/p1', 'shop/p2', 'shop/s1'],
        'on the realm’s _search, the request’s `on` in shorthand',
      );
      assert.deepEqual(
        ids(
          await federated({
            operation: 'openHere',
            on: `${SHOP}product#Product`,
            realms: [SHOP, OTHER],
          }),
        ),
        ['other/q1', 'shop/p1', 'shop/p2', 'shop/s1'],
        'across two realms, where the declaration names the shop’s module',
      );
    });

    // The declaration is checked where its module is evaluated, in the
    // prerenderer, by the host build's runtime-common (type-reference.ts).
    test('a named query declared with the shorthand', async function (assert) {
      assert.deepEqual(
        ids(
          await realmSearch({
            operation: 'openProducts',
            on: '$REALM/listing#Listing',
          }),
        ),
        ['shop/p1', 'shop/p2', 'shop/s1'],
      );
    });
  });
});
