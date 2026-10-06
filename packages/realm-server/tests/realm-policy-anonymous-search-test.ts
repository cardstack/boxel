import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
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
import {
  setAnonymousRequestSink,
  type AnonymousRequestEvent,
} from '@cardstack/runtime-common/card-operations/telemetry';
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

// Two realms nobody may read without signing in, governed by policy cards in
// an Org realm. The Newsroom's policy opens searches over its published
// articles to callers who aren't signed in. The Gazette's opens the same. The
// Library's policy opens nothing to such callers.
const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
const GAZETTE = 'http://127.0.0.1:4444/gazette/';
const LIBRARY = 'http://127.0.0.1:4444/library/';
const ORG = 'http://127.0.0.1:4444/org/';
const NEWSROOM_POLICY = `${ORG}policies/newsroom`;
const GAZETTE_POLICY = `${ORG}policies/gazette`;
const LIBRARY_POLICY = `${ORG}policies/library`;
const EDITOR = '@editor:localhost';
const ORG_ADMIN = '@org-admin:localhost';

// Callers' addresses come from the ranges reserved for documentation.
const VISITOR = '192.0.2.10';
const BLOCKED_VISITOR = '198.51.100.7';
const OUR_SERVICES = '203.0.113.5';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const ARTICLE_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Article extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field authorIds = containsMany(StringField);
  }
