import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  baseRRI,
  rri,
  searchEntryWireQueryFromQuery,
  SupportedMimeType,
  type Query,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
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
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { setupPolicyStoreDifferential } from './helpers/policy-store-differential.ts';

// ============================================================================
// What a caller the realm reaches only through its policy is answered, read
// through every part of a search: page rows, totals, facets (a value facet,
// the built-in `_type` facet, a range facet, a facet ignoring its own
// selection), collapse and a near sort, on the realm's own `_search` and on
// `_federated-search`.
//
// Two realms hold the same four notices, two public and two private, and the
// cards that hold their authorization: the config card, the policy card its
// key names, and a draft policy card no key names.
// - OPEN's policy grants a query over every card: to a visitor who isn't
//   signed in through one grant, to a signed-in user through another.
// - SHOWN's grants a query over public notices only, through a `where`.
//
// A scoped caller (a visitor, or a teacher with no permission on the realm) is
// answered exactly what the owner is answered for the same query narrowed to
// what the grants admit, and never a row, a count or a bucket of the cards
// that hold the realm's authorization. The owner reads the realm outright and
// sees all of it.
//
// The last module checks the column the policy's exclusion matches those
// cards on (card-identity-filter.ts) against the search document's `id` the
// exclusion matched them on before, for every row of both realms: instance
// rows, file rows (a card's stored `.json`, a module, a plain file) and a row
// whose card failed to index.
// ============================================================================

const SERVER = 'http://127.0.0.1:4444/';
const OPEN = `${SERVER}open/`;
const SHOWN = `${SERVER}shown/`;
const ONE = `${SERVER}one/`;
const BOTH = `${SERVER}both/`;
const EDITED = `${SERVER}edited/`;
const REVOKED = `${SERVER}revoked/`;
const READER = '@reader:localhost';
const ADMIN = '@admin:localhost';
const TEACHER = '@teacher:localhost';
const VISITOR = '192.0.2.10';

const CARD_DEF = { module: baseRRI('card-api'), name: 'CardDef' };
const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import VectorField from "@cardstack/base/vector";
  export class Taste extends VectorField {
    static dimensions = 3;
  }
  export class Notice extends CardDef {
    @field title = contains(StringField);
    @field channel = contains(StringField, { search: { facet: true } });
    @field visibility = contains(StringField, { search: { facet: true } });
    @field rank = contains(NumberField, { search: { facet: true } });
    @field slot = contains(StringField);
    @field taste = contains(Taste);
  }
