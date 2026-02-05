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
import { baseCardRef, buildQueryParamValue } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
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
  module('Realm Server Endpoints | /_search-prerendered', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    let realmFileSystem: Record<string, LooseSingleCardDocument> = {
      'test-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardInfo: {
              name: 'Shared Card',
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
      'other-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardInfo: {
              name: 'Other Card',
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

    async function startSearchRealmServer({
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
            fileSystem: realmFileSystem,
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: secondaryRealmURL,
            fileSystem: realmFileSystem,
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

    async function stopSearchRealmServer() {
      testRealm.unsubscribe();
      secondaryRealm.unsubscribe();
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await startSearchRealmServer({
          dbAdapter,
          publisher,
          runner,
        });
      },
      afterEach: async () => {
        await stopSearchRealmServer();
      },
    });

    test('QUERY /_search-prerendered federates results across realms', async function (assert) {
      await insertUser(dbAdapter, ownerUserId, 'stripe-test-user', null);

      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Shared Card',
          },
        },
      };

      let searchURL = new URL('/_search-prerendered', testRealm.url);

      let searchResponse = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({
          ...query,
          realms: [testRealm.url, secondaryRealm.url],
          prerenderedHtmlFormat: 'embedded',
        });

      assert.strictEqual(searchResponse.status, 200, 'HTTP 200 status');
      let results = searchResponse.body;
      assert.strictEqual(
        results.data.length,
        2,
        'returns results from both realms',
      );
      assert.strictEqual(results.meta.page.total, 2, 'meta total is combined');
      let ids: string[] = results.data.map((entry: { id: string }) => entry.id);
      assert.ok(
        ids[0]?.startsWith(testRealm.url),
        'results are ordered deterministically (primary realm first)',
      );
      assert.ok(
        ids[1]?.startsWith(secondaryRealm.url),
        'results are ordered deterministically (secondary realm second)',
      );
      assert.true(
        ids.every((id) => id.includes('test-card')),
        'results exclude non-matching cards',
      );
    });

    test('GET /_search-prerendered returns 400 for unsupported method', async function (assert) {
      await insertUser(dbAdapter, ownerUserId, 'stripe-test-user', null);

      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Shared Card',
          },
        },
      };

      let searchURL = new URL('/_search-prerendered', testRealm.url);
      searchURL.searchParams.append('realms', testRealm.url);
      searchURL.searchParams.set('query', buildQueryParamValue(query));
      searchURL.searchParams.set('prerenderedHtmlFormat', 'embedded');

      let response = await request
        .get(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', `Bearer ${realmServerToken}`);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes('method must be QUERY'),
        'response explains unsupported method',
      );
    });

    test('QUERY /_search-prerendered returns 403 when user lacks read access', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: '@rando:localhost', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let searchURL = new URL('/_search-prerendered', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({
          ...query,
          realms: [testRealm.url],
          prerenderedHtmlFormat: 'embedded',
        });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms without access',
      );
    });

    test('QUERY /_search-prerendered returns 401 when unauthenticated user requests non-public realm', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let searchURL = new URL('/_search-prerendered', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          ...query,
          realms: [testRealm.url],
          prerenderedHtmlFormat: 'embedded',
        });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('QUERY /_search-prerendered returns 400 for invalid query', async function (assert) {
      await insertUser(dbAdapter, ownerUserId, 'stripe-test-user', null);
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let searchURL = new URL('/_search-prerendered', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({
          realms: [testRealm.url],
          invalid: 'query structure',
          prerenderedHtmlFormat: 'embedded',
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('QUERY /_search-prerendered returns 400 when realms param is missing', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let response = await request
        .post('/_search-prerendered')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({ ...query, prerenderedHtmlFormat: 'embedded' });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'realms must be supplied in request body',
        ),
        'response explains missing realms in request body',
      );
    });
  });
});
