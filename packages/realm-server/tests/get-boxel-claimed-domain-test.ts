import { module, test } from 'qunit';
import { basename, join } from 'path';
import { PgAdapter } from '@cardstack/postgres';
import { query, insert, asExpressions, User } from '@cardstack/runtime-common';
import {
  setupDB,
  insertUser,
  runTestRealmServer,
  createVirtualNetwork,
  matrixURL,
  closeServer,
  setupBaseRealmServer,
  realmSecretSeed,
} from './helpers';
import {
  RealmServerTokenClaim,
  createJWT as createRealmServerJWT,
} from '../utils/jwt';
import supertest, { SuperTest, Test } from 'supertest';
import { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';

const testRealmURL = new URL('http://127.0.0.1:0/test/');

module(basename(__filename), function () {
  module('get boxel claimed domain endpoint', function (hooks) {
    setupBaseRealmServer(hooks, matrixURL);

    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let user: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let testRealmDir = join(dir.name, 'realm_server_5', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);

        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_5'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
            domainsForPublishedRealms: { boxelSite: boxelSiteDomain },
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);

        user = await insertUser(
          dbAdapter,
          'matrix-user-id',
          'test-user',
          'test-user@example.com',
        );
        defaultToken = {
          user: 'matrix-user-id',
          sessionRoom: 'test-session',
        };
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    async function makeGetRequest(
      token: RealmServerTokenClaim | null,
      queryParams?: Record<string, string>,
    ) {
      let requestBuilder = request
        .get('/_boxel-claimed-domains')
        .set('Accept', 'application/json');

      if (token) {
        const jwt = createRealmServerJWT(token, realmSecretSeed);
        requestBuilder = requestBuilder.set('Authorization', `Bearer ${jwt}`);
      }

      if (queryParams) {
        requestBuilder = requestBuilder.query(queryParams);
      }

      return await requestBuilder;
    }

    function assertErrorIncludes(response: any, message: string) {
      return response.body.errors && response.body.errors[0].includes(message);
    }

    test('should return 400 when source_realm_url is missing', async function (assert) {
      const response = await makeGetRequest(defaultToken, {});

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 for missing source_realm_url',
      );
      assert.ok(
        assertErrorIncludes(
          response,
          'source_realm_url query parameter is required',
        ),
        'Should have error message about missing source_realm_url',
      );
    });

    test('should return 404 when no claim exists for the realm', async function (assert) {
      const response = await makeGetRequest(defaultToken, {
        source_realm_url: 'https://nonexistent-realm.com',
      });

      assert.strictEqual(
        response.status,
        404,
        'Should return 404 for nonexistent claim',
      );
      assert.ok(
        assertErrorIncludes(response, 'No hostname claim found for this realm'),
        'Should have error message about no claim found',
      );
    });

    test('should successfully get a claimed hostname', async function (assert) {
      const hostname = 'my-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Insert a claim
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: sourceRealmURL,
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000),
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const response = await makeGetRequest(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        response.status,
        200,
        'Should return 200 for successful get',
      );

      // Check JSON-API response body
      assert.ok(response.body.data, 'Should have data object');
      assert.strictEqual(
        response.body.data.type,
        'claimed-domain',
        'Should have correct type',
      );
      assert.ok(response.body.data.id, 'Should have an ID');
      assert.strictEqual(
        response.body.data.attributes.hostname,
        hostname,
        'Should return correct hostname',
      );
      assert.strictEqual(
        response.body.data.attributes.subdomain,
        'my-site',
        'Should return correct subdomain',
      );
      assert.strictEqual(
        response.body.data.attributes.sourceRealmURL,
        sourceRealmURL,
        'Should return source realm URL',
      );
    });

    test('should not return removed claims', async function (assert) {
      const hostname = 'removed-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Insert a removed claim
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: sourceRealmURL,
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000) - 86400,
        removed_at: Math.floor(Date.now() / 1000) - 3600,
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const response = await makeGetRequest(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        response.status,
        404,
        'Should return 404 for removed claim',
      );
      assert.ok(
        assertErrorIncludes(response, 'No hostname claim found for this realm'),
        'Should have error message about no claim found',
      );
    });

    test('should only return claims for the authenticated user', async function (assert) {
      const hostname = 'other-user-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Create another user
      const otherUser = await insertUser(
        dbAdapter,
        'other-matrix-user-id',
        'other-user',
        'other-user@example.com',
      );

      // Insert a claim for the other user
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: otherUser.id,
        source_realm_url: sourceRealmURL,
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000),
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      // Try to get the claim as the default user
      const response = await makeGetRequest(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        response.status,
        404,
        'Should return 404 for other user claim',
      );
      assert.ok(
        assertErrorIncludes(response, 'No hostname claim found for this realm'),
        'Should have error message about no claim found',
      );
    });
  });
});
