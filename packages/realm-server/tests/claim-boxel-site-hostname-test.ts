import { module, test } from 'qunit';
import { basename } from 'path';
import { PgAdapter } from '@cardstack/postgres';
import {
  asExpressions,
  insert,
  param,
  query,
  type User,
} from '@cardstack/runtime-common';
import Koa from 'koa';
import handleClaimBoxelSiteHostnameRequest from '../handlers/handle-claim-boxel-site-hostname';
import { prepareTestDB, insertUser as insertTestUser } from './helpers';

module(basename(__filename), function () {
  module.only('claim boxel site hostname endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let handler: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
    let user: User;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = new PgAdapter({ autoMigrate: true });
      handler = handleClaimBoxelSiteHostnameRequest({ dbAdapter } as any);
      user = await insertTestUser(
        dbAdapter,
        '@test-user:localhost',
        'cus_test123',
        'test@example.com',
      );
    });

    hooks.afterEach(async function () {
      await dbAdapter.close();
    });

    async function callHandler(
      body?: Record<string, unknown>,
      options?: {
        rawBody?: string;
        tokenUser?: string;
      },
    ) {
      const requestBody =
        options?.rawBody !== undefined ? options.rawBody : (body ?? {});
      const ctx: any = {
        method: 'POST',
        body: undefined,
        status: undefined,
        state: {
          token: {
            user: options?.tokenUser ?? user.matrixUserId,
            sessionRoom: '!room:localhost',
          },
        },
        request: {
          body: requestBody,
        },
        req: {
          headers: {
            host: 'localhost:4200',
          },
          url: '/_claim-boxel-site-hostname',
        },
        set() {},
      };

      await handler(ctx, async () => {});
      return ctx;
    }

    test('claims hostname when valid and available', async function (assert) {
      const sourceRealmURL = 'http://localhost:4201/user/hey/ ';
      const hostname = 'my-new-site.boxel.dev.localhost';

      const ctx = await callHandler({
        source_realm_url: sourceRealmURL,
        hostname,
      });

      assert.strictEqual(ctx.status, 201, 'returns 201 for successful claim');

      const responseBody = JSON.parse(ctx.body);
      assert.deepEqual(
        responseBody,
        {
          hostname: 'my-new-site.boxel.dev.localhost',
          subdomain: 'my-new-site',
          sourceRealmURL,
        },
        'returns normalized hostname payload',
      );

      const claimed = await query(dbAdapter, [
        `SELECT user_id, hostname, source_realm_url FROM claimed_domains_for_sites WHERE hostname = `,
        param('my-new-site.boxel.dev.localhost'),
      ]);

      assert.strictEqual(claimed.length, 1, 'persists single claim');
      assert.strictEqual(claimed[0].user_id, user.id, 'stores user id');
      assert.strictEqual(
        claimed[0].hostname,
        'my-new-site.boxel.dev.localhost',
        'stores normalized hostname',
      );
      assert.strictEqual(
        claimed[0].source_realm_url,
        sourceRealmURL,
        'stores source realm URL',
      );
    });

    test('returns 400 when request body is not valid JSON', async function (assert) {
      const ctx = await callHandler(undefined, { rawBody: '{not valid json' });

      assert.strictEqual(ctx.status, 400, 'returns 400 for invalid JSON');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'Request body is not valid JSON',
        'includes error message',
      );
    });

    test('returns 400 when source_realm_url is missing', async function (assert) {
      const ctx = await callHandler({
        hostname: 'missing-url.boxel.dev.localhost',
      });

      assert.strictEqual(
        ctx.status,
        400,
        'returns 400 for missing source_realm_url',
      );
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'source_realm_url is required and must be a non-empty string',
        'includes missing source realm message',
      );
    });

    test('returns 400 when hostname is missing', async function (assert) {
      const ctx = await callHandler({
        source_realm_url: 'https://example.com/realm',
      });

      assert.strictEqual(ctx.status, 400, 'returns 400 for missing hostname');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'hostname is required and must be a non-empty string',
        'includes missing hostname message',
      );
    });

    test('returns 422 when hostname does not match environment domain', async function (assert) {
      const ctx = await callHandler({
        source_realm_url: 'http://localhost:4201/user/hey/ ',
        hostname: 'invalid.example.com',
      });

      assert.strictEqual(ctx.status, 422, 'returns 422 for invalid domain');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'Hostname must end with .boxel.dev.localhost',
        'includes invalid domain message',
      );
    });

    test('returns 422 when subdomain is invalid', async function (assert) {
      const ctx = await callHandler({
        source_realm_url: 'http://localhost:4201/user/hey/ ',
        hostname: 'admin.boxel.dev.localhost',
      });

      assert.strictEqual(ctx.status, 422, 'returns 422 for reserved subdomain');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'This subdomain is reserved and cannot be used',
        'propagates validation error message',
      );
    });

    test('returns 422 when hostname is already claimed', async function (assert) {
      const hostname = 'taken.boxel.dev.localhost';
      const { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        hostname,
        source_realm_url: 'http://localhost:4201/user/hey/ ',
        claimed_at: Math.floor(Date.now() / 1000),
      });

      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const ctx = await callHandler({
        source_realm_url: 'http://localhost:4201/user/hey/ ',
        hostname,
      });

      assert.strictEqual(ctx.status, 422, 'returns 422 for claimed hostname');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'Hostname is already claimed',
        'reports claimed hostname error',
      );
    });

    test('returns 422 when hostname omits subdomain', async function (assert) {
      const ctx = await callHandler({
        source_realm_url: 'http://localhost:4201/user/hey/ ',
        hostname: 'boxel.dev.localhost',
      });

      assert.strictEqual(ctx.status, 422, 'returns 422 for missing subdomain');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'Hostname must include a subdomain',
        'reports missing subdomain',
      );
    });

    test('returns 404 when user cannot be found', async function (assert) {
      const ctx = await callHandler(
        {
          source_realm_url: 'http://localhost:4201/user/hey/ ',
          hostname: 'missing-user.boxel.dev.localhost',
        },
        { tokenUser: '@unknown-user:localhost' },
      );

      assert.strictEqual(ctx.status, 404, 'returns 404 when user missing');
      const responseBody = JSON.parse(ctx.body);
      assert.strictEqual(
        responseBody.errors[0],
        'user is not found',
        'reports user not found error',
      );
    });
  });
});
