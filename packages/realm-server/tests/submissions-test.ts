import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import type { Realm, RealmAdapter } from '@cardstack/runtime-common';
import { createHmac } from 'crypto';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
} from './helpers';

module(basename(__filename), function () {
  module('Realm-specific Endpoints | _submissions', function (hooks) {
    let request: SuperTest<Test>;
    let originalWebhookSecret: string | undefined;
    const webhookSecret = 'test-webhook-secret';

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      testRealmAdapter: RealmAdapter;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      request = args.request;
    }

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read'],
      },
      onRealmSetup,
    });

    hooks.beforeEach(function () {
      originalWebhookSecret = process.env.CATALOG_WEBHOOK_SECRET;
      process.env.CATALOG_WEBHOOK_SECRET = webhookSecret;
    });

    hooks.afterEach(function () {
      if (originalWebhookSecret === undefined) {
        delete process.env.CATALOG_WEBHOOK_SECRET;
      } else {
        process.env.CATALOG_WEBHOOK_SECRET = originalWebhookSecret;
      }
    });

    test('submissions endpoint returns 500 when webhook secret is missing', async function (assert) {
      process.env.CATALOG_WEBHOOK_SECRET = '';
      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send('{}');

      assert.strictEqual(response.status, 500, 'HTTP 500 status');
      assert.strictEqual(
        response.body.message,
        'Webhook secret not configured',
        'returns missing secret error',
      );
    });

    test('submissions endpoint rejects invalid signatures', async function (assert) {
      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-Hub-Signature-256', 'sha256=invalid')
        .send('{}');

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.strictEqual(
        response.body.message,
        'Unauthorized',
        'returns unauthorized error',
      );
    });

    test('submissions endpoint requires a webhook event header', async function (assert) {
      let body = JSON.stringify({ action: 'opened' });
      let signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(body);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(
        response.body.message,
        'Missing webhook event header',
        'returns missing event header error',
      );
    });

    test('submissions endpoint rejects invalid JSON', async function (assert) {
      let body = '{not-json}';
      let signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(body);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(
        response.body.message,
        'Invalid JSON body',
        'returns invalid JSON error',
      );
    });

    test('submissions endpoint rejects unsupported webhook events', async function (assert) {
      let body = JSON.stringify({ action: 'opened' });
      let signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'push')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(body);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(
        response.body.message,
        'Unsupported webhook event',
        'returns unsupported event error',
      );
    });
  });
});
