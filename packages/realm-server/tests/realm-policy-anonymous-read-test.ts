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

// A newsroom realm nobody may read without signing in, governed by a policy
// card in an Org realm. Its policy opens published articles to callers who
// aren't signed in, and the stored bytes of the published ones too. A Library
// realm's policy opens nothing to such callers.
const NEWSROOM = 'http://127.0.0.1:4444/newsroom/';
const LIBRARY = 'http://127.0.0.1:4444/library/';
const ORG = 'http://127.0.0.1:4444/org/';
const NEWSROOM_POLICY = `${ORG}policies/newsroom`;
const LIBRARY_POLICY = `${ORG}policies/library`;
const EDITOR = '@editor:localhost';
const READER = '@reader:localhost';
const ORG_ADMIN = '@org-admin:localhost';

// Callers' addresses come from the ranges reserved for documentation.
const VISITOR = '192.0.2.10';
const OTHER_VISITOR = '192.0.2.11';
const BLOCKED_RANGE = '198.51.100.0/24';
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

const ARTICLE = { module: `${NEWSROOM}article`, name: 'Article' };
const BOOK = { module: `${LIBRARY}article`, name: 'Article' };

function article(headline: string, status: string, authorIds: string[] = []) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { headline, status, authorIds },
      meta: { adoptsFrom: { module: '../article', name: 'Article' } },
    },
  });
}

function policyCard(
  targetType: { module: string; name: string },
  grants: Record<string, unknown>[],
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules: [{ targetType, grants }] },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

const PUBLISHED = `${NEWSROOM}articles/published`;
const DRAFT = `${NEWSROOM}articles/draft`;
const MISSING = `${NEWSROOM}articles/nowhere`;

