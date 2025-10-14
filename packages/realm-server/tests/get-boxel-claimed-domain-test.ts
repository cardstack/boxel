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
import handleGetBoxelClaimedDomainRequest from '../handlers/handle-get-boxel-claimed-domain';
import Koa from 'koa';
import { RealmServerTokenClaim } from '../utils/jwt';
import { Readable } from 'stream';

module(basename(__filename), function () {
  module('get boxel claimed domain endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let handler: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
    let user: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = new PgAdapter({ autoMigrate: true });
      handler = handleGetBoxelClaimedDomainRequest({
        dbAdapter,
        domainsForPublishedRealms: { boxelSite: boxelSiteDomain },
      } as any);

      user = await insertUser(dbAdapter, 'matrix-user-id', 'test-user');
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
      queryParams?: Record<string, string>,
    ) {
      const ctx: any = {
        state: { token },
        status: undefined,
        body: undefined,
        method: 'GET',
        query: queryParams || {},
        req: Object.assign(Readable.from(['']), {
          headers: {
            host: 'localhost:4200',
          },
          url: '/_boxel-claimed-domains',
          method: 'GET',
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

    test('should return 400 when source_realm_url is missing', async function (assert) {
      const ctx = await callHandler(defaultToken, {});

      assert.strictEqual(
        ctx.status,
        400,
        'Should return 400 for missing source_realm_url',
      );
      assert.ok(
        assertErrorIncludes(
          ctx,
          'source_realm_url query parameter is required',
        ),
        'Should have error message about missing source_realm_url',
      );
    });

    test('should return 404 when no claim exists for the realm', async function (assert) {
      const ctx = await callHandler(defaultToken, {
        source_realm_url: 'https://nonexistent-realm.com',
      });

      assert.strictEqual(
        ctx.status,
        404,
        'Should return 404 for nonexistent claim',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'No hostname claim found for this realm'),
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

      const ctx = await callHandler(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        ctx.status,
        200,
        'Should return 200 for successful get',
      );

      // Parse and check JSON-API response body
      const responseBody = JSON.parse(ctx.body);
      assert.ok(responseBody.data, 'Should have data object');
      assert.strictEqual(
        responseBody.data.type,
        'claimed-site-hostname',
        'Should have correct type',
      );
      assert.ok(responseBody.data.id, 'Should have an ID');
      assert.strictEqual(
        responseBody.data.attributes.hostname,
        hostname,
        'Should return correct hostname',
      );
      assert.strictEqual(
        responseBody.data.attributes.subdomain,
        'my-site',
        'Should return correct subdomain',
      );
      assert.strictEqual(
        responseBody.data.attributes.sourceRealmURL,
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

      const ctx = await callHandler(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        ctx.status,
        404,
        'Should return 404 for removed claim',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'No hostname claim found for this realm'),
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
      const ctx = await callHandler(defaultToken, {
        source_realm_url: sourceRealmURL,
      });

      assert.strictEqual(
        ctx.status,
        404,
        'Should return 404 for other user claim',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'No hostname claim found for this realm'),
        'Should have error message about no claim found',
      );
    });
  });
});
