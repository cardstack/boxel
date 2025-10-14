import { module, test } from 'qunit';
import { basename, join } from 'path';
import { PgAdapter } from '@cardstack/postgres';
import { query, insert, asExpressions, User } from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupDB,
  insertUser,
  runTestRealmServer,
  createVirtualNetwork,
  matrixURL,
  closeServer,
} from './helpers';
import {
  RealmServerTokenClaim,
  createJWT as createRealmServerJWT,
} from '../utils/jwt';
import { realmSecretSeed } from './helpers';
import supertest, { SuperTest, Test } from 'supertest';
import { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';

const testRealmURL = new URL('http://127.0.0.1:4447/test/');

module(basename(__filename), function () {
  module('delete boxel site hostname endpoint', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let user: User;
    let otherUser: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    setupBaseRealmServer(hooks, matrixURL);

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
        otherUser = await insertUser(
          dbAdapter,
          'other-matrix-user-id',
          'other-user',
          'other-user@example.com',
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

    async function makeDeleteRequest(
      token: RealmServerTokenClaim | null,
      hostname: string,
    ) {
      let requestBuilder = request
        .delete(`/_boxel-site-hostname/${hostname}`)
        .set('Accept', 'application/json');

      if (token) {
        const jwt = createRealmServerJWT(token, realmSecretSeed);
        requestBuilder = requestBuilder.set('Authorization', `Bearer ${jwt}`);
      }

      return await requestBuilder;
    }

    function assertErrorIncludes(response: any, message: string) {
      return response.body.errors && response.body.errors[0].includes(message);
    }

    test('should return 422 when hostname does not exist', async function (assert) {
      const response = await makeDeleteRequest(
        defaultToken,
        'nonexistent.boxel.site',
      );

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for nonexistent hostname',
      );
      assert.ok(
        assertErrorIncludes(response, 'No active hostname claim found'),
        'Should have error message about no claim found',
      );
    });

    test('should return 422 when hostname was already removed', async function (assert) {
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

      const response = await makeDeleteRequest(defaultToken, hostname);

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for already removed hostname',
      );
      assert.ok(
        assertErrorIncludes(response, 'No active hostname claim found'),
        'Should have error message about no claim found',
      );
    });

    test('should return 422 when user does not own the hostname', async function (assert) {
      const hostname = 'other-user-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

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

      const response = await makeDeleteRequest(defaultToken, hostname);

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 when user does not own hostname',
      );
      assert.ok(
        assertErrorIncludes(
          response,
          'You do not have permission to delete this hostname claim',
        ),
        'Should have error message about no permission',
      );
    });

    test('should successfully delete a hostname claim', async function (assert) {
      const hostname = 'my-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Insert a claim for the user
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

      const response = await makeDeleteRequest(defaultToken, hostname);

      assert.strictEqual(
        response.status,
        204,
        'Should return 204 for successful deletion',
      );
      assert.strictEqual(
        response.text,
        '',
        'Should have no response body for 204',
      );

      // Verify the claim was soft-deleted in the database
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}'`,
      ]);
      assert.strictEqual(
        claims.length,
        1,
        'Should still have one claim record',
      );
      assert.ok(claims[0].removed_at, 'Should have removed_at timestamp set');
      assert.strictEqual(
        claims[0].user_id,
        user.id,
        'Should still have correct user ID',
      );
      assert.strictEqual(
        claims[0].source_realm_url,
        sourceRealmURL,
        'Should still have correct source realm URL',
      );
    });

    test('should verify removed_at timestamp is recent', async function (assert) {
      const hostname = 'timestamp-test.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Insert a claim for the user
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

      const beforeDelete = Math.floor(Date.now() / 1000);
      await makeDeleteRequest(defaultToken, hostname);
      const afterDelete = Math.floor(Date.now() / 1000);

      // Verify the removed_at timestamp is recent
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}'`,
      ]);
      const removedAt = Number(claims[0].removed_at);
      assert.ok(
        removedAt >= beforeDelete,
        `removed_at timestamp should be >= ${beforeDelete}, got ${removedAt}`,
      );
      assert.ok(
        removedAt <= afterDelete,
        `removed_at timestamp should be <= ${afterDelete}, got ${removedAt}`,
      );
    });

    test('should not be able to delete the same hostname twice', async function (assert) {
      const hostname = 'double-delete.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      // Insert a claim for the user
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

      // First delete should succeed
      const response1 = await makeDeleteRequest(defaultToken, hostname);
      assert.strictEqual(
        response1.status,
        204,
        'First delete should return 204',
      );

      // Second delete should fail with 422
      const response2 = await makeDeleteRequest(defaultToken, hostname);
      assert.strictEqual(
        response2.status,
        422,
        'Second delete should return 422',
      );
      assert.ok(
        assertErrorIncludes(response2, 'No active hostname claim found'),
        'Should have error message about no claim found',
      );
    });
  });
});