module(basename(import.meta.filename), function (hooks) {
  let newsroom: Realm;
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
        {
          realmURL: new URL(NEWSROOM),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Newsroom',
              policy: NEWSROOM_POLICY,
            }),
            'article.gts': ARTICLE_MODULE,
            'articles/published.json': article('Polls open', 'published'),
            'articles/draft.json': article('Polls close', 'draft', [EDITOR]),
          },
          permissions: {
            [EDITOR]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
          },
        },
        {
          realmURL: new URL(LIBRARY),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Library',
              policy: LIBRARY_POLICY,
            }),
            'article.gts': ARTICLE_MODULE,
            'articles/published.json': article('Shelved', 'published'),
          },
          permissions: { [EDITOR]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/newsroom.json': policyCard(ARTICLE, [
              {
                operation: 'read',
                anonymous: true,
                where: '.status == "published"',
              },
              // Reads the caller, so it never admits one who isn't signed in,
              // even to an article they would otherwise be named on.
              {
                operation: 'read',
                anonymous: true,
                where: '.authorIds | any(. == actor())',
              },
              {
                operation: 'readSource',
                anonymous: true,
                where: '.status == "published"',
              },
            ]),
            // Grants only signed-in callers.
            'policies/library.json': policyCard(BOOK, [{ operation: 'read' }]),
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
    newsroom = result.realms.find((realm) => realm.url === NEWSROOM)!;
    library = result.realms.find((realm) => realm.url === LIBRARY)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [newsroom, library, org]) {
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

  function readCard(
    url: string,
    from: string | undefined = VISITOR,
    accept: string = SupportedMimeType.CardJson,
  ) {
    let req = request.get(new URL(url).pathname).set('Accept', accept);
    return from === undefined ? req : req.set('X-Forwarded-For', from);
  }

  function readSource(url: string, from: string = VISITOR) {
    return readCard(`${url}.json`, from, SupportedMimeType.CardSource);
  }

  async function setNewsroomConfig(fields: {
    anonymousRateLimit?: unknown;
    anonymousBlocklist?: unknown;
  }) {
    await newsroom.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Newsroom',
        policy: NEWSROOM_POLICY,
        ...fields,
      }),
    );
    await newsroom.indexing();
  }

  function unauthenticated(response: Response, label: string, assert: Assert) {
    assert.strictEqual(response.status, 401, `${label}: 401`);
    assert.strictEqual(
      response.body?.errors?.[0]?.code,
      'actor-required',
      `${label}: told to authenticate`,
    );
  }

  test('a published article is read by a caller who is not signed in, in a realm nobody may read without signing in', async function (assert) {
    let response = await readCard(PUBLISHED);
    assert.strictEqual(response.status, 200, response.text);
    assert.strictEqual(
      response.body.data.attributes.headline,
      'Polls open',
      'the article is served',
    );
    let source = await readSource(PUBLISHED);
    assert.strictEqual(source.status, 200, 'and its stored bytes');
    assert.true(source.text.includes('Polls open'));
  });

  test('a draft, a missing article, and an article in a realm that opens nothing get the same 401', async function (assert) {
    let draft = await readCard(DRAFT);
    let missing = await readCard(MISSING);
    let library = await readCard(`${LIBRARY}articles/published`);
    let draftSource = await readSource(DRAFT);
    let missingSource = await readSource(MISSING);
    for (let [label, response] of [
      ['a draft', draft],
      ['a missing article', missing],
      ['a realm that opens nothing', library],
      ["a draft's bytes", draftSource],
      ["a missing article's bytes", missingSource],
    ] as const) {
      unauthenticated(response, label, assert);
    }
    assert.strictEqual(draft.text, missing.text, 'byte-identical bodies');
    assert.strictEqual(draft.text, library.text);
    assert.strictEqual(draftSource.text, missingSource.text);
  });

  test("a grant that reads the caller admits nobody who isn't signed in, and is not a fault", async function (assert) {
    let before = newsroom.__testOnlyPolicyGateStats().predicateEvaluations;
    let response = await readCard(DRAFT);
    unauthenticated(response, 'a draft its author is named on', assert);
    let after = newsroom.__testOnlyPolicyGateStats().predicateEvaluations;
    assert.strictEqual(
      after - before,
      1,
      'only the grant that reads the card was evaluated',
    );
  });

  test('a realm whose policy opens nothing answers as it always has, loading nothing', async function (assert) {
    let before = library.__testOnlyPolicyGateStats();
    let response = await readCard(`${LIBRARY}articles/published`);
    unauthenticated(response, 'library', assert);
    let after = library.__testOnlyPolicyGateStats();
    assert.strictEqual(after.policyLoads, before.policyLoads, 'no policy load');
    assert.strictEqual(
      after.predicateEvaluations,
      before.predicateEvaluations,
      'no predicate',
    );
    assert.deepEqual(records, [], 'and records nothing');
  });

  test('signed-in callers read as they always have', async function (assert) {
    let response = await request
      .get(new URL(DRAFT).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .set('Authorization', `Bearer ${createJWT(newsroom, READER, ['read'])}`);
    assert.strictEqual(response.status, 200, 'a reader reads the draft');
    assert.deepEqual(records, [], 'and is no anonymous caller');
  });

  test('an address that uses up the limit gets 429 until the window turns, and nobody else is affected', async function (assert) {
    await setNewsroomConfig({
      anonymousRateLimit: { requests: 2, windowSeconds: 600 },
    });
    assert.strictEqual((await readCard(PUBLISHED)).status, 200);
    assert.strictEqual((await readSource(PUBLISHED)).status, 200);
    let over = await readCard(PUBLISHED);
    assert.strictEqual(over.status, 429, 'the third read is refused');
    assert.strictEqual(over.body.errors[0].code, 'rate-limited');
    let retryAfter = Number(over.headers['retry-after']);
    assert.true(
      retryAfter >= 1 && retryAfter <= 600,
      `Retry-After says when: ${retryAfter}`,
    );
    assert.strictEqual(
      over.body.errors[0].meta.retryAfterSeconds,
      retryAfter,
      'and the body says the same',
    );

    assert.strictEqual(
      (await readCard(PUBLISHED, OTHER_VISITOR)).status,
      200,
      'another address has its own budget',
    );
    let reader = await request
      .get(new URL(PUBLISHED).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('X-Forwarded-For', VISITOR)
      .set('Authorization', `Bearer ${createJWT(newsroom, READER, ['read'])}`);
    assert.strictEqual(
      reader.status,
      200,
      'a signed-in caller is never limited',
    );

    let limited = records.filter((r) => r.outcome === 'rate-limited');
    assert.strictEqual(limited.length, 1, 'the refusal is recorded');
    assert.deepEqual(
      {
        clientIP: limited[0].clientIP,
        limit: limited[0].limit,
        operation: limited[0].operation,
      },
      {
        clientIP: VISITOR,
        limit: { requests: 2, windowSeconds: 600, from: 'realm' },
        operation: 'read',
      },
    );
  });

  test('a request no grant admits costs the caller nothing', async function (assert) {
    await setNewsroomConfig({
      anonymousRateLimit: { requests: 1, windowSeconds: 600 },
    });
    for (let i = 0; i < 3; i++) {
      unauthenticated(await readCard(DRAFT), `refused probe ${i}`, assert);
    }
    assert.strictEqual(
      (await readCard(PUBLISHED)).status,
      200,
      'the budget is untouched',
    );
    assert.deepEqual(
      records.map((r) => r.outcome),
      ['refused', 'refused', 'refused', 'admitted'],
    );
  });

  test('a limit the realm sets nothing for is the platform default', async function (assert) {
    await readCard(PUBLISHED);
    let [admitted] = records;
    assert.strictEqual(admitted?.outcome, 'admitted');
    assert.strictEqual(admitted?.limit?.from, 'platform');
    assert.strictEqual(admitted?.count, 1);
  });

  test('a blocked address or range gets the 401 an unadmitted caller gets, whatever the grants say', async function (assert) {
    await setNewsroomConfig({ anonymousBlocklist: [BLOCKED_RANGE] });
    let blocked = await readCard(PUBLISHED, BLOCKED_VISITOR);
    unauthenticated(blocked, 'a blocked range', assert);
    assert.strictEqual(
      blocked.text,
      (await readCard(MISSING, VISITOR)).text,
      'indistinguishable from a refusal',
    );
    assert.strictEqual(
      (await readCard(PUBLISHED, VISITOR)).status,
      200,
      'an address outside the range reads',
    );
    let block = records.find((r) => r.outcome === 'blocked');
    assert.strictEqual(block?.blockReason, 'blocklist');
    assert.strictEqual(block?.clientIP, BLOCKED_VISITOR);
  });

  test('a blocklist entry that is not an address closes the realm to callers who are not signed in', async function (assert) {
    await setNewsroomConfig({ anonymousBlocklist: ['the spammer'] });
    unauthenticated(await readCard(PUBLISHED), 'any address', assert);
    assert.strictEqual(
      records.find((r) => r.outcome === 'blocked')?.blockReason,
      'blocklist-invalid',
    );
  });

  test('a caller whose address cannot be worked out is treated as blocked', async function (assert) {
    unauthenticated(await readCard(PUBLISHED, undefined), 'no address', assert);
    let block = records.find((r) => r.outcome === 'blocked');
    assert.strictEqual(block?.blockReason, 'ip-undetermined');
    assert.strictEqual(block?.clientIP, null);
  });

  test('the address is the one the load balancer appended, not one the caller wrote', async function (assert) {
    await setNewsroomConfig({
      anonymousBlocklist: [BLOCKED_RANGE],
      anonymousRateLimit: { requests: 1, windowSeconds: 600 },
    });
    let response = await readCard(PUBLISHED, `${VISITOR}, ${BLOCKED_VISITOR}`);
    unauthenticated(response, 'a forged earlier entry', assert);
    assert.strictEqual((await readCard(PUBLISHED, VISITOR)).status, 200);
    assert.strictEqual(
      (await readCard(PUBLISHED, `${BLOCKED_VISITOR}, ${VISITOR}`)).status,
      429,
      'naming another address first does not buy another budget',
    );
  });

  test('our own services are measured and never limited or blocked', async function (assert) {
    await setNewsroomConfig({
      anonymousRateLimit: { requests: 1, windowSeconds: 600 },
      anonymousBlocklist: [`${OUR_SERVICES}/32`],
    });
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(
        (await readCard(PUBLISHED, OUR_SERVICES)).status,
        200,
        `read ${i}`,
      );
    }
    unauthenticated(
      await readCard(DRAFT, OUR_SERVICES),
      'still only what a grant admits',
      assert,
    );
    assert.deepEqual(
      records.map((r) => r.outcome),
      ['infra', 'infra', 'infra', 'refused'],
    );
  });
});
