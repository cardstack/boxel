import { module, test } from 'qunit';
import { basename } from 'path';
import { PgAdapter } from '@cardstack/postgres';
import { query, insert, asExpressions } from '@cardstack/runtime-common';
import { prepareTestDB } from './helpers';
import handleCheckSiteNameAvailabilityRequest from '../handlers/handle-check-site-name-availability';
import Koa from 'koa';

module(basename(__filename), function () {
  module.only('site name availability endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let handler: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = new PgAdapter({ autoMigrate: true });
      handler = handleCheckSiteNameAvailabilityRequest({ dbAdapter } as any);
    });

    hooks.afterEach(async function () {
      await dbAdapter.close();
    });

    async function callHandler(subdomain?: string) {
      const ctx: any = {
        query: subdomain !== undefined ? { subdomain } : {},
        status: undefined,
        body: undefined,
        req: {
          headers: { host: 'localhost:4200' },
          url: '/check-site-name-availability',
        },
        set: () => {},
      };

      await handler(ctx, async () => {});
      return ctx;
    }

    test('should return 400 when subdomain is missing', async function (assert) {
      const ctx = await callHandler();

      assert.strictEqual(
        ctx.status,
        400,
        'Should return 400 for missing subdomain',
      );
      assert.ok(
        ctx.body.includes('subdomain query parameter is required'),
        'Should have error message about missing subdomain',
      );
    });

    test('should return 200 with error for invalid subdomains', async function (assert) {
      const invalidSubdomains = [
        'api',
        'admin',
        'test',
        'api-v2',
        'v1',
        '123',
        'my-api',
        'test-admin',
        'app-test',
        '',
        'a',
        'a'.repeat(64),
        'test@domain',
        'test.domain',
        '-test',
        'test-',
        'MyApp',
        'TEST',
      ];

      for (const subdomain of invalidSubdomains) {
        const ctx = await callHandler(subdomain);

        assert.strictEqual(
          ctx.status,
          200,
          `Should return 200 for invalid subdomain: ${subdomain}`,
        );

        const responseBody = JSON.parse(ctx.body);
        assert.strictEqual(
          responseBody.available,
          false,
          `Should be unavailable for subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.error,
          `Should have error message for subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 200 with available=true for valid unclaimed subdomains', async function (assert) {
      const validSubdomains = ['mike', 'my-company'];

      for (const subdomain of validSubdomains) {
        const ctx = await callHandler(subdomain);

        assert.strictEqual(
          ctx.status,
          200,
          `Should return 200 for valid subdomain: ${subdomain}`,
        );

        const responseBody = JSON.parse(ctx.body);
        assert.ok(
          responseBody,
          `Should have response body for subdomain: ${subdomain}`,
        );
        assert.strictEqual(
          responseBody.available,
          true,
          `Should be available for subdomain: ${subdomain}`,
        );
        assert.strictEqual(
          responseBody.error,
          undefined,
          `Should not have error for valid subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.hostname,
          `Should have hostname for subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.hostname.includes(subdomain),
          `Hostname should contain subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 200 with available=false for claimed subdomains', async function (assert) {
      const subdomain = 'claimed-site';
      const hostname = `${subdomain}.boxel.dev.localhost`;

      let { valueExpressions, nameExpressions: nameExpressions } =
        asExpressions({
          hostname: hostname,
          claimed_at: Math.floor(Date.now() / 1000),
        });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const ctx = await callHandler(subdomain);

      assert.strictEqual(
        ctx.status,
        200,
        'Should return 200 for claimed subdomain',
      );

      const responseBody = JSON.parse(ctx.body);
      assert.ok(responseBody, 'Should have response body');
      assert.strictEqual(
        responseBody.available,
        false,
        'Should be unavailable for claimed subdomain',
      );
      assert.strictEqual(
        responseBody.error,
        undefined,
        'Should not have error for claimed subdomain',
      );
      assert.strictEqual(
        responseBody.hostname,
        hostname,
        'Should return correct hostname',
      );
    });

    test('should handle different environment domains', async function (assert) {
      const subdomain = 'test-env';

      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const ctx = await callHandler(subdomain);

        assert.strictEqual(ctx.status, 200, 'Should return 200');

        const responseBody = JSON.parse(ctx.body);
        assert.ok(
          responseBody.hostname.includes('boxel.site'),
          'Should use production domain',
        );
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    test('should return available=true for removed/unclaimed subdomains', async function (assert) {
      const subdomain = 'removed-site';
      const hostname = `${subdomain}.boxel.dev.localhost`;

      // Insert a claimed domain that has been removed
      let { valueExpressions, nameExpressions } = asExpressions({
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000) - 86400, // claimed yesterday
        removed_at: Math.floor(Date.now() / 1000), // removed now
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const ctx = await callHandler(subdomain);

      assert.strictEqual(
        ctx.status,
        200,
        'Should return 200 for removed subdomain',
      );

      const responseBody = JSON.parse(ctx.body);
      assert.ok(responseBody, 'Should have response body');
      assert.strictEqual(
        responseBody.available,
        true,
        'Should be available for removed subdomain',
      );
      assert.strictEqual(
        responseBody.error,
        undefined,
        'Should not have error for removed subdomain',
      );
      assert.ok(
        responseBody.hostname.includes(subdomain),
        'Should return hostname with subdomain',
      );
    });
  });
});
