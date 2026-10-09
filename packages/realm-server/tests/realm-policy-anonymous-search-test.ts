import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  archiveRealm,
  MAX_REALMS_PER_SEARCH_REQUEST,
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
  clearOfRateLimitWindowEdge,
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

// Realms nobody may read without signing in, governed by policy cards in an
// Org realm. The Newsroom's policy opens searches over its published articles
// to callers who aren't signed in. The Gazette's opens the same. The Library's
// policy opens searches to signed-in callers only, through grants whose
// `where` never names such callers. The Forum's policy holds one rule per
// type, each opening that type's search to them in a different way.
const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
const GAZETTE = 'http://127.0.0.1:4444/gazette/';
const LIBRARY = 'http://127.0.0.1:4444/library/';
const FORUM = 'http://127.0.0.1:4444/forum/';
// A realm anyone may read, which a search reads outright.
const WIRE = 'http://127.0.0.1:4444/wire/';
const ORG = 'http://127.0.0.1:4444/org/';
const NEWSROOM_POLICY = `${ORG}policies/newsroom`;
const GAZETTE_POLICY = `${ORG}policies/gazette`;
const LIBRARY_POLICY = `${ORG}policies/library`;
const FORUM_POLICY = `${ORG}policies/forum`;
const EDITOR = '@editor:localhost';
const ORG_ADMIN = '@org-admin:localhost';
// Signed in, and holding no permission on the Forum, so every row they are
// served there is one a grant admits.
const MEMBER = '@member:localhost';
const OTHER_MEMBER = '@other-member:localhost';

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
// plus, where `anonymous`, the one that opens searches over the published
// articles to callers who aren't signed in. That grant refuses the addresses
// the governed realm's `blockedAddresses` setting names, and counts each
// address against the `searchRequests` setting in a ten-minute window. A
// grant that reads the caller without naming `"anonymous"` never admits such
// a caller, and neither does one whose `where` is `true` or absent.
function policyCard(realm: string, anonymous: boolean) {
  let targetType = articleType(realm);
  let grants: Record<string, unknown>[] = [
    { operation: 'query', where: '.status == "published"' },
  ];
  if (anonymous) {
    grants.push(
      {
        operation: 'query',
        where: 'actor() == "anonymous" and .status == "published"',
        blocklist: 'realmConfig("blockedAddresses")',
        rateLimitRequests: 'realmConfig("searchRequests")',
        rateLimitWindowSeconds: '600',
      },
      {
        operation: 'query',
        where: '.authorIds | any(. == actor())',
      },
    );
  } else {
    grants.push({ operation: 'query', where: 'true' }, { operation: 'query' });
  }
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules: [{ targetType, grants }] },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// The path, in the Newsroom's and the Gazette's policy cards, of the grant
// that opens their searches to callers who aren't signed in.
const ANONYMOUS_ARTICLE_GRANT = 'rules[0].grants[1]';

// The settings the grant that opens a governed realm's search reads: no
// address refused, and a budget no test spends unless it lowers it.
function governedConfig(
  overrides: { blockedAddresses?: string; searchRequests?: number } = {},
) {
  return { blockedAddresses: '', searchRequests: 300, ...overrides };
}

