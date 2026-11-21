import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  parseAddressRanges,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import {
  comparePolicyStorePaths,
  type PolicyStoreObservation,
} from './helpers/policy-store-differential.ts';

// Real policies, compiled by the realm: which grants the value-store paths
// carry, and that every search answers as the general read does
// (value-store-policy-grant-test.ts holds the engine's side).
//
// A grant whose `where` depends only on the caller is settled for the
// caller before it is compiled (`settleActor`), so it compiles to its type
// alone and a store path carries it. A `where` that reads a card field
// compiles to a field comparison, and the search keeps the general read.
// Every search below runs twice, once told to read its grants the general
// way, and the two answers must be identical; each test says whether a store
// path carried the grant.

const SHOP = 'http://127.0.0.1:4444/shop/';
const WIDE = 'http://127.0.0.1:4444/wide/';
const OPEN = 'http://127.0.0.1:4444/open/';
const SHOP_POLICY = `${SHOP}policies/public`;
const WIDE_POLICY = `${WIDE}policies/wide`;
const OWNER = '@owner:localhost';
// Signed in, holding no permission on the Shop: every row they are served
// there is one a grant admits.
const MEMBER = '@member:localhost';
const OTHER_MEMBER = '@other-member:localhost';
const VISITOR = '192.0.2.10';
const OUR_SERVICES = '203.0.113.5';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const MODULE = `
  import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  export class Brand extends CardDef {
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Brand) {
        return this.name;
      },
    });
  }
  export class Product extends CardDef {
    @field name = contains(StringField);
    @field productType = contains(StringField, { search: { facet: true } });
    @field color = contains(StringField, { search: { facet: true } });
    @field status = contains(StringField, { search: { facet: true } });
    @field ownerId = contains(StringField);
    @field rating = contains(NumberField, { search: { facet: true } });
    @field brand = linksTo(() => Brand, {
      searchable: true,
      search: { facet: true },
    });
  }
  export class Gadget extends Product {}
  export class Variant extends CardDef {
    @field name = contains(StringField);
    @field productType = contains(StringField, { search: { facet: true } });
    @field color = contains(StringField, { search: { facet: true } });
    @field status = contains(StringField, { search: { facet: true } });
    @field rating = contains(NumberField, { search: { facet: true } });
    @field brand = linksTo(() => Brand, {
      searchable: true,
      search: { facet: true },
    });
  }
  export class Ticket extends CardDef {
    @field name = contains(StringField);
    @field productType = contains(StringField, { search: { facet: true } });
    @field status = contains(StringField, { search: { facet: true } });
    @field ownerId = contains(StringField);
  }
  export class Notice extends CardDef {
    @field name = contains(StringField);
    @field productType = contains(StringField, { search: { facet: true } });
    @field status = contains(StringField, { search: { facet: true } });
    @field ownerId = contains(StringField);
  }
  export class Post extends CardDef {
    @field name = contains(StringField);
    @field productType = contains(StringField, { search: { facet: true } });
    @field status = contains(StringField, { search: { facet: true } });
    @field ownerId = contains(StringField);
  }
`;

const type = (realm: string, name: string) => ({
  module: `${realm}shop`,
  name,
});
const Product = type(SHOP, 'Product');
const Variant = type(SHOP, 'Variant');
const Brand = type(SHOP, 'Brand');

function card(
  name: string,
  attributes: Record<string, unknown>,
  links: Record<string, unknown> = {},
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      relationships: links,
      meta: { adoptsFrom: { module: '../shop', name } },
    },
  });
}
const brandLink = (n: number) => ({
  brand: { links: { self: `../brands/b${n}` } },
});

// The Shop's policy. Product opens its search to callers who aren't signed
// in through a grant that names them, and to signed-in callers through one
// with no `where`, as a hosted test environment's policy does. Brand opens it to signed-in
// callers only, by a test of the caller alone. Ticket, Notice and Post test
// a card field, alone, beside a test of the caller, and as an alternative to
// one. Variant opens no search.
function shopPolicy() {
  let rule = (name: string, grants: Record<string, unknown>[]) => ({
    targetType: type(SHOP, name),
    grants,
  });
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          rule('Product', [
            { operation: 'query', where: 'actor() == "anonymous"' },
            { operation: 'query' },
          ]),
          rule('Brand', [
            { operation: 'query', where: 'actor() != "anonymous"' },
          ]),
          rule('Ticket', [{ operation: 'query', where: '.status == "open"' }]),
          rule('Notice', [
            {
              operation: 'query',
              where: 'actor() == "anonymous" and .status == "open"',
            },
          ]),
          rule('Post', [
            {
              operation: 'query',
              where: 'actor() == "anonymous" or .ownerId == actor()',
            },
          ]),
          rule('Variant', [{ operation: 'read' }]),
        ],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// The Wide realm's policy opens the search of every card to signed-in
