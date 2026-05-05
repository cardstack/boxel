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
import { baseCardRef, rri } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import type { PgAdapter } from '@cardstack/postgres';
import { stringify } from 'qs';
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
  module('Realm Server Endpoints | /_federated-search', function (hooks) {
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
              name: 'Shared Card',
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('https://cardstack.com/base/card-api'),
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
              module: rri('https://cardstack.com/base/card-api'),
              name: 'CardDef',
            },
          },
        },
      },
      'friend.gts': `
        import {
          contains,
          linksTo,
          field,
          CardDef,
        } from 'https://cardstack.com/base/card-api';
        import StringField from 'https://cardstack.com/base/string';

        export class Friend extends CardDef {
          @field firstName = contains(StringField);
          @field friend = linksTo(() => Friend);
        }
      `,
      'friend-1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Alice',
          },
          relationships: {
            friend: {
              links: {
                self: './friend-2',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('./friend'),
              name: 'Friend',
            },
          },
        },
      },
      'friend-2.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Bob',
          },
          meta: {
            adoptsFrom: {
              module: rri('./friend'),
              name: 'Friend',
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

    test('QUERY /_federated-search federates results across realms', async function (assert) {
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

      let searchURL = new URL('/_federated-search', testRealm.url);

      let searchResponse = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(searchResponse.status, 200, 'HTTP 200 status');
      let results = searchResponse.body;
      assert.strictEqual(
        results.data.length,
        2,
        'returns results from both realms',
      );
      assert.strictEqual(results.meta.page.total, 2, 'meta total is combined');
      let ids: string[] = results.data.map((entry: { id: string }) => entry.id);
      assert.deepEqual(
        ids,
        [`${testRealm.url}test-card`, `${secondaryRealm.url}test-card`],
        'results are ordered deterministically and exclude non-matching cards',
      );
    });

    test('QUERY /_federated-search supports query body', async function (assert) {
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

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'found one card');
    });

    test('GET /_federated-search returns 400 for unsupported method', async function (assert) {
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

      let searchURL = new URL('/_federated-search', testRealm.url);
      searchURL.searchParams.append('realms', testRealm.url);
      searchURL.searchParams.set('query', stringify(query, { encode: false }));

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

    test('QUERY /_federated-search returns 403 when user lacks read access', async function (assert) {
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

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms without access',
      );
    });

    test('QUERY /_federated-search returns 401 when unauthenticated user requests non-public realm', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('QUERY /_federated-search returns 400 for invalid query', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url], invalid: 'query structure' });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test("QUERY /_federated-search side-loads links by default (include absent) — preserves today's behavior", async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: {
            module: rri(`${testRealm.url}friend`),
            name: 'Friend',
          },
          eq: {
            firstName: 'Alice',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'one Alice returned');
      assert.ok(
        Array.isArray(response.body.included),
        'included is an array when include is absent',
      );
      assert.ok(
        response.body.included.length > 0,
        'included is populated when include is absent',
      );
      let includedIds = response.body.included.map((r: { id: string }) => r.id);
      assert.ok(
        includedIds.some((id: string) => id.includes('friend-2')),
        'linked Bob is side-loaded',
      );
    });

    test('QUERY /_federated-search with include:[] returns no included[] and skips link loading', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: {
            module: rri(`${testRealm.url}friend`),
            name: 'Friend',
          },
          eq: {
            firstName: 'Alice',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url], include: [] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'one Alice returned');
      assert.strictEqual(
        response.body.included,
        undefined,
        'no included array when include:[] is requested',
      );
      // Sanity-check that the relationship metadata is still present in data
      // even though we did not side-load — clients can still walk it manually.
      assert.ok(
        response.body.data[0].relationships?.friend?.links?.self,
        'relationship link is present in data even without side-load',
      );
    });

    test('QUERY /_federated-search with include:["friend"] side-loads only the named relationship', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: {
            module: rri(`${testRealm.url}friend`),
            name: 'Friend',
          },
          eq: {
            firstName: 'Alice',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({
          ...query,
          realms: [testRealm.url],
          include: ['friend'],
        });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'one Alice returned');
      assert.ok(
        Array.isArray(response.body.included),
        'included is an array for named relationship',
      );
      assert.ok(
        response.body.included.length > 0,
        'included is populated for named relationship',
      );
      let includedIds = response.body.included.map((r: { id: string }) => r.id);
      assert.ok(
        includedIds.some((id: string) => id.includes('friend-2')),
        'linked Bob is side-loaded',
      );
    });

    test('QUERY /_federated-search returns 400 when include is not an array of strings', async function (assert) {
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

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url], include: 'friend' });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.message?.includes(
          'include must be an array of strings',
        ),
        'response explains malformed include',
      );
    });

    test('QUERY /_federated-search returns 400 when realms param is missing', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let response = await request
        .post('/_federated-search')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(query);

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
