import { module, test } from 'qunit';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type {
  LooseSingleCardDocument,
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
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import type { Server } from 'http';

module(`server-endpoints/${basename(__filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_federated-types', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    let realmFileSystem: Record<string, string | LooseSingleCardDocument> = {
      'test-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardInfo: {
              name: 'Test Card',
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
        },
      },
    };

    async function startTypesRealmServer({
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
              ...realmFileSystem,
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
              ...realmFileSystem,
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

    async function stopTypesRealmServer() {
      testRealm.unsubscribe();
      secondaryRealm.unsubscribe();
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await startTypesRealmServer({ dbAdapter, publisher, runner });
      },
      afterEach: async () => {
        await stopTypesRealmServer();
      },
    });

    test('QUERY /_federated-types returns type summaries from multiple realms grouped by realm URL', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let { data } = response.body as {
        data: Record<
          string,
          {
            data: {
              type: string;
              id: string;
              attributes: { displayName: string; total: number };
            }[];
          }
        >;
      };

      assert.ok(data[testRealm.url], 'includes primary realm data');
      assert.ok(data[secondaryRealm.url], 'includes secondary realm data');

      let primarySummaries = data[testRealm.url].data;
      assert.ok(
        primarySummaries.length > 0,
        'primary realm has type summaries',
      );
      assert.strictEqual(
        primarySummaries[0].type,
        'card-type-summary',
        'summary has correct type',
      );

      let secondarySummaries = data[secondaryRealm.url].data;
      assert.ok(
        secondarySummaries.length > 0,
        'secondary realm has type summaries',
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

    test('QUERY /_federated-types returns 401 for unauthenticated request to non-public realm', async function (assert) {
      let response = await request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send({ realms: [secondaryRealm.url] });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('QUERY /_federated-types returns 403 for authenticated request to non-public realm without read permission', async function (assert) {
      let unauthorizedToken = createRealmServerJWT(
        { user: 'unauthorized-user', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .send({ realms: [secondaryRealm.url] });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(secondaryRealm.url),
        'response lists realms lacking read permission',
      );
    });
    test('QUERY /_federated-types returns 400 when realms are missing', async function (assert) {
      let response = await request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send({});

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'realms must be supplied in request body',
        ),
        'response explains missing realms list',
      );
    });

    test('QUERY /_federated-types returns type summaries for public realm without auth', async function (assert) {
      let response = await request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send({ realms: [testRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let { data } = response.body as {
        data: Record<string, { data: { type: string; id: string }[] }>;
      };

      assert.ok(data[testRealm.url], 'includes public realm data');
      assert.ok(
        data[testRealm.url].data.length > 0,
        'public realm has type summaries',
      );
    });
  });
});