// callers.
function widePolicy() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [{ targetType: CARD_DEF, grants: [{ operation: 'query' }] }],
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function shopFiles(realm: string, policy: string, policyFile: string) {
  let files: Record<string, string> = {
    'realm.json': realmConfigCardJSON({ name: 'Shop', policy }),
    'shop.gts': MODULE,
    [policyFile]: realm === SHOP ? shopPolicy() : widePolicy(),
    // A policy card no key names.
    'policies/draft.json': shopPolicy(),
  };
  for (let n = 0; n < 3; n++) {
    files[`brands/b${n}.json`] = card('Brand', { name: `Brand ${n}` });
  }
  for (let i = 0; i < 8; i++) {
    files[`products/p${i}.json`] = card(
      'Product',
      {
        name: `p${i}`,
        productType: ['SHOES', 'LAMP'][i % 2],
        color: ['red', 'blue', 'black'][i % 3],
        status: i % 3 === 0 ? 'draft' : 'published',
        ownerId: i % 2 ? MEMBER : OTHER_MEMBER,
        rating: [3.5, 4, 4.5, 5][i % 4],
      },
      brandLink(i % 3),
    );
  }
  for (let i = 0; i < 3; i++) {
    files[`gadgets/g${i}.json`] = card(
      'Gadget',
      {
        name: `g${i}`,
        productType: 'GADGET',
        color: 'red',
        status: 'published',
        rating: 4,
      },
      brandLink(1),
    );
  }
  for (let i = 0; i < 4; i++) {
    files[`variants/v${i}.json`] = card(
      'Variant',
      {
        name: `v${i}`,
        productType: 'VARIANT-ONLY',
        color: 'variant-color',
        status: 'published',
        rating: 1,
      },
      brandLink(2),
    );
  }
  for (let name of ['Ticket', 'Notice', 'Post']) {
    for (let i = 0; i < 4; i++) {
      files[`${name.toLowerCase()}s/${name.toLowerCase()}${i}.json`] = card(
        name,
        {
          name: `${name} ${i}`,
          productType: name.toUpperCase(),
          status: i % 2 ? 'open' : 'closed',
          ownerId: i < 2 ? MEMBER : OTHER_MEMBER,
        },
      );
    }
  }
  return files;
}