`;

function articleType(realm: string) {
  return { module: `${realm}article`, name: 'Article' };
}

function article(headline: string, status: string, authorIds: string[] = []) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { headline, status, authorIds },
      meta: { adoptsFrom: { module: '../article', name: 'Article' } },
    },
  });
}

// The grants every governed realm's policy carries for signed-in callers,
// plus, where `anonymous`, the ones that open searches to callers who aren't
// signed in: the published articles, and a grant that reads the caller, which
// never admits one.
function policyCard(realm: string, anonymous: boolean) {
  let targetType = articleType(realm);
  let grants: Record<string, unknown>[] = [
    { operation: 'query', where: '.status == "published"' },
  ];
  if (anonymous) {
    grants.push(
      {
        operation: 'query',
        anonymous: true,
        where: '.status == "published"',
      },
      {
        operation: 'query',
        anonymous: true,
        where: '.authorIds | any(. == actor())',
      },
    );
  }
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules: [{ targetType, grants }] },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function governedRealm(url: string, name: string, policy: string) {
  return {
    realmURL: new URL(url),
    fileSystem: {
      'realm.json': realmConfigCardJSON({ name, policy }),
      'article.gts': ARTICLE_MODULE,
      'articles/published.json': article(`${name} published`, 'published'),
      'articles/draft.json': article(`${name} draft`, 'draft', [EDITOR]),
    },
    // The org admin reads the realms the org's policies govern, which is
    // what lets them ask a policy what it decides there.
    permissions: {
      [EDITOR]: ['read', 'write', 'realm-owner'],
      [ORG_ADMIN]: ['read'],
    } satisfies RealmPermissions as RealmPermissions,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let gazette: Realm;
  let library: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let records: AnonymousRequestEvent[];

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
        governedRealm(NEWSROOM, 'Newsroom', NEWSROOM_POLICY),
        governedRealm(GAZETTE, 'Gazette', GAZETTE_POLICY),
        governedRealm(LIBRARY, 'Library', LIBRARY_POLICY),
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/newsroom.json': policyCard(NEWSROOM, true),
            'policies/gazette.json': policyCard(GAZETTE, true),
            'policies/library.json': policyCard(LIBRARY, false),
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
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
    newsroom = realm(NEWSROOM);
    gazette = realm(GAZETTE);
    library = realm(LIBRARY);
    org = realm(ORG);
  }

  async function stop() {
    for (let realm of [newsroom, gazette, library, org]) {
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
      records = [];
      setAnonymousRequestSink((record) => records.push(record));
    },
    afterEach: async () => {
      setAnonymousRequestSink(undefined);
      await stop();
    },
  });

  function articles(realm: string) {
    return { filter: { 'item.on': articleType(realm) } };
  }

  // A search of one realm's own `_search`, from `from`.
  function realmSearch(realm: string, from: string = VISITOR) {
    return request
      .post(`${new URL(realm).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', from)
      .send(articles(realm));
  }

  // A search across `realms` on the realm server, of each one's articles.
  function federatedSearch(realms: string[], from: string = VISITOR) {
    return request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', from)
      .send({
        filter: {
          any: realms.map((realm) => ({ 'item.on': articleType(realm) })),
        },
        realms,
      });
  }

  function ids(response: Response): string[] {
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return (response.body as { data: { id: string }[] }).data
      .map(({ id }) => id)
      .sort();
  }

  async function setLimit(realm: Realm, requests: number) {
    let name = realm === newsroom ? 'Newsroom' : 'Gazette';
    let policy = realm === newsroom ? NEWSROOM_POLICY : GAZETTE_POLICY;
    await realm.write(
      'realm.json',
      realmConfigCardJSON({
        name,
        policy,
        anonymousRateLimit: { requests, windowSeconds: 600 },
      }),
    );
    await realm.indexing();
  }

  function unauthenticated(response: Response, label: string, assert: Assert) {
    assert.strictEqual(response.status, 401, `${label}: 401`);
  }

  test("a realm's own search answers a caller who is not signed in with the rows its anonymous grants admit", async function (assert) {
    let response = await realmSearch(NEWSROOM);
    assert.deepEqual(
      ids(response),
      [`${NEWSROOM}articles/published`],
      'the published article, and not the draft its author is named on',
    );
    let [record] = records.filter((r) => r.route.endsWith('/_search'));
    assert.strictEqual(record?.outcome, 'admitted', 'counted');
    assert.strictEqual(record?.operation, 'query');
    assert.strictEqual(record?.clientIP, VISITOR);
  });

  test('a realm whose policy opens no search to such callers tells them to authenticate', async function (assert) {
    unauthenticated(await realmSearch(LIBRARY), 'library', assert);
  });

  test("a realm's own search is counted against the address, and refused once it is spent", async function (assert) {
    await setLimit(newsroom, 1);
    assert.strictEqual((await realmSearch(NEWSROOM)).status, 200);
    let over = await realmSearch(NEWSROOM);
    assert.strictEqual(over.status, 429, 'the second search is refused');
    assert.strictEqual(over.body.errors[0].code, 'rate-limited');
  });

  test('a blocked address is told to authenticate', async function (assert) {
    await newsroom.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Newsroom',
        policy: NEWSROOM_POLICY,
        anonymousBlocklist: [`${BLOCKED_VISITOR}/32`],
      }),
    );
    await newsroom.indexing();
    unauthenticated(
      await realmSearch(NEWSROOM, BLOCKED_VISITOR),
      'a blocked address',
      assert,
    );
    unauthenticated(
      await federatedSearch([NEWSROOM], BLOCKED_VISITOR),
      'a blocked address, across realms',
      assert,
    );
  });

  test('a search across realms answers such a caller with what each realm admits, and nothing from one that admits nothing', async function (assert) {
    let response = await federatedSearch([NEWSROOM, GAZETTE, LIBRARY]);
    assert.deepEqual(ids(response), [
      `${GAZETTE}articles/published`,
      `${NEWSROOM}articles/published`,
    ]);
    assert.notOk(response.body.meta?.incomplete, 'nothing failed');
    let counted = records
      .filter((r) => r.route.endsWith('/_federated-search'))
      .map((r) => [r.realmURL, r.outcome])
      .sort();
    assert.deepEqual(
      counted,
      [
        [GAZETTE, 'admitted'],
        [NEWSROOM, 'admitted'],
      ],
      'each realm that answered counted it, against its own budget',
    );
  });

  test('a search across realms none of which admits such a caller tells them to authenticate', async function (assert) {
    unauthenticated(await federatedSearch([LIBRARY]), 'library', assert);
  });

  test('a realm whose budget is spent is left out of a search across realms, which says it is incomplete', async function (assert) {
    await setLimit(newsroom, 1);
    assert.strictEqual((await realmSearch(NEWSROOM)).status, 200);
    let response = await federatedSearch([NEWSROOM, GAZETTE]);
    assert.deepEqual(
      ids(response),
      [`${GAZETTE}articles/published`],
      'the other realm still answers',
    );
    assert.true(response.body.meta?.incomplete, 'marked incomplete');
    let only = await federatedSearch([NEWSROOM]);
    assert.deepEqual(ids(only), [], 'alone, it answers no rows');
    assert.true(only.body.meta?.incomplete);
  });

  test('a named query is never opened to such a caller across realms', async function (assert) {
    let response = await request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR)
      .send({
        operation: 'listMine',
        on: articleType(NEWSROOM),
        realms: [NEWSROOM],
      });
    unauthenticated(response, 'a named query', assert);
  });

  test('a capability check answers such a caller about a search as the search would', async function (assert) {
    let ask = (realm: string) =>
      request
        .post(`${new URL(realm).pathname}_capabilities`)
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('X-Forwarded-For', VISITOR)
        .send({
          checks: [{ target: articleType(realm), operation: 'query' }],
        });
    let response = await ask(NEWSROOM);
    assert.strictEqual(response.status, 200, response.text);
    assert.true(response.body.checks[0].allowed, 'the newsroom opens it');
  });

  test('explain judges such a caller’s search by the grants that opt in to them', async function (assert) {
    let explain = async (policy: string, realm: string) => {
      let response = await request
        .post(`${new URL(ORG).pathname}_operations`)
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set(
          'Authorization',
          `Bearer ${createJWT(org, ORG_ADMIN, ['read', 'write', 'realm-owner'])}`,
        )
        .send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'explain',
                href: policy,
                data: {
                  actor: '',
                  target: realm,
                  operation: 'query',
                  search: { filter: { 'item.on': articleType(realm) } },
                },
              },
            ],
          }),
        );
      if (response.status !== 200) {
        throw new Error(
          `explain answered ${response.status}: ${response.text}`,
        );
      }
      return response.body['atomic:results'][0];
    };
    let newsroomAnswer = await explain(NEWSROOM_POLICY, NEWSROOM);
    assert.strictEqual(newsroomAnswer.reason, 'granted', 'the newsroom');
    let libraryAnswer = await explain(LIBRARY_POLICY, LIBRARY);
    assert.strictEqual(
      libraryAnswer.reason,
      'actor-required',
      'a policy that opens nothing tells such a caller to authenticate',
    );
  });
});