function governedRealm(url: string, name: string, policy: string) {
  return {
    realmURL: new URL(url),
    fileSystem: {
      'realm.json': realmConfigCardJSON({
        name,
        policy,
        config: governedConfig(),
      }),
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

// The Forum's types, each with the same fields and its own rule.
const FORUM_TYPES = ['Notice', 'Post', 'Story', 'Memo'] as const;
type ForumType = (typeof FORUM_TYPES)[number];

const FORUM_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
${FORUM_TYPES.map(
  (name) => `  export class ${name} extends CardDef {
    @field title = contains(StringField);
    @field ownerId = contains(StringField);
    @field status = contains(StringField);
  }`,
).join('\n')}
`;

function forumType(name: ForumType) {
  return { module: `${FORUM}forum`, name };
}

function forumCard(name: ForumType, ownerId: string, status: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title: `${name} by ${ownerId}`, ownerId, status },
      meta: { adoptsFrom: { module: '../forum', name } },
    },
  });
}

// Each Forum type's rule:
// - a Notice's search is opened to callers who aren't signed in and to no one
//   else, since `actor() == "anonymous"` never holds for a signed-in caller;
// - a Post's to such callers whatever the post, and to a signed-in caller for
//   the posts they own;
// - a Story's to such callers for the published stories only;
// - a Memo's to signed-in callers only, by a grant whose `where` is `true` and
//   one with no `where`, neither of which names such callers.
const FORUM_GRANTS: Record<ForumType, Record<string, unknown>[]> = {
  Notice: [{ operation: 'query', where: 'actor() == "anonymous"' }],
  Post: [
    {
      operation: 'query',
      where: 'actor() == "anonymous" or .ownerId == actor()',
    },
  ],
  Story: [
    {
      operation: 'query',
      where: 'actor() == "anonymous" and .status == "published"',
    },
  ],
  Memo: [{ operation: 'query', where: 'true' }, { operation: 'query' }],
};

function forumPolicyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: FORUM_TYPES.map((name) => ({
          targetType: forumType(name),
          grants: FORUM_GRANTS[name],
        })),
      },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

// The path of the grant that opens a Forum type's search, in rule order.
function forumGrant(name: ForumType) {
  return `rules[${FORUM_TYPES.indexOf(name)}].grants[0]`;
}

function forumFiles() {
  let files: Record<string, string> = {
    'realm.json': realmConfigCardJSON({ name: 'Forum', policy: FORUM_POLICY }),
    'forum.gts': FORUM_MODULE,
  };
  for (let name of FORUM_TYPES) {
    let folder = `${name.toLowerCase()}s`;
    files[`${folder}/member-published.json`] = forumCard(
      name,
      MEMBER,
      'published',
    );
    files[`${folder}/other-draft.json`] = forumCard(
      name,
      OTHER_MEMBER,
      'draft',
    );
  }
  return files;
}

function forumIds(name: ForumType, ...cards: string[]) {
  let folder = `${name.toLowerCase()}s`;
  return cards.map((card) => `${FORUM}${folder}/${card}`).sort();
}

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
  let gazette: Realm;
  let library: Realm;
  let wire: Realm;
  let forum: Realm;
  let org: Realm;
  let db: PgAdapter;
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
          realmURL: new URL(FORUM),
          fileSystem: forumFiles(),
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [ORG_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(WIRE),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Wire' }),
            'article.gts': ARTICLE_MODULE,
            'articles/published.json': article('Wire published', 'published'),
          },
          permissions: { '*': ['read'], [EDITOR]: ['read', 'write'] },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/newsroom.json': policyCard(NEWSROOM, true),
            'policies/gazette.json': policyCard(GAZETTE, true),
            'policies/library.json': policyCard(LIBRARY, false),
            'policies/forum.json': forumPolicyCard(),
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
    wire = realm(WIRE);
    forum = realm(FORUM);
    org = realm(ORG);
  }

  async function stop() {
    for (let realm of [newsroom, gazette, library, wire, forum, org]) {
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
      db = dbAdapter;
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
  function federatedSearch(
    realms: string[],
    from: string = VISITOR,
    extra: Record<string, unknown> = {},
  ) {
    return request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', from)
      .send({
        filter: {
          any: [...new Set(realms)].map((realm) => ({
            'item.on': articleType(realm),
          })),
        },
        realms,
        ...extra,
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

  // A search of one Forum type on the Forum's own `_search`, by `caller`, or
  // by a caller who isn't signed in.
  function forumSearch(name: ForumType, caller?: string) {
    let search = request
      .post(`${new URL(FORUM).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR);
    if (caller) {
      search = search.set(
        'Authorization',
        `Bearer ${createJWT(forum, caller, [])}`,
      );
    }
    return search.send({ filter: { 'item.on': forumType(name) } });
  }

  // Rewrites the settings the grant that opens a governed realm's search
  // reads.
  async function setConfig(
    realm: Realm,
    overrides: Parameters<typeof governedConfig>[0],
  ) {
    let name = realm === newsroom ? 'Newsroom' : 'Gazette';
    let policy = realm === newsroom ? NEWSROOM_POLICY : GAZETTE_POLICY;
    await realm.write(
      'realm.json',
      realmConfigCardJSON({ name, policy, config: governedConfig(overrides) }),
    );
    await realm.indexing();
  }

  async function setLimit(realm: Realm, requests: number) {
    await setConfig(realm, { searchRequests: requests });
    await clearOfRateLimitWindowEdge({ windowSeconds: 600 });
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
    assert.strictEqual(
      record?.grant,
      ANONYMOUS_ARTICLE_GRANT,
      'against the grant that admitted it',
    );
    assert.deepEqual(
      record?.limit,
      {
        requests: 300,
        windowSeconds: 600,
        requestsFrom: 'grant',
        windowSecondsFrom: 'grant',
      },
      "the grant's own limit, read from the realm's settings and written out",
    );
  });

  test('a realm whose policy opens no search to such callers tells them to authenticate', async function (assert) {
    unauthenticated(await realmSearch(LIBRARY), 'library', assert);
    assert.deepEqual(
      records,
      [],
      'grants whose `where` is `true`, absent, or reads the caller without naming such callers admit none',
    );
  });

  test("a realm's own search is counted against the address, and refused once it is spent", async function (assert) {
    await setLimit(newsroom, 1);
    assert.strictEqual((await realmSearch(NEWSROOM)).status, 200);
    let over = await realmSearch(NEWSROOM);
    assert.strictEqual(over.status, 429, 'the second search is refused');
    assert.strictEqual(over.body.errors[0].code, 'rate-limited');
    let refused = records.find((r) => r.outcome === 'rate-limited');
    assert.strictEqual(refused?.grant, ANONYMOUS_ARTICLE_GRANT);
    assert.deepEqual(refused?.limit, {
      requests: 1,
      windowSeconds: 600,
      requestsFrom: 'grant',
      windowSecondsFrom: 'grant',
    });
  });

  test('a blocked address is told to authenticate', async function (assert) {
    assert.strictEqual(
      (await realmSearch(NEWSROOM, BLOCKED_VISITOR)).status,
      200,
      'precondition: the address is admitted while the setting names no one',
    );
    await setConfig(newsroom, { blockedAddresses: `${BLOCKED_VISITOR}/32` });
    records = [];
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
    let blocked = records.find((r) => r.outcome === 'blocked');
    assert.strictEqual(blocked?.blockReason, 'blocklist');
    assert.strictEqual(blocked?.grant, ANONYMOUS_ARTICLE_GRANT);
    assert.strictEqual(
      (await realmSearch(NEWSROOM, VISITOR)).status,
      200,
      'an address the blocklist does not name is still admitted',
    );
  });

  test('a grant whose blocklist is not a list of addresses admits no such caller', async function (assert) {
    await setConfig(newsroom, {
      blockedAddresses: `${BLOCKED_VISITOR}/32, not an address`,
    });
    unauthenticated(
      await realmSearch(NEWSROOM),
      'an invalid blocklist',
      assert,
    );
    let [blocked] = records;
    assert.strictEqual(blocked?.outcome, 'blocked');
    assert.strictEqual(blocked?.blockReason, 'blocklist-invalid');
    assert.strictEqual(blocked?.grant, ANONYMOUS_ARTICLE_GRANT);
  });

  test('a search across realms answers such a caller with what each realm admits, alongside a realm anyone reads', async function (assert) {
    let response = await federatedSearch([NEWSROOM, GAZETTE, WIRE]);
    assert.deepEqual(ids(response), [
      `${GAZETTE}articles/published`,
      `${NEWSROOM}articles/published`,
      `${WIRE}articles/published`,
    ]);
    assert.notOk(response.body.meta?.incomplete, 'nothing failed');
    let counted = records
      .filter((r) => r.route.endsWith('/_federated-search'))
      .map((r) => [r.realmURL, r.outcome, r.grant])
      .sort();
    assert.deepEqual(
      counted,
      [
        [GAZETTE, 'admitted', ANONYMOUS_ARTICLE_GRANT],
        [NEWSROOM, 'admitted', ANONYMOUS_ARTICLE_GRANT],
      ],
      'each realm searched through its policy counted it, against its own budget',
    );
  });

  test('a realm that admits nothing contributes no rows to a search another realm admits', async function (assert) {
    let response = await federatedSearch([NEWSROOM, LIBRARY]);
    assert.deepEqual(ids(response), [`${NEWSROOM}articles/published`]);
    assert.notOk(response.body.meta?.incomplete);
  });

  test('a search naming more realms than a search may fan out to is told to authenticate, and no realm is asked', async function (assert) {
    let realms = [NEWSROOM, GAZETTE, LIBRARY];
    assert.true(
      realms.length > MAX_REALMS_PER_SEARCH_REQUEST,
      'precondition: more private realms than a search may fan out to',
    );
    unauthenticated(await federatedSearch(realms), 'too many realms', assert);
    assert.deepEqual(records, [], 'no realm was asked');
  });

  test('a realm named twice is counted once', async function (assert) {
    let response = await federatedSearch([NEWSROOM, NEWSROOM]);
    assert.strictEqual(response.status, 200, response.text);
    assert.strictEqual(
      records.filter((r) => r.outcome === 'admitted').length,
      1,
    );
  });

  test('an archived realm admits nobody to a search', async function (assert) {
    await archiveRealm(db, new URL(NEWSROOM));
    unauthenticated(
      await federatedSearch([NEWSROOM]),
      'only an archived realm',
      assert,
    );
    let response = await federatedSearch([NEWSROOM, GAZETTE]);
    assert.deepEqual(ids(response), [`${GAZETTE}articles/published`]);
    assert.deepEqual(
      records.map((r) => r.realmURL),
      [GAZETTE],
      'the archived realm was never asked',
    );
  });

  test('a malformed search is refused before any realm counts it', async function (assert) {
    await setLimit(newsroom, 1);
    let response = await federatedSearch([NEWSROOM], VISITOR, {
      page: { size: 'many' },
    });
    assert.strictEqual(response.status, 400, response.text);
    assert.strictEqual(
      (await realmSearch(NEWSROOM)).status,
      200,
      'the budget is untouched',
    );
  });

  test('an endpoint that refuses realms a caller cannot read still tells such a caller to authenticate', async function (assert) {
    let response = await request
      .post('/_federated-info')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR)
      .send({ realms: [NEWSROOM] });
    unauthenticated(response, '_federated-info', assert);
    assert.deepEqual(records, [], 'no realm was asked');
  });

  test("a named query on a realm's own search tells such a caller to authenticate", async function (assert) {
    let response = await request
      .post(`${new URL(NEWSROOM).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR)
      .send({ operation: 'listMine', on: articleType(NEWSROOM) });
    unauthenticated(response, 'a named query', assert);
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

  test('a grant whose `where` is only `actor() == "anonymous"` opens every card of its type to such callers, and nothing to a signed-in one', async function (assert) {
    assert.deepEqual(
      ids(await forumSearch('Notice')),
      forumIds('Notice', 'member-published', 'other-draft'),
      'a caller who is not signed in is served every notice',
    );
    assert.deepEqual(
      ids(await forumSearch('Notice', MEMBER)),
      [],
      'a signed-in caller is served none, not even their own',
    );
  });

  test('a grant that names such callers alongside the signed-in caller admits each by its own reading', async function (assert) {
    assert.deepEqual(
      ids(await forumSearch('Post')),
      forumIds('Post', 'member-published', 'other-draft'),
      'a caller who is not signed in is served every post',
    );
    assert.deepEqual(
      ids(await forumSearch('Post', MEMBER)),
      forumIds('Post', 'member-published'),
      'a signed-in caller is served the posts they own',
    );
    assert.deepEqual(
      ids(await forumSearch('Post', OTHER_MEMBER)),
      forumIds('Post', 'other-draft'),
      'and another, theirs',
    );
  });

  test('a grant that names such callers and reads the card filters their search by the card', async function (assert) {
    assert.deepEqual(
      ids(await forumSearch('Story')),
      forumIds('Story', 'member-published'),
      'only the published story',
    );
    assert.deepEqual(
      ids(await forumSearch('Story', MEMBER)),
      [],
      'a signed-in caller is admitted by nothing in it',
    );
  });

  test('a grant whose `where` is `true` or absent admits no search by such a caller', async function (assert) {
    let response = await forumSearch('Memo');
    assert.deepEqual(
      ids(response),
      [],
      'the realm opens searches to such callers, but none of its memos',
    );
    assert.deepEqual(
      records.filter((r) => r.outcome === 'admitted'),
      [],
      'a search no grant scoped is not counted',
    );
    assert.deepEqual(
      ids(await forumSearch('Memo', MEMBER)),
      forumIds('Memo', 'member-published', 'other-draft'),
      'the same grants serve a signed-in caller every memo',
    );
  });

  test("a search is counted once, against the grant that admitted it rather than the policy's first", async function (assert) {
    assert.strictEqual((await forumSearch('Story')).status, 200);
    let admitted = records.filter((r) => r.outcome === 'admitted');
    assert.strictEqual(admitted.length, 1, 'counted once');
    assert.strictEqual(admitted[0]?.grant, forumGrant('Story'));
    let limit = admitted[0]?.limit;
    assert.deepEqual(
      {
        requestsFrom: limit?.requestsFrom,
        windowSecondsFrom: limit?.windowSecondsFrom,
      },
      { requestsFrom: 'platform', windowSecondsFrom: 'platform' },
      'a grant that sets no limit counts against the platform default',
    );
  });

  test('a search across realms is counted by each realm against the grant that admitted it there', async function (assert) {
    let response = await request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('X-Forwarded-For', VISITOR)
      .send({
        filter: {
          any: [
            { 'item.on': forumType('Story') },
            { 'item.on': articleType(NEWSROOM) },
          ],
        },
        realms: [FORUM, NEWSROOM],
      });
    assert.deepEqual(
      ids(response),
      [
        ...forumIds('Story', 'member-published'),
        `${NEWSROOM}articles/published`,
      ].sort(),
    );
    assert.deepEqual(
      records
        .filter((r) => r.outcome === 'admitted')
        .map((r) => [r.realmURL, r.grant])
        .sort(),
      [
        [FORUM, forumGrant('Story')],
        [NEWSROOM, ANONYMOUS_ARTICLE_GRANT],
      ],
    );
  });
});
