import { module, test } from 'qunit';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';
import {
  closeServer,
  createVirtualNetwork,
  setupBaseRealmServer,
  setupDB,
  insertUser,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import type { Server } from 'http';

module(`server-endpoints/${basename(__filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_info', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    setupBaseRealmServer(hooks, matrixURL);

    async function startInfoRealmServer({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      let virtualNetwork = createVirtualNetwork();
      let dir = dirSync();
      let testRealmURL = new URL('http://127.0.0.1:4444/test/');
      let secondaryRealmURL = new URL('http://127.0.0.1:4444/secondary/');
      let result = await runTestRealmServerWithRealms({
        virtualNetwork,
        realmsRootPath: join(dir.name, 'realm_server_1'),
        realms: [
          {
            realmURL: testRealmURL,
            fileSystem: {
              '.realm.json': JSON.stringify({ name: 'Primary Realm' }),
            },
            permissions: {
              '*': ['read'],
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: secondaryRealmURL,
            fileSystem: {
              '.realm.json': JSON.stringify({ name: 'Secondary Realm' }),
            },
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });

      testRealmHttpServer = result.testRealmHttpServer;
      request = supertest(result.testRealmHttpServer);
      testRealm = result.realms.find(
        (realm) => realm.url === testRealmURL.href,
      )!;
      secondaryRealm = result.realms.find(
        (realm) => realm.url === secondaryRealmURL.href,
      )!;
    }

    async function stopInfoRealmServer() {
      testRealm.unsubscribe();
      secondaryRealm.unsubscribe();
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await startInfoRealmServer({ dbAdapter, publisher, runner });
      },
      afterEach: async () => {
        await stopInfoRealmServer();
      },
    });

    test('GET /_info federates info across realms and includes public list header', async function (assert) {
      await insertUser(dbAdapter, ownerUserId, 'stripe-test-user', null);

      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let infoURL = new URL('/_info', testRealm.url);
      infoURL.searchParams.append('realms', testRealm.url);
      infoURL.searchParams.append('realms', secondaryRealm.url);

      let response = await request
        .get(`${infoURL.pathname}${infoURL.search}`)
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let { data } = response.body as {
        data: { id: string; type: string; attributes: { name: string } }[];
      };
      assert.strictEqual(data.length, 2, 'returns info for both realms');
      let dataById = new Map(data.map((entry) => [entry.id, entry]));
      assert.strictEqual(
        dataById.get(testRealm.url)?.attributes.name,
        'Primary Realm',
        'primary realm info included',
      );
      assert.strictEqual(
        dataById.get(secondaryRealm.url)?.attributes.name,
        'Secondary Realm',
        'secondary realm info included',
      );

      let publicHeader =
        response.headers['x-boxel-realms-public-readable'] ?? '';
      assert.ok(publicHeader, 'includes public readable realms header');
      let publicRealms = publicHeader
        .split(',')
        .map((value: string) => value.trim());
      assert.ok(publicRealms.includes(testRealm.url), 'public realm is listed');
      assert.notOk(
        publicRealms.includes(secondaryRealm.url),
        'private realm is not listed',
      );
    });

    test('GET /_info returns 403 when user lacks read access', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: '@rando:localhost', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let infoURL = new URL('/_info', testRealm.url);
      infoURL.searchParams.append('realms', testRealm.url);
      infoURL.searchParams.append('realms', secondaryRealm.url);

      let response = await request
        .get(`${infoURL.pathname}${infoURL.search}`)
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`);

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms without access',
      );
    });

    test('GET /_info returns 401 when unauthenticated user requests non-public realm', async function (assert) {
      let infoURL = new URL('/_info', testRealm.url);
      infoURL.searchParams.append('realms', secondaryRealm.url);

      let response = await request
        .get(`${infoURL.pathname}${infoURL.search}`)
        .set('Accept', 'application/vnd.api+json');

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('GET /_info returns 400 when realms param is missing', async function (assert) {
      let response = await request
        .get('/_info')
        .set('Accept', 'application/vnd.api+json');

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'realms query param must be supplied',
        ),
        'response explains missing realms query param',
      );
    });
  });
});
