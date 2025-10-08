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
import handleClaimBoxelSiteHostnameRequest from '../handlers/handle-claim-boxel-site-hostname';
import Koa from 'koa';
import { RealmServerTokenClaim } from '../utils/jwt';
import { Readable } from 'stream';

module(basename(__filename), function () {
  module('claim boxel site hostname endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let handler: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
    let user: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = new PgAdapter({ autoMigrate: true });
      handler = handleClaimBoxelSiteHostnameRequest({
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
      attributes?: any,
    ) {
      const jsonApiBody = attributes
        ? {
            data: {
              type: 'claimed-domain',
              attributes,
            },
          }
        : {};
      const bodyText = JSON.stringify(jsonApiBody);
      const stream = Readable.from([bodyText]);
      const ctx: any = {
        state: { token },
        status: undefined,
        body: undefined,
        method: 'POST',
        req: Object.assign(stream, {
          headers: {
            host: 'localhost:4200',
            'content-length': bodyText.length.toString(),
          },
          url: '/_claim-boxel-site-hostname',
          method: 'POST',
        }),
        request: {
          text: async () => bodyText,
        },
        set: () => {},
        res: {
          getHeaders: () => ({}),
          end: () => {},
        },
      };

      await handler(ctx, async () => {});
      return ctx;
    }

    async function callHandlerWithInvalidJSON(
      token: RealmServerTokenClaim | null,
      invalidJSON: string,
    ) {
      const stream = Readable.from([invalidJSON]);
      const ctx: any = {
        state: { token },
        status: undefined,
        body: undefined,
        method: 'POST',
        req: Object.assign(stream, {
          headers: {
            host: 'localhost:4200',
            'content-length': invalidJSON.length.toString(),
          },
          url: '/_claim-boxel-site-hostname',
          method: 'POST',
        }),
        request: {
          text: async () => invalidJSON,
        },
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

    test('should return 400 when body is not valid JSON', async function (assert) {
      const ctx = await callHandlerWithInvalidJSON(
        defaultToken,
        'invalid json{',
      );

      assert.strictEqual(ctx.status, 400, 'Should return 400 for invalid JSON');
      assert.ok(
        assertErrorIncludes(ctx, 'Request body is not valid JSON'),
        'Should have error message about invalid JSON',
      );
    });

    test('should return 400 for invalid JSON-API format', async function (assert) {
      const ctx = await callHandlerWithInvalidJSON(
        defaultToken,
        JSON.stringify({ hostname: 'test.boxel.site' }),
      );

      assert.strictEqual(
        ctx.status,
        400,
        'Should return 400 for invalid JSON-API',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'json is missing "data" object'),
        'Should have error message about missing data object',
      );
    });

    test('should return 400 when source_realm_url is missing', async function (assert) {
      const ctx = await callHandler(defaultToken, {
        hostname: 'test.boxel.site',
      });

      assert.strictEqual(
        ctx.status,
        400,
        'Should return 400 for missing source_realm_url',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'source_realm_url is required'),
        'Should have error message about missing source_realm_url',
      );
    });

    test('should return 400 when hostname is missing', async function (assert) {
      const ctx = await callHandler(defaultToken, {
        source_realm_url: 'https://test-realm.com',
      });

      assert.strictEqual(
        ctx.status,
        400,
        'Should return 400 for missing hostname',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'hostname is required'),
        'Should have error message about missing hostname',
      );
    });

    test('should return 422 when hostname is just the domain without subdomain', async function (assert) {
      const ctx = await callHandler(defaultToken, {
        source_realm_url: 'https://test-realm.com',
        hostname: boxelSiteDomain,
      });

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 for hostname without subdomain',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'Hostname must include a subdomain'),
        'Should have error message about missing subdomain',
      );
    });

    test('should return 422 when hostname does not end with the correct domain', async function (assert) {
      const ctx = await callHandler(defaultToken, {
        source_realm_url: 'https://test-realm.com',
        hostname: 'something.not-boxel.site',
      });

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 for incorrect domain',
      );
      assert.ok(
        assertErrorIncludes(ctx, `Hostname must end with .boxel.site`),
        'Should have error message about incorrect domain',
      );
    });

    test('should return 422 for invalid subdomain names', async function (assert) {
      const invalidSubdomains = [
        'api',
        'admin',
        'test',
        '-invalid',
        'invalid-',
        'a',
        'a'.repeat(64),
        'test@domain',
        'test.domain',
        'MyApp',
        'TEST',
        'xn--test',
        'tëst',
      ];

      for (const subdomain of invalidSubdomains) {
        const ctx = await callHandler(defaultToken, {
          source_realm_url: 'https://test-realm.com',
          hostname: `${subdomain}.${boxelSiteDomain}`,
        });

        assert.strictEqual(
          ctx.status,
          422,
          `Should return 422 for invalid subdomain: ${subdomain}`,
        );
        assert.ok(
          ctx.body,
          `Should have error message for subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 422 when hostname is already claimed', async function (assert) {
      const hostname = 'claimed-site.boxel.site';

      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: 'https://existing-realm.com',
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000),
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const ctx = await callHandler(defaultToken, {
        source_realm_url: 'https://test-realm.com',
        hostname: hostname,
      });

      assert.strictEqual(
        ctx.status,
        422,
        'Should return 422 for already claimed hostname',
      );
      assert.ok(
        assertErrorIncludes(ctx, 'Hostname is already claimed'),
        'Should have error message about hostname already claimed',
      );
    });

    test('should successfully claim a valid hostname', async function (assert) {
      const hostname = 'my-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      const ctx = await callHandler(defaultToken, {
        source_realm_url: sourceRealmURL,
        hostname: hostname,
      });

      assert.strictEqual(
        ctx.status,
        201,
        'Should return 201 for successful claim',
      );

      // Parse and check JSON-API response body
      const responseBody = JSON.parse(ctx.body);
      assert.ok(responseBody.data, 'Should have data object');
      assert.strictEqual(
        responseBody.data.type,
        'claimed-domain',
        'Should have correct type',
      );
      assert.ok(responseBody.data.id, 'Should have an ID');
      assert.strictEqual(
        responseBody.data.attributes.hostname,
        hostname,
        'Should return normalized hostname',
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

      // Verify the claim was saved to database
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}'`,
      ]);
      assert.strictEqual(claims.length, 1, 'Should have one claim in database');
      assert.strictEqual(
        claims[0].user_id,
        user.id,
        'Should have correct user ID',
      );
      assert.strictEqual(
        claims[0].source_realm_url,
        sourceRealmURL,
        'Should have correct source realm URL',
      );
      assert.ok(claims[0].claimed_at, 'Should have claimed_at timestamp');
      assert.strictEqual(claims[0].removed_at, null, 'Should not be removed');
    });

    test('should allow claiming a hostname that was previously removed', async function (assert) {
      const hostname = 'removed-site.boxel.site';

      // Insert a removed claim
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: 'https://old-realm.com',
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000) - 86400,
        removed_at: Math.floor(Date.now() / 1000) - 3600,
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const sourceRealmURL = 'https://new-realm.com';
      const ctx = await callHandler(defaultToken, {
        source_realm_url: sourceRealmURL,
        hostname: hostname,
      });

      assert.strictEqual(
        ctx.status,
        201,
        'Should return 201 for successful claim of previously removed hostname',
      );

      // Verify the new claim was saved
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}' AND removed_at IS NULL`,
      ]);
      assert.strictEqual(claims.length, 1, 'Should have one active claim');
      assert.strictEqual(
        claims[0].source_realm_url,
        sourceRealmURL,
        'Should have new source realm URL',
      );
    });
  });
});
