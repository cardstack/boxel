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
import type { FederatedCardTypeSummaryEntry } from '@cardstack/runtime-common/document-types';
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

interface FederatedTypesResponse {
  data: FederatedCardTypeSummaryEntry[];
  meta: {
    page: { total: number };
  };
}

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
              module: '@cardstack/base/card-api',
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

    function makeAuthenticatedRequest(
      realms: string[],
      extra?: Record<string, unknown>,
    ) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      return request
        .post('/_federated-types')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms, ...extra });
    }

    test('QUERY /_federated-types returns flat type summaries from multiple realms', async function (assert) {
      let response = await makeAuthenticatedRequest([
        testRealm.url,
        secondaryRealm.url,
      ]);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as FederatedTypesResponse;

      assert.ok(Array.isArray(body.data), 'data is a flat array');
      assert.ok(body.data.length > 0, 'has type summaries');

      let primaryEntries = body.data.filter(
        (entry) => entry.meta.realmURL === testRealm.url,
      );
      let secondaryEntries = body.data.filter(
        (entry) => entry.meta.realmURL === secondaryRealm.url,
      );

      assert.ok(primaryEntries.length > 0, 'has primary realm entries');
      assert.ok(secondaryEntries.length > 0, 'has secondary realm entries');

      assert.strictEqual(
        body.data[0].type,
        'card-type-summary',
        'entry has correct type',
      );
      assert.ok(body.data[0].meta.realmURL, 'entry has realmURL in meta');
      assert.ok(body.data[0].attributes.displayName, 'entry has displayName');
      assert.strictEqual(
        typeof body.data[0].attributes.total,
        'number',
        'entry has total',
      );

      assert.strictEqual(
        body.meta.page.total,
        body.data.length,
        'meta.page.total matches data length when no pagination',
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
      let body = response.body as FederatedTypesResponse;

      assert.ok(Array.isArray(body.data), 'data is a flat array');
      assert.ok(body.data.length > 0, 'public realm has type summaries');
      assert.strictEqual(
        body.data[0].meta.realmURL,
        testRealm.url,
        'entries are annotated with realmURL',
      );
    });

    test('QUERY /_federated-types with pagination returns limited results', async function (assert) {
      let response = await makeAuthenticatedRequest(
        [testRealm.url, secondaryRealm.url],
        { page: { number: 0, size: 1 } },
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as FederatedTypesResponse;

      assert.strictEqual(body.data.length, 1, 'returns only 1 item');
      assert.ok(body.meta.page.total > 1, 'total is greater than page size');
    });

    test('QUERY /_federated-types pagination page 2 returns different items', async function (assert) {
      let page0Response = await makeAuthenticatedRequest(
        [testRealm.url, secondaryRealm.url],
        { page: { number: 0, size: 1 } },
      );
      let page1Response = await makeAuthenticatedRequest(
        [testRealm.url, secondaryRealm.url],
        { page: { number: 1, size: 1 } },
      );

      let page0Body = page0Response.body as FederatedTypesResponse;
      let page1Body = page1Response.body as FederatedTypesResponse;

      assert.strictEqual(page0Body.data.length, 1, 'page 0 has 1 item');
      assert.strictEqual(page1Body.data.length, 1, 'page 1 has 1 item');

      let page0Id = `${page0Body.data[0].id}-${page0Body.data[0].meta.realmURL}`;
      let page1Id = `${page1Body.data[0].id}-${page1Body.data[0].meta.realmURL}`;
      assert.notStrictEqual(
        page0Id,
        page1Id,
        'page 0 and page 1 return different items',
      );
      assert.strictEqual(
        page0Body.meta.page.total,
        page1Body.meta.page.total,
        'total is same across pages',
      );
    });

    test('QUERY /_federated-types without pagination returns all items', async function (assert) {
      let allResponse = await makeAuthenticatedRequest([
        testRealm.url,
        secondaryRealm.url,
      ]);
      let paginatedResponse = await makeAuthenticatedRequest(
        [testRealm.url, secondaryRealm.url],
        { page: { number: 0, size: 1 } },
      );

      let allBody = allResponse.body as FederatedTypesResponse;
      let paginatedBody = paginatedResponse.body as FederatedTypesResponse;

      assert.strictEqual(
        allBody.data.length,
        allBody.meta.page.total,
        'without pagination, all items are returned',
      );
      assert.strictEqual(
        allBody.meta.page.total,
        paginatedBody.meta.page.total,
        'total matches between paginated and non-paginated',
      );
    });

    test('QUERY /_federated-types with searchKey filters results', async function (assert) {
      let allResponse = await makeAuthenticatedRequest([testRealm.url]);
      let allBody = allResponse.body as FederatedTypesResponse;

      // Use a displayName or code_ref substring from the actual results
      let firstEntry = allBody.data[0];
      let searchTerm = firstEntry.attributes.displayName.substring(0, 4);

      let searchResponse = await makeAuthenticatedRequest([testRealm.url], {
        searchKey: searchTerm,
      });
      let searchBody = searchResponse.body as FederatedTypesResponse;

      assert.ok(searchBody.data.length > 0, 'search returns results');
      assert.ok(
        searchBody.data.every(
          (entry) =>
            entry.attributes.displayName
              .toLowerCase()
              .includes(searchTerm.toLowerCase()) ||
            entry.id.toLowerCase().includes(searchTerm.toLowerCase()),
        ),
        'all results match search term',
      );
      assert.strictEqual(
        searchBody.meta.page.total,
        searchBody.data.length,
        'total matches filtered results when not paginated',
      );
    });

    test('QUERY /_federated-types with searchKey and pagination combined', async function (assert) {
      let allResponse = await makeAuthenticatedRequest([testRealm.url]);
      let allBody = allResponse.body as FederatedTypesResponse;

      let firstEntry = allBody.data[0];
      let searchTerm = firstEntry.attributes.displayName.substring(0, 3);

      let response = await makeAuthenticatedRequest([testRealm.url], {
        searchKey: searchTerm,
        page: { number: 0, size: 1 },
      });
      let body = response.body as FederatedTypesResponse;

      assert.strictEqual(body.data.length, 1, 'returns 1 item');
      let matchesDisplayName = body.data[0].attributes.displayName
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      let matchesCodeRef = body.data[0].id
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      let matchesSearch = matchesDisplayName || matchesCodeRef;
      assert.ok(matchesSearch, 'result matches search term');
      assert.ok(body.meta.page.total >= 1, 'total reflects filtered count');
    });

    test('QUERY /_federated-types with searchKey that matches nothing returns empty data', async function (assert) {
      let response = await makeAuthenticatedRequest([testRealm.url], {
        searchKey: 'zzzzNonExistentTypezzzzz',
      });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as FederatedTypesResponse;

      assert.strictEqual(body.data.length, 0, 'no results');
      assert.strictEqual(body.meta.page.total, 0, 'total is 0');
    });

    test('QUERY /_federated-types searchKey is case-insensitive', async function (assert) {
      let allResponse = await makeAuthenticatedRequest([testRealm.url]);
      let allBody = allResponse.body as FederatedTypesResponse;
      let firstEntry = allBody.data[0];
      let searchTerm = firstEntry.attributes.displayName
        .toUpperCase()
        .substring(0, 4);

      let response = await makeAuthenticatedRequest([testRealm.url], {
        searchKey: searchTerm,
      });
      let body = response.body as FederatedTypesResponse;

      assert.ok(
        body.data.length > 0,
        'case-insensitive search returns results',
      );
    });

    test('QUERY /_federated-types each item has meta.realmURL', async function (assert) {
      let response = await makeAuthenticatedRequest([
        testRealm.url,
        secondaryRealm.url,
      ]);

      let body = response.body as FederatedTypesResponse;

      assert.ok(
        body.data.every(
          (entry) =>
            typeof entry.meta.realmURL === 'string' &&
            entry.meta.realmURL.length > 0,
        ),
        'every entry has a non-empty realmURL',
      );

      let realmURLs = new Set(body.data.map((entry) => entry.meta.realmURL));
      assert.ok(realmURLs.has(testRealm.url), 'has entries from primary realm');
      assert.ok(
        realmURLs.has(secondaryRealm.url),
        'has entries from secondary realm',
      );
    });

    test('QUERY /_federated-types pagination beyond range returns empty data', async function (assert) {
      let response = await makeAuthenticatedRequest([testRealm.url], {
        page: { number: 9999, size: 50 },
      });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as FederatedTypesResponse;

      assert.strictEqual(
        body.data.length,
        0,
        'no results for out-of-range page',
      );
      assert.ok(body.meta.page.total > 0, 'total still reflects actual count');
    });
  });
});
