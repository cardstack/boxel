import { module, test } from 'qunit';
import { basename } from 'path';
import { PgAdapter } from '@cardstack/postgres';
import {
  query,
  insert,
  asExpressions,
  User,
  insertUser,
} from '@cardstack/runtime-common';
import { prepareTestDB } from './helpers';
import handleDeleteBoxelSiteHostnameRequest from '../handlers/handle-delete-boxel-site-hostname';
import Koa from 'koa';
import { RealmServerTokenClaim } from '../utils/jwt';
import { Readable } from 'stream';

module(basename(__filename), function () {
  module('delete boxel site hostname endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let handler: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
    let user: User;
    let otherUser: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = new PgAdapter({ autoMigrate: true });
      handler = handleDeleteBoxelSiteHostnameRequest({
        dbAdapter,
        domainsForPublishedRealms: { boxelSite: boxelSiteDomain },
      } as any);

      // Clean up any existing claims to ensure clean state
      await query(dbAdapter, ['DELETE FROM claimed_domains_for_sites']);

      user = await insertUser(dbAdapter, 'matrix-user-id', 'test-user');
      otherUser = await insertUser(
        dbAdapter,
        'other-matrix-user-id',
        'other-user',
      );
      defaultToken = {
        user: 'matrix-user-id',
        sessionRoom: 'test-session',
      };
    });

    hooks.afterEach(async function () {
      await dbAdapter.close();
    });

    async function callHandler(
      token: RealmServerTokenClaim | null,
      hostname: string,
    ) {
      const ctx: any = {
        state: { token },
        status: undefined,
        body: undefined,
        method: 'DELETE',
        params: { hostname },
        req: Object.assign(Readable.from(['']), {
          headers: {
            host: 'localhost:4200',
          },
          url: `/_boxel-site-hostname/${hostname}`,
          method: 'DELETE',
        }),
        set: () => {},
        res: {
          getHeaders: () => ({}),
          end: () => {},
        },
      };

      await handler(ctx, async () => {});
      return ctx;
    }

    function assertErrorIncludes(ctx: any, message: string) {
      const body = JSON.parse(ctx.body);
      return body.errors && body.errors[0].includes(message);
    }

    test('should return 422 when hostname does not exist', async function (assert) {
      const ctx = await callHandler(defaultToken, 'nonexistent.boxel.site');

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 for nonexistent hostname',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'No active hostname claim found'),
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

      const ctx = await callHandler(defaultToken, hostname);

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 for already removed hostname',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'No active hostname claim found'),
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

      const ctx = await callHandler(defaultToken, hostname);

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 when user does not own hostname',
      );
      assert.ok(
        assertErrorIncludes(
          ctx,
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

      const ctx = await callHandler(defaultToken, hostname);

      assert.strictEqual(
        ctx.status,
        204,
        'Should return 204 for successful deletion',
      );
      assert.strictEqual(
        ctx.body,
        undefined,
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
      await callHandler(defaultToken, hostname);
      const afterDelete = Math.floor(Date.now() / 1000);

      // Verify the removed_at timestamp is recent
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}'`,
      ]);
      const removedAt = Number(claims[0].removed_at);
      assert.ok(
        removedAt >= beforeDelete && removedAt <= afterDelete,
        `removed_at timestamp should be between ${beforeDelete} and ${afterDelete}, got ${removedAt}`,
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
      const ctx1 = await callHandler(defaultToken, hostname);
      assert.strictEqual(ctx1.status, 204, 'First delete should return 204');

      // Second delete should fail with 422
      const ctx2 = await callHandler(defaultToken, hostname);
      assert.strictEqual(ctx2.status, 422, 'Second delete should return 422');
      assert.ok(
        assertErrorIncludes(ctx2, 'No active hostname claim found'),
        'Should have error message about no claim found',
      );
    });
  });
});