module(basename(import.meta.filename), function (hooks) {
  let shop: Realm;
  let wide: Realm;
  let open: Realm;
  let request: SuperTest<Test>;
  let server: Server;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      clientAddress: {
        trustedProxyHops: 1,
        infraAddresses: parseAddressRanges([OUR_SERVICES]).ranges,
      },
      realms: [
        {
          realmURL: new URL(SHOP),
          fileSystem: shopFiles(SHOP, SHOP_POLICY, 'policies/public.json'),
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
          } satisfies RealmPermissions as RealmPermissions,
        },
        {
          realmURL: new URL(WIDE),
          fileSystem: shopFiles(WIDE, WIDE_POLICY, 'policies/wide.json'),
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
          } satisfies RealmPermissions as RealmPermissions,
        },
        {
          realmURL: new URL(OPEN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Open' }),
            'shop.gts': MODULE,
            'products/o0.json': card('Product', {
              name: 'o0',
              productType: 'SHOES',
              status: 'published',
            }),
          },
          permissions: { '*': ['read'], [OWNER]: ['read', 'write'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    let realm = (url: string) =>
      result.realms.find((candidate) => candidate.url === url)!;
    shop = realm(SHOP);
    wide = realm(WIDE);
    open = realm(OPEN);
  }

  async function stop() {
    for (let realm of [shop, wide, open]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      await stop();
    },
  });

  // A search, compared on both reads. `caller` undefined is a caller who
  // isn't signed in.
  async function search(
    body: Record<string, unknown>,
    { caller, realm = SHOP }: { caller?: string; realm?: string } = {},
  ): Promise<{
    status: number;
    body: any;
    ids: string[];
    observation: PolicyStoreObservation;
  }> {
    let compared = comparePolicyStorePaths();
    let response;
    try {
      let r = request
        .post(
          realm === 'federated'
            ? '/_federated-search'
            : `${new URL(realm).pathname}_search`,
        )
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('X-Forwarded-For', VISITOR);
      if (caller) {
        let token = createJWT(realm === WIDE ? wide : shop, caller, []);
        r = r.set('Authorization', `Bearer ${token}`);
      }
      response = await r.send(body);
    } finally {
      compared.restore();
    }
    let { observation } = compared;
    return {
      status: response.status,
      body: response.body,
      ids: ((response.body?.data ?? []) as { id: string }[])
        .map((d) => d.id)
        .sort(),
      observation,
    };
  }

  function answered(
    found: Awaited<ReturnType<typeof search>>,
    assert: Assert,
    { carried }: { carried: boolean },
  ) {
    assert.strictEqual(
      found.status,
      200,
      `200: ${JSON.stringify(found.body).slice(0, 400)}`,
    );
    assert.deepEqual(
      found.observation.mismatches,
      [],
      'the general read’s answer',
    );
    assert.true(found.observation.compared > 0, 'a policy-scoped search ran');
    assert.strictEqual(
      found.observation.carried > 0,
      carried,
      carried
        ? 'a store path carried the grant'
        : 'no store path carried the grant',
    );
  }

  const productIds = [
    ...Array.from({ length: 8 }, (_, i) => `${SHOP}products/p${i}`),
    ...Array.from({ length: 3 }, (_, i) => `${SHOP}gadgets/g${i}`),
  ].sort();
  const counted = {
    filter: { 'item.on': Product },
    facets: [
      { by: 'item.productType' },
      { by: 'item.color', own: 'ignore' },
      { by: 'item.brand' },
      { by: 'item.rating', stats: true },
    ],
    page: { size: 0 },
  };

  test('a grant that names a caller who is not signed in, and no card field: carried for that caller', async function (assert) {
    let found = await search(counted);
    answered(found, assert, { carried: true });
    assert.strictEqual(found.body.meta.page.total, productIds.length);
    let text = JSON.stringify(found.body);
    assert.false(text.includes('VARIANT-ONLY'), 'no variant is counted');
    assert.deepEqual(
      (found.body.meta.facets.brand ?? []).map((b: any) => b.label ?? null),
      [null, null, null],
      'no Brand grant opens to such a caller: no brand title',
    );
    let paged = await search({
      filter: { 'item.on': Product },
      sort: [{ by: 'item.name' }],
      page: { size: 4 },
    });
    answered(paged, assert, { carried: true });
    assert.strictEqual(paged.body.meta.page.total, productIds.length);
    for (let id of paged.ids) {
      assert.true(productIds.includes(id), `${id} is a product`);
    }
  });

  test('a grant with no `where`, for a signed-in caller: carried, and a Brand grant that tests only the caller labels the brands', async function (assert) {
    let found = await search(counted, { caller: MEMBER });
    answered(found, assert, { carried: true });
    assert.strictEqual(found.body.meta.page.total, productIds.length);
    assert.deepEqual(
      (found.body.meta.facets.brand ?? []).map((b: any) => b.label).sort(),
      ['Brand 0', 'Brand 1', 'Brand 2'],
      'titles from the Brand grant',
    );
    let brands = await search(
      { filter: { 'item.on': Brand }, page: { size: 10 } },
      { caller: MEMBER },
    );
    answered(brands, assert, { carried: true });
    assert.strictEqual(brands.body.meta.page.total, 3);
  });

  test('a page with its links loaded serves the same rows and closure on both reads', async function (assert) {
    for (let caller of [undefined, MEMBER]) {
      let found = await search(
        {
          filter: { 'item.on': Product, eq: { 'item.productType': 'SHOES' } },
          sort: [{ by: 'item.name' }],
          page: { size: 10 },
        },
        { caller },
      );
      assert.strictEqual(found.status, 200);
      assert.deepEqual(found.observation.mismatches, []);
      for (let id of found.ids) {
        assert.true(productIds.includes(id), `${id} is a product`);
      }
      let included = (found.body.included ?? []).map((r: any) => r.id);
      for (let id of included) {
        assert.false(String(id).includes('/variants/'), `${id} is no variant`);
      }
    }
  });

  test('a grant whose `where` reads a card field: the general read, and only the cards it admits', async function (assert) {
    let tickets = await search(
      {
        filter: { 'item.on': type(SHOP, 'Ticket') },
        facets: [{ by: 'item.status' }],
        page: { size: 10 },
      },
      { caller: MEMBER },
    );
    answered(tickets, assert, { carried: false });
    assert.deepEqual(tickets.body.meta.facets.status, [
      { value: 'open', count: 2 },
    ]);
  });

  test('a test of the caller beside a card field (`and`): the general read', async function (assert) {
    let notices = await search({
      filter: { 'item.on': type(SHOP, 'Notice') },
      facets: [{ by: 'item.status' }],
      page: { size: 10 },
    });
    answered(notices, assert, { carried: false });
    assert.deepEqual(notices.body.meta.facets.status, [
      { value: 'open', count: 2 },
    ]);
  });

  test('a test of the caller or a card field (`or`): carried for the caller it settles to true for, the general read for the other', async function (assert) {
    let body = {
      filter: { 'item.on': type(SHOP, 'Post') },
      facets: [{ by: 'item.status' }],
      page: { size: 0 },
    };
    let anonymous = await search(body);
    answered(anonymous, assert, { carried: true });
    assert.strictEqual(anonymous.body.meta.page.total, 4, 'every post');
    let member = await search(body, { caller: MEMBER });
    answered(member, assert, { carried: false });
    assert.strictEqual(member.body.meta.page.total, 2, "the member's posts");
  });

  test('a type no grant opens: nothing, whichever read', async function (assert) {
    for (let caller of [undefined, MEMBER]) {
      let found = await search(
        {
          filter: { 'item.on': Variant },
          facets: [{ by: 'item.productType' }],
          page: { size: 10 },
        },
        { caller },
      );
      assert.deepEqual(found.observation.mismatches, []);
      assert.deepEqual(found.ids, []);
      assert.false(JSON.stringify(found.body).includes('VARIANT-ONLY'));
    }
    let brands = await search({
      filter: { 'item.on': Brand },
      page: { size: 10 },
    });
    assert.deepEqual(brands.observation.mismatches, []);
    assert.deepEqual(brands.ids, [], 'no Brand grant opens to such a caller');
  });

  test('several types: each granted type, and no other', async function (assert) {
    let found = await search({
      filter: {
        any: [
          { 'item.on': Product },
          { 'item.on': Variant },
          { 'item.on': type(SHOP, 'Post') },
        ],
      },
      page: { size: 50 },
    });
    assert.strictEqual(found.status, 200);
    assert.deepEqual(found.observation.mismatches, []);
    let posts = Array.from({ length: 4 }, (_, i) => `${SHOP}posts/post${i}`);
    assert.deepEqual(found.ids, [...productIds, ...posts].sort());
  });

  test('a grant on CardDef: the realm card and policy cards are never served, on either read', async function (assert) {
    for (let page of [{ size: 0 }, { size: 100 }]) {
      let found = await search(
        { filter: { 'item.on': CARD_DEF }, page },
        { caller: MEMBER, realm: WIDE },
      );
      assert.strictEqual(
        found.status,
        200,
        JSON.stringify(found.body).slice(0, 300),
      );
      assert.deepEqual(found.observation.mismatches, []);
      for (let id of [`${WIDE}realm`, WIDE_POLICY, `${WIDE}policies/draft`]) {
        assert.false(found.ids.includes(id), `${id} is not served`);
      }
      let cards = Object.keys(
        shopFiles(WIDE, WIDE_POLICY, 'policies/wide.json'),
      ).filter(
        (f) =>
          f.endsWith('.json') &&
          f !== 'realm.json' &&
          !f.startsWith('policies/'),
      ).length;
      assert.strictEqual(found.body.meta.page.total, cards, 'every other card');
    }
  });

  test('a search across a realm a policy scopes and one read outright: never carried, the general read', async function (assert) {
    for (let results of ['merged', undefined]) {
      let found = await search(
        {
          filter: {
            any: [{ 'item.on': Product }, { 'item.on': type(OPEN, 'Product') }],
          },
          page: { size: 50 },
          realms: [SHOP, OPEN],
          ...(results ? { federation: { results } } : {}),
        },
        { realm: 'federated' },
      );
      assert.strictEqual(
        found.status,
        200,
        JSON.stringify(found.body).slice(0, 300),
      );
      assert.deepEqual(found.observation.mismatches, []);
      if (results === 'merged') {
        assert.strictEqual(found.observation.carried, 0, 'merged: not carried');
      }
      assert.deepEqual(found.ids, [...productIds, `${OPEN}products/o0`].sort());
    }
  });
});
