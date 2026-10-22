import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync, existsSync, readJsonSync } = fsExtra;
import { basename, join } from 'path';
import { dirSync, type DirResult } from 'tmp';
import {
  DEFAULT_PERMISSIONS,
  rri,
  SupportedMimeType,
  type QueuePublisher,
  type QueueRunner,
  type Realm,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWTForRealmURL,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
  waitUntil,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

const testRealm2URL = 'http://127.0.0.1:4445/test/';

// Publishing a realm whose `realm.json` names a policy. A published realm is a
// public, read-only snapshot of its source: its ACL lets everyone read and
// nobody write, and it names no policy of its own.
module(basename(import.meta.filename), function (hooks) {
  let testRealmHttpServer: Server;
  let testRealmServer: Awaited<
    ReturnType<typeof runTestRealmServer>
  >['testRealmServer'];
  let request: SuperTest<Test>;
  let dir: DirResult;
  let ownerUserId = '@mango:localhost';

  // Each call writes the realm into its own directory: the template build
  // runs before any test, and every test starts from a copy of its database
  // with a fresh directory.
  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    dir = dirSync();
    let realmsRootPath = join(dir.name, 'realm_server_3');
    let testRealmDir = join(realmsRootPath, 'test');
    ensureDirSync(testRealmDir);
    copySync(fixtureDir('blank'), testRealmDir);
    ({ testRealmServer, testRealmHttpServer } = await runTestRealmServer({
      virtualNetwork: createVirtualNetwork(),
      testRealmDir,
      realmsRootPath,
      realmURL: new URL(testRealm2URL),
      dbAdapter,
      publisher,
      runner,
      matrixURL,
      permissions: {
        '*': ['read'],
        [ownerUserId]: DEFAULT_PERMISSIONS,
      },
      domainsForPublishedRealms: {
        boxelSpace: 'localhost',
        boxelSite: 'localhost:4445',
      },
    }));
    request = supertest(testRealmHttpServer);
  }

  async function stop() {
    await closeServer(testRealmHttpServer);
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
    afterEach: stop,
  });

  // A source realm whose policy lets any signed-in caller create a card of
  // any type. The realm names the policy by the card's URL, which a verbatim
  // copy of its `realm.json` would carry into the published realm, naming
  // the source's policy card rather than the snapshot's copy of it.
  module('with a source realm that names a policy', function (hooks) {
    const STRANGER = '@stranger:localhost';
    const CARD_DEF = {
      module: rri('@cardstack/base/card-api'),
      name: 'CardDef',
    };
    const REALM_POLICY = {
      module: rri('@cardstack/catalog/realm-policy/realm-policy'),
      name: 'RealmPolicy',
    };
    const publishedRealmURL = 'http://testuser.localhost:4445/policy-snapshot/';
    let sourceRealm: Realm;
    let policyCard: string;

    setupCatalogTestSubset(hooks);

    hooks.beforeEach(async function () {
      let createResponse = await request
        .post('/_create-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: ownerUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send(
          JSON.stringify({
            data: {
              type: 'realm',
              attributes: {
                name: 'Policy Source',
                endpoint: `policy-source-${uuidv4()}`,
              },
            },
          }),
        );
      let sourceRealmURL = createResponse.body.data.id as string;
      sourceRealm =
        (await testRealmServer.testingOnlyReconciler.lookupOrMount(
          sourceRealmURL,
        ))!;
      policyCard = `${sourceRealmURL}policies/open`;
      await sourceRealm.write(
        'policies/open.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              rules: [
                { targetType: CARD_DEF, grants: [{ operation: 'create' }] },
              ],
            },
            meta: { adoptsFrom: REALM_POLICY },
          },
        }),
      );
      await sourceRealm.write(
        'realm.json',
        realmConfigCardJSON({ name: 'Policy Source', policy: policyCard }),
      );
      await sourceRealm.indexing();
    });

    function publish() {
      return request
        .post('/_publish-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: ownerUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send(
          JSON.stringify({
            sourceRealmURL: sourceRealm.url,
            publishedRealmURL,
          }),
        );
    }

    async function awaitPublishedRealmReady() {
      let { host, pathname } = new URL(publishedRealmURL);
      await testRealmServer.testingOnlyReconcile();
      await waitUntil(
        async () =>
          (
            await request
              .get(`${pathname}_readiness-check`)
              .set('Host', host)
              .set('Accept', 'application/vnd.api+json')
          ).status === 200,
        {
          timeout: 120_000,
          interval: 500,
          timeoutMessage: 'published realm never passed its readiness check',
        },
      );
    }

    // A signed-in caller holding only what the realm's ACL gives everyone.
    function stranger(realmURL: string, permissions: RealmPermissions['user']) {
      return `Bearer ${createJWTForRealmURL({
        realmURL,
        realmServerURL: new URL(testRealm2URL).origin + '/',
        user: STRANGER,
        permissions,
      })}`;
    }

    function cardJsonCreate(realmURL: string, auth: string) {
      let { host, pathname } = new URL(realmURL);
      return request
        .post(pathname)
        .set('Host', host)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', auth)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Minted' } },
              meta: { adoptsFrom: CARD_DEF },
            },
          }),
        );
    }

    function envelopeCreate(realmURL: string, auth: string) {
      let { host, pathname } = new URL(realmURL);
      return request
        .post(`${pathname}_operations`)
        .set('Host', host)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set('Authorization', auth)
        .send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'create',
                data: {
                  type: 'card',
                  attributes: { cardInfo: { name: 'Minted' } },
                  meta: { adoptsFrom: CARD_DEF },
                },
              },
            ],
          }),
        );
    }

    async function assertPublishedRealmNamesNoPolicy(
      assert: Assert,
      publishedRealmId: string,
      label: string,
    ) {
      let publishedRealmPath = join(
        dir.name,
        'realm_server_3',
        '_published',
        publishedRealmId,
      );
      let attributes = (
        readJsonSync(join(publishedRealmPath, 'realm.json')) as {
          data: { attributes: Record<string, unknown> };
        }
      ).data.attributes;
      assert.false(
        'policy' in attributes,
        `${label}: the published realm.json carries no policy pointer`,
      );
      assert.deepEqual(
        attributes.cardInfo,
        { name: 'Policy Source' },
        `${label}: the rest of the published realm.json is the source's`,
      );
      assert.true(
        attributes.includePrerenderedDefaultRealmIndex,
        `${label}: the published realm.json keeps its prerendered-index opt-in`,
      );
      assert.true(
        existsSync(join(publishedRealmPath, 'policies', 'open.json')),
        `${label}: the policy card is copied with the rest of the realm`,
      );

      let publishedRealm =
        await testRealmServer.testingOnlyReconciler.lookupOrMount(
          publishedRealmURL,
        );
      assert.strictEqual(
        await publishedRealm!.getRealmPolicy(),
        undefined,
        `${label}: the published realm names no policy`,
      );

      let auth = stranger(publishedRealmURL, ['read']);
      assert.strictEqual(
        (await cardJsonCreate(publishedRealmURL, auth)).status,
        403,
        `${label}: a signed-in caller's card+json create is refused`,
      );
      assert.strictEqual(
        (await envelopeCreate(publishedRealmURL, auth)).status,
        403,
        `${label}: a signed-in caller's envelope create is refused`,
      );
      assert.false(
        existsSync(join(publishedRealmPath, 'CardDef')),
        `${label}: nothing was minted in the published realm`,
      );

      let { host, pathname } = new URL(publishedRealmURL);
      assert.strictEqual(
        (
          await request
            .get(`${pathname}index`)
            .set('Host', host)
            .set('Accept', SupportedMimeType.CardJson)
        ).status,
        200,
        `${label}: the published realm is still publicly readable`,
      );
    }

    test('a published realm names no policy, so its source policy grants no write into it', async function (assert) {
      let response = await publish();
      assert.strictEqual(response.status, 202, 'publish accepted');
      await awaitPublishedRealmReady();

      await assertPublishedRealmNamesNoPolicy(
        assert,
        response.body.data.id,
        'first publish',
      );

      let sourceAttributes = (
        readJsonSync(join(sourceRealm.dir!, 'realm.json')) as {
          data: { attributes: Record<string, unknown> };
        }
      ).data.attributes;
      assert.strictEqual(
        sourceAttributes.policy,
        policyCard,
        'the source realm.json still names its policy',
      );
      let auth = stranger(sourceRealm.url, []);
      assert.strictEqual(
        (await cardJsonCreate(sourceRealm.url, auth)).status,
        201,
        "the source realm's policy still admits a card+json create",
      );
      assert.strictEqual(
        (await envelopeCreate(sourceRealm.url, auth)).status,
        200,
        "the source realm's policy still admits an envelope create",
      );
    });

    // A snapshot whose `realm.json` names its source's policy, which a
    // published realm has no writer to fix for itself. A republish replaces
    // the file, and the mounted realm stops answering from the pointer it
    // memoized.
    test('republishing a snapshot that names its source policy drops the pointer', async function (assert) {
      let first = await publish();
      assert.strictEqual(first.status, 202, 'first publish accepted');
      await awaitPublishedRealmReady();

      let publishedRealm =
        (await testRealmServer.testingOnlyReconciler.lookupOrMount(
          publishedRealmURL,
        ))!;
      let realmConfig = readJsonSync(
        join(
          dir.name,
          'realm_server_3',
          '_published',
          first.body.data.id,
          'realm.json',
        ),
      ) as { data: { attributes: Record<string, unknown> } };
      realmConfig.data.attributes.policy = policyCard;
      await publishedRealm.write(
        'realm.json',
        JSON.stringify(realmConfig, null, 2),
      );
      await publishedRealm.indexing();
      assert.deepEqual(
        await publishedRealm.getRealmPolicy(),
        { card: policyCard },
        'the snapshot names its source policy',
      );
      assert.strictEqual(
        (
          await cardJsonCreate(
            publishedRealmURL,
            stranger(publishedRealmURL, ['read']),
          )
        ).status,
        201,
        "the source's policy admits a signed-in caller's create into the snapshot",
      );

      let second = await publish();
      assert.strictEqual(second.status, 202, 'republish accepted');
      assert.strictEqual(
        second.body.data.id,
        first.body.data.id,
        'republish swaps into the same published realm',
      );
      await awaitPublishedRealmReady();

      await assertPublishedRealmNamesNoPolicy(
        assert,
        second.body.data.id,
        'republish',
      );
    });
  });
});