`;

type N = {
  title: string;
  channel: string;
  visibility: string;
  rank: number;
  slot: string;
  taste: number[];
};

const NOTICES: Record<string, N> = {
  n1: {
    title: 'One',
    channel: 'talks',
    visibility: 'public',
    rank: 5,
    slot: 'a',
    taste: [1, 0, 0],
  },
  n2: {
    title: 'Two',
    channel: 'db',
    visibility: 'public',
    rank: 15,
    slot: 'a',
    taste: [0.9, 0.1, 0],
  },
  n3: {
    title: 'Three',
    channel: 'talks',
    visibility: 'private',
    rank: 25,
    slot: 'b',
    taste: [0, 1, 0],
  },
  n4: {
    title: 'Four',
    channel: 'db',
    visibility: 'private',
    rank: 35,
    slot: 'c',
    taste: [0, 0, 1],
  },
};

function notices(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(NOTICES).map(([id, attributes]) => [
      `notices/${id}.json`,
      JSON.stringify({
        data: {
          type: 'card',
          attributes,
          meta: { adoptsFrom: { module: '../notice', name: 'Notice' } },
        },
      }),
    ]),
  );
}

function policyCard(rules: unknown[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function realmFiles(realm: string, url: string, rules: unknown[]) {
  return {
    'realm.json': realmConfigCardJSON({
      name: realm,
      policy: `${url}policies/public`,
    }),
    'notice.gts': NOTICE_MODULE,
    ...notices(),
    'policies/public.json': policyCard(rules),
    'policies/draft.json': policyCard([]),
    // a card that fails to index, so the index holds an error row
    'broken.json': JSON.stringify({
      data: {
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: './missing', name: 'Missing' } },
      },
    }),
    'readme.txt': 'a plain file',
  };
}

const NOTICE = (realm: string) => ({
  module: `${realm}notice`,
  name: 'Notice',
});
const INFRASTRUCTURE = (realm: string) => [
  `${realm}policies/draft`,
  `${realm}policies/public`,
  `${realm}realm`,
];
const ALL_NOTICES = (realm: string) =>
  Object.keys(NOTICES).map((id) => `${realm}notices/${id}`);
const PUBLIC_NOTICES = (realm: string) =>
  Object.entries(NOTICES)
    .filter(([, n]) => n.visibility === 'public')
    .map(([id]) => `${realm}notices/${id}`);

module(basename(import.meta.filename), function (hooks) {
  setupPolicyStoreDifferential(hooks);
  let realms: Realm[] = [];
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;

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
    db = dbAdapter;
    let owner = { [ADMIN]: ['read', 'write', 'realm-owner'] } as any;
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(OPEN),
          fileSystem: realmFiles('Open', OPEN, [
            {
              targetType: CARD_DEF,
              grants: [
                { operation: 'query', where: 'actor() == "anonymous"' },
                { operation: 'query' },
              ],
            },
          ]),
          permissions: owner,
        },
        {
          realmURL: new URL(SHOWN),
          fileSystem: realmFiles('Shown', SHOWN, [
            {
              targetType: NOTICE(SHOWN),
              grants: [
                {
                  operation: 'query',
                  where: 'actor() == "anonymous" and .visibility == "public"',
                },
                { operation: 'query', where: '.visibility == "public"' },
              ],
            },
          ]),
          permissions: owner,
        },
        {
          realmURL: new URL(ONE),
          fileSystem: realmFiles('One', ONE, [
            {
              targetType: NOTICE(ONE),
              grants: [{ operation: 'query', where: '.channel == "talks"' }],
            },
          ]),
          permissions: owner,
        },
        {
          realmURL: new URL(BOTH),
          fileSystem: realmFiles('Both', BOTH, [
            {
              targetType: NOTICE(BOTH),
              grants: [
                {
                  operation: 'query',
                  where: 'actor() == "anonymous" and .visibility == "public"',
                },
                {
                  operation: 'query',
                  where: 'actor() == "anonymous" and .channel == "talks"',
                },
                { operation: 'query', where: '.visibility == "public"' },
                { operation: 'query', where: '.channel == "talks"' },
              ],
            },
          ]),
          permissions: owner,
        },
        {
          realmURL: new URL(EDITED),
          fileSystem: realmFiles('Edited', EDITED, [
            {
              targetType: NOTICE(EDITED),
              grants: [
                {
                  operation: 'query',
                  where: 'actor() == "anonymous" and .visibility == "public"',
                },
              ],
            },
          ]),
          permissions: owner,
        },
        {
          realmURL: new URL(REVOKED),
          // a policy that grants nothing, so a reader whose read is revoked
          // has no way in
          fileSystem: realmFiles('Revoked', REVOKED, []),
          permissions: { ...owner, [READER]: ['read'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    realms = result.realms;
  }

  // One server for the whole module, since every test only reads. Booting it
  // indexes both realms inside the first test's budget.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    after: async () => {
      for (let realm of realms) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  type Caller = 'visitor' | 'teacher' | 'admin';
  const SCOPED: Caller[] = ['visitor', 'teacher'];

  function realmOf(url: string) {
    return realms.find((r) => r.url === url)!;
  }

  function own(caller: Caller, realm: string, query: Query) {
    let req = request
      .post(`${new URL(realm).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR);
    if (caller !== 'visitor') {
      req = req.set(
        'Authorization',
        `Bearer ${createJWT(
          realmOf(realm),
          caller === 'admin' ? ADMIN : TEACHER,
          caller === 'admin' ? ['read', 'write', 'realm-owner'] : [],
        )}`,
      );
    }
    return req.send(searchEntryWireQueryFromQuery(query));
  }

  function federated(caller: Caller, realm: string, query: Query) {
    let req = request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR);
    if (caller !== 'visitor') {
      let user = caller === 'admin' ? ADMIN : TEACHER;
      req = req.set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user, sessionRoom: `session-room-${caller}` },
          realmSecretSeed,
        )}`,
      );
    }
    return req.send({
      ...searchEntryWireQueryFromQuery(query),
      realms: [realm],
    });
  }

  const ENDPOINTS = [
    ["the realm's own search", own],
    ['a federated search', federated],
  ] as const;

  // What a caller reads of an answer: rows in order, collapse sizes, the
  // total and the facets.
  async function answer(
    send: (caller: Caller, realm: string, query: Query) => Test,
    caller: Caller,
    realm: string,
    query: Query,
  ) {
    let response = await send(caller, realm, query);
    if (response.status !== 200) {
      throw new Error(
        `${caller} search answered ${response.status}: ${response.text}`,
      );
    }
    let body = response.body;
    return {
      rows: body.data.map((e: any) => e.id),
      collapse: body.data.map((e: any) => e.meta?._collapseSize ?? null),
      total: body.meta.page?.total,
      facets: body.meta.facets,
    };
  }

  const everyCard = (): Query =>
    ({
      filter: { type: CARD_DEF },
      facets: [{ by: '_type' }],
      page: { size: 50, total: 'exact' },
    }) as unknown as Query;

  // Every part of a search over the notices.
  const shapes = (realm: string): Record<string, Query> => ({
    'rows and total': {
      type: NOTICE(realm),
      filter: { type: NOTICE(realm) },
      sort: [{ by: 'title' }],
      page: { size: 50, total: 'exact' },
    } as unknown as Query,
    'value and range facets': {
      filter: { type: NOTICE(realm) },
      facets: [
        { by: 'channel' },
        {
          by: 'rank',
          ranges: [
            { key: 'low', from: 0, to: 10 },
            { key: 'mid', from: 10, to: 20 },
            { key: 'high', from: 20 },
          ],
        },
      ],
      page: { size: 50, total: 'exact' },
    } as unknown as Query,
    collapse: {
      type: NOTICE(realm),
      filter: { type: NOTICE(realm) },
      sort: [{ by: 'title' }],
      collapse: 'slot',
      page: { size: 50, total: 'exact' },
    } as unknown as Query,
    'near sort': {
      type: NOTICE(realm),
      filter: { type: NOTICE(realm) },
      sort: [{ by: 'taste', near: [1, 0, 0] }],
      page: { size: 50 },
    } as unknown as Query,
  });

  // `query` narrowed to what `admits` matches, as the owner asks it.
  function narrowed(query: Query, admits: object): Query {
    let filter = (query as any).filter;
    return {
      ...query,
      filter: { every: [filter, admits] },
    } as unknown as Query;
  }
  function publicOnly(query: Query, realm: string): Query {
    return narrowed(query, { on: NOTICE(realm), eq: { visibility: 'public' } });
  }

  const ids = (realm: string, names: string[]) =>
    names.map((name) => `${realm}notices/${name}`);

  // Each grant shape, for each scoped caller: the notices its grants admit,
  // and the filter that admits exactly those, as the owner asks it.
  const GRANT_SHAPES = [
    {
      label: 'one grant, with a where',
      realm: ONE,
      callers: {
        teacher: {
          ids: ids(ONE, ['n1', 'n3']),
          admits: { on: NOTICE(ONE), eq: { channel: 'talks' } },
        },
        // no grant names a caller who isn't signed in
        visitor: { ids: [], admits: undefined },
      },
    },
    {
      label: 'two grants, whose union admits more than either',
      realm: BOTH,
      callers: Object.fromEntries(
        SCOPED.map((caller) => [
          caller,
          {
            ids: ids(BOTH, ['n1', 'n2', 'n3']),
            admits: {
              any: [
                { on: NOTICE(BOTH), eq: { visibility: 'public' } },
                { on: NOTICE(BOTH), eq: { channel: 'talks' } },
              ],
            },
          },
        ]),
      ),
    },
  ] as const;

  for (let [label, send] of ENDPOINTS) {
    module(label, function () {
      module('a policy granting every card, through two grants', function () {
        for (let caller of SCOPED) {
          test(`the ${caller} finds every card but the ones holding the realm's authorization, in rows, total and the type facet`, async function (assert) {
            let got = await answer(send, caller, OPEN, everyCard());
            assert.deepEqual(
              [...got.rows].sort(),
              ALL_NOTICES(OPEN),
              'the four notices, and no config or policy card',
            );
            assert.strictEqual(got.total, 4, 'the total counts the notices');
            let types = (got.facets?._type ?? []).map((b: any) => b.label);
            assert.false(
              types.some((t: string) => /Realm ?Config|Realm ?Policy/.test(t)),
              `no bucket for the config or policy cards: ${types.join(', ')}`,
            );
            for (let [shape, query] of Object.entries(shapes(OPEN))) {
              let scoped = await answer(send, caller, OPEN, query);
              let owner = await answer(send, 'admin', OPEN, query);
              assert.deepEqual(
                scoped,
                owner,
                `${shape}: the notices are all granted, so as the owner`,
              );
            }
          });
        }

        test('the owner finds them all', async function (assert) {
          let got = await answer(send, 'admin', OPEN, everyCard());
          for (let id of [...INFRASTRUCTURE(OPEN), ...ALL_NOTICES(OPEN)]) {
            assert.true(got.rows.includes(id), `finds ${id}`);
          }
          let types = (got.facets?._type ?? []).map((b: any) => b.label);
          assert.true(
            types.some((t: string) => /Realm ?Policy/.test(t)),
            `the type facet counts the policy card: ${types.join(', ')}`,
          );
          assert.true(
            types.some((t: string) => /Realm ?Config/.test(t)),
            `the type facet counts the config card: ${types.join(', ')}`,
          );
        });
      });

      module('a policy granting public notices, through a where', function () {
        for (let caller of SCOPED) {
          test(`the ${caller} is answered as the owner asking for the public notices`, async function (assert) {
            for (let [shape, query] of Object.entries(shapes(SHOWN))) {
              let scoped = await answer(send, caller, SHOWN, query);
              let owner = await answer(
                send,
                'admin',
                SHOWN,
                publicOnly(query, SHOWN),
              );
              assert.deepEqual(scoped, owner, shape);
              for (let id of scoped.rows) {
                assert.true(
                  PUBLIC_NOTICES(SHOWN).includes(id),
                  `${shape}: ${id} is a public notice`,
                );
              }
            }
          });

          test(`the ${caller}'s facet that ignores its own selection still counts only what the grant admits`, async function (assert) {
            let got = await answer(send, caller, SHOWN, {
              filter: {
                on: NOTICE(SHOWN),
                eq: { visibility: 'private' },
              },
              facets: [{ by: 'visibility', own: 'ignore' }],
              page: { size: 50, total: 'exact' },
            } as unknown as Query);
            assert.deepEqual(got.rows, [], 'no private notice');
            assert.strictEqual(got.total, 0);
            assert.deepEqual(
              got.facets?.visibility?.map((b: any) => [b.value, b.count]),
              [['public', 2]],
              'the facet counts the public notices alone',
            );
          });

          test(`the ${caller} finds no card in a search over every card, which no grant opens`, async function (assert) {
            let got = await answer(send, caller, SHOWN, everyCard());
            assert.deepEqual(got.rows, [], 'no notice, config or policy card');
            assert.strictEqual(got.total, 0);
          });
        }

        test('the owner sees the private notices and the facet counts them', async function (assert) {
          let got = await answer(send, 'admin', SHOWN, {
            filter: {
              on: NOTICE(SHOWN),
              eq: { visibility: 'private' },
            },
            facets: [{ by: 'visibility', own: 'ignore' }],
            page: { size: 50, total: 'exact' },
          } as unknown as Query);
          assert.strictEqual(got.total, 2);
          assert.deepEqual(
            [...(got.facets?.visibility ?? [])]
              .map((b: any) => [b.value, b.count])
              .sort(),
            [
              ['private', 2],
              ['public', 2],
            ],
          );
        });
      });

      for (let shape of GRANT_SHAPES) {
        module(`a policy of ${shape.label}`, function () {
          for (let caller of SCOPED) {
            let want = (shape.callers as any)[caller] as {
              ids: string[];
              admits: object | undefined;
            };
            test(`the ${caller} sees exactly the notices its grants admit, in every part of the search`, async function (assert) {
              if (!want.admits) {
                // No grant admits this caller: told to authenticate, or
                // answered with no rows.
                for (let query of [
                  everyCard(),
                  ...Object.values(shapes(shape.realm)),
                ]) {
                  let response = await send(caller, shape.realm, query);
                  let refusedOrEmpty =
                    response.status === 401 ||
                    (response.status === 200 &&
                      response.body.data.length === 0);
                  assert.true(
                    refusedOrEmpty,
                    `${response.status}: ${response.text.slice(0, 200)}`,
                  );
                }
              } else {
                let page = await answer(send, caller, shape.realm, {
                  type: NOTICE(shape.realm),
                  filter: { type: NOTICE(shape.realm) },
                  page: { size: 50, total: 'exact' },
                } as unknown as Query);
                assert.deepEqual([...page.rows].sort(), want.ids, 'the rows');
                assert.strictEqual(page.total, want.ids.length, 'the total');
                let every = await answer(
                  send,
                  caller,
                  shape.realm,
                  everyCard(),
                );
                for (let id of INFRASTRUCTURE(shape.realm)) {
                  assert.false(every.rows.includes(id), `never ${id}`);
                }
                for (let [name, query] of Object.entries(shapes(shape.realm))) {
                  let scoped = await answer(send, caller, shape.realm, query);
                  let owner = await answer(
                    send,
                    'admin',
                    shape.realm,
                    narrowed(query, want.admits),
                  );
                  assert.deepEqual(scoped, owner, name);
                  for (let id of scoped.rows) {
                    assert.true(
                      want.ids.includes(id),
                      `${name}: ${id} is granted`,
                    );
                  }
                }
              }
            });
          }
        });
      }
    });
  }

  test('a policy edit takes effect on the very next search', async function (assert) {
    let notices = {
      type: NOTICE(EDITED),
      filter: { type: NOTICE(EDITED) },
      page: { size: 50, total: 'exact' },
    } as unknown as Query;
    let before = await answer(own, 'visitor', EDITED, notices);
    assert.deepEqual(
      [...before.rows].sort(),
      ids(EDITED, ['n1', 'n2']),
      'the public notices, as the policy grants',
    );
    await realmOf(EDITED).write(
      'policies/public.json',
      policyCard([
        {
          targetType: NOTICE(EDITED),
          grants: [
            {
              operation: 'query',
              where: 'actor() == "anonymous" and .channel == "talks"',
            },
          ],
        },
      ]),
    );
    let after = await answer(own, 'visitor', EDITED, notices);
    assert.deepEqual(
      [...after.rows].sort(),
      ids(EDITED, ['n1', 'n3']),
      'the talks the edited policy grants, on the first search after the edit',
    );
    let federatedAfter = await answer(federated, 'visitor', EDITED, notices);
    assert.deepEqual(
      [...federatedAfter.rows].sort(),
      ids(EDITED, ['n1', 'n3']),
    );
  });

  test('a revoked read refuses the very next search', async function (assert) {
    let path = new URL(REVOKED).pathname;
    let search = () =>
      request
        .post(`${path}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set(
          'Authorization',
          `Bearer ${createJWT(realmOf(REVOKED), READER, ['read'])}`,
        )
        .send(
          searchEntryWireQueryFromQuery({
            type: NOTICE(REVOKED),
            filter: { type: NOTICE(REVOKED) },
            page: { size: 50, total: 'exact' },
          } as unknown as Query),
        );
    let before = await search();
    assert.strictEqual(before.status, 200, before.text);
    assert.deepEqual(
      before.body.data.map((e: any) => e.id).sort(),
      ALL_NOTICES(REVOKED),
      'the reader reads every notice',
    );
    let revoke = await request
      .patch(`${path}_permissions`)
      .set('Accept', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createJWT(realmOf(REVOKED), ADMIN, [
          'read',
          'write',
          'realm-owner',
        ])}`,
      )
      .send({
        data: {
          id: REVOKED,
          type: 'permissions',
          attributes: { permissions: { [READER]: [] } },
        },
      });
    assert.strictEqual(revoke.status, 200, revoke.text);
    let after = await search();
    let readsNothing =
      after.status === 401 ||
      after.status === 403 ||
      (after.status === 200 && after.body.data.length === 0);
    assert.true(
      readsNothing,
      `the first search after the revoke reads nothing: ${after.status} ${after.text.slice(0, 200)}`,
    );
  });

  test('a request cannot spell the card-identity filter', async function (assert) {
    let response = await request
      .post(`${new URL(OPEN).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR)
      .send({ filter: { cardIdentity: { ids: [`${OPEN}realm`] } } });
    assert.strictEqual(response.status, 400, response.text);
  });

  module("the cards' identity on the index row", function () {
    test('names every row the search document id named, and only the card’s own stored file besides', async function (assert) {
      for (let realm of [OPEN, SHOWN]) {
        let rows = (await db.execute(
          `SELECT url, type, search_doc ->> 'id' AS id, search_doc IS NULL AS docless, has_error
             FROM boxel_index WHERE realm_url = $1`,
          { bind: [realm] },
        )) as {
          url: string;
          type: string;
          id: string | null;
          docless: boolean;
          has_error: boolean;
        }[];
        assert.true(
          rows.some((r) => r.has_error && r.type === 'instance'),
          `${realm} holds an error row`,
        );
        assert.true(
          rows.some((r) => r.type === 'file' && r.url.endsWith('.gts')),
          `${realm} holds a module row`,
        );
        assert.true(
          rows.some((r) => r.type === 'file' && r.url.endsWith('.txt')),
          `${realm} holds a plain file row`,
        );
        let cardIds = rows
          .filter((r) => r.type === 'instance' && r.id)
          .map((r) => r.id!);
        for (let x of cardIds) {
          let byDoc = rows.filter((r) => r.id === x);
          let byColumn = rows.filter(
            (r) => r.url === x || r.url === `${x}.json`,
          );
          for (let row of byDoc) {
            assert.true(
              byColumn.includes(row),
              `${x}: the ${row.type} row ${row.url} the id named, the column names`,
            );
          }
          let extra = byColumn.filter((r) => !byDoc.includes(r));
          assert.deepEqual(
            extra.map((r) => [r.type, r.url]),
            [['file', `${x}.json`]],
            `${x}: besides, only the card's own stored .json`,
          );
        }
        // A row with no search document has no id: the id test read it as
        // unknown, which a `not` leaves out, and the column test names it.
        for (let row of rows.filter((r) => r.docless)) {
          assert.strictEqual(row.id, null, `${row.url} has no id`);
        }
      }
    });
  });
});
