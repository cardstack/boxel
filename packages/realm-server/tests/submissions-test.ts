import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import type { Realm, RealmAdapter } from '@cardstack/runtime-common';
import type { WebhookEventMap } from '@octokit/webhooks-types';
import { createHmac, createHash } from 'crypto';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  realmSecretSeed,
} from './helpers';
import { matrixRoomIdToBranchName } from '@cardstack/runtime-common/github-webhook';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';

module(basename(__filename), function () {
  module('Realm-specific Endpoints | _submissions', function (hooks) {
    let request: SuperTest<Test>;
    let originalWebhookSecret: string | undefined;
    const webhookSecret = 'test-webhook-secret';
    const submissionBotUsername = 'node-test_realm';
    const submissionBotPassword = passwordForRealmUser(
      submissionBotUsername,
      realmSecretSeed,
    );

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
      submissionBotMatrix: {
        username: submissionBotUsername,
        password: submissionBotPassword,
      },
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

    test('submissions endpoint accepts pull_request events', async function (assert) {
      let { roomId, branchName } = await createRoomForBranch(
        submissionBotUsername,
      );
      let payload = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Webhook test',
          url: 'https://api.github.com/repos/example/repo/pulls/42',
          html_url: 'https://github.com/example/repo/pull/42',
          state: 'open',
          merged: false,
          user: { login: 'octocat' },
          head: { ref: branchName },
          base: { ref: 'main' },
        },
      } as WebhookEventMap['pull_request'];
      let body = JSON.stringify(payload);
      let signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-GitHub-Delivery', 'test-delivery')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(body);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body.message,
        'OK',
        'returns OK response',
      );
      assert.strictEqual(response.body.branchName, branchName);
      assert.strictEqual(response.body.matrixRoomId, roomId);
    });

    test('submissions endpoint accepts pull_request_review events', async function (assert) {
      let { roomId, branchName } = await createRoomForBranch(
        submissionBotUsername,
      );
      let payload = {
        action: 'submitted',
        review: { state: 'approved' },
        pull_request: {
          number: 42,
          title: 'Webhook test',
          url: 'https://api.github.com/repos/example/repo/pulls/42',
          html_url: 'https://github.com/example/repo/pull/42',
          state: 'open',
          user: { login: 'octocat' },
          head: { ref: branchName },
          base: { ref: 'main' },
        },
      } as WebhookEventMap['pull_request_review'];
      let body = JSON.stringify(payload);
      let signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      let response = await request
        .post('/_submissions')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'pull_request_review')
        .set('X-GitHub-Delivery', 'test-delivery-review')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(body);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body.message,
        'OK',
        'returns OK response',
      );
      assert.strictEqual(response.body.branchName, branchName);
      assert.strictEqual(response.body.matrixRoomId, roomId);
    });
  });
});

function passwordForRealmUser(username: string, seed: string) {
  let cleanUsername = username.replace(/^@/, '').replace(/:.*$/, '');
  return createHash('sha256').update(cleanUsername).update(seed).digest('hex');
}

async function createRoomForBranch(username: string) {
  let matrixClient = new MatrixClient({
    matrixURL,
    username,
    seed: realmSecretSeed,
  });
  await matrixClient.login();
  let roomId = await matrixClient.createDM('@test_realm:localhost');
  let branchName = `${matrixRoomIdToBranchName(roomId)}/feature-1`;
  return { roomId, branchName };
}
