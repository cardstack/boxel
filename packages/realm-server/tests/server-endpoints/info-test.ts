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

    test('QUERY /_info federates info across realms and includes public list header', async function (assert) {
      await insertUser(dbAdapter, ownerUserId, 'stripe-test-user', null);

      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_info')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url, secondaryRealm.url] });

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

    test('QUERY /_info returns 403 when user lacks read access', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: '@rando:localhost', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_info')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms without access',
      );
    });

    test('QUERY /_info returns 401 when unauthenticated user requests non-public realm', async function (assert) {
      let response = await request
        .post('/_info')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .send({ realms: [secondaryRealm.url] });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('QUERY /_info returns 400 when realms are missing', async function (assert) {
      let response = await request
        .post('/_info')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .send({});

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'realms must be supplied in request body',
        ),
        'response explains missing realms list',
      );
    });
  });
});
