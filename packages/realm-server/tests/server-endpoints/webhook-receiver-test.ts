import { module, test } from 'qunit';
import { basename } from 'path';
import { createHmac } from 'crypto';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers';
import {
  extractRealmFromPrBody,
  extractPrNumberFromPayload,
} from '../../handlers/webhook-filter-handlers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Webhook Receiver Endpoint', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('returns 404 for unknown webhook path', async function (assert) {
      let response = await context.request
        .post('/_webhooks/whk_nonexistent')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: 'test' }));

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });

    test('returns 401 for invalid HMAC signature', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let createResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookPath = createResponse.body.data.attributes.webhookPath;

      let payload = JSON.stringify({ event: 'push', ref: 'refs/heads/main' });

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha256=invalidsignature')
        .send(payload);

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('returns 200 for valid HMAC_SHA256_HEADER signature with hex encoding', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let createResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookPath = createResponse.body.data.attributes.webhookPath;
      let signingSecret = createResponse.body.data.attributes.signingSecret;

      let payload = JSON.stringify({ event: 'push', ref: 'refs/heads/main' });
      let signature =
        'sha256=' +
        createHmac('sha256', signingSecret)
          .update(payload, 'utf8')
          .digest('hex');

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        response.body,
        { status: 'received', commandsExecuted: 0 },
        'response indicates receipt with no commands executed',
      );
    });

    test('returns 200 for valid signature with base64 encoding', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let createResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Shopify-Hmac-SHA256',
                encoding: 'base64',
              },
            },
          },
        });

      let webhookPath = createResponse.body.data.attributes.webhookPath;
      let signingSecret = createResponse.body.data.attributes.signingSecret;

      let payload = JSON.stringify({
        event: 'order_created',
        id: 12345,
      });
      let signature = createHmac('sha256', signingSecret)
        .update(payload, 'utf8')
        .digest('base64');

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-SHA256', signature)
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
    });

    test('returns 401 when signature header is missing', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let webhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(webhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_noheader'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret123'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let payload = JSON.stringify({ event: 'test' });

      let response = await context.request
        .post('/_webhooks/whk_noheader')
        .set('Content-Type', 'application/json')
        .send(payload);

      assert.strictEqual(
        response.status,
        401,
        'HTTP 401 when signature header is missing',
      );
    });

    test('is a public endpoint (no JWT required)', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let createResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookPath = createResponse.body.data.attributes.webhookPath;
      let signingSecret = createResponse.body.data.attributes.signingSecret;

      let payload = JSON.stringify({ test: true });
      let signature =
        'sha256=' +
        createHmac('sha256', signingSecret)
          .update(payload, 'utf8')
          .digest('hex');

      // No Authorization header set - this should still work
      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload);

      // Should be 200 (not 401 from JWT middleware)
      assert.strictEqual(
        response.status,
        200,
        'webhook receiver does not require JWT',
      );
    });

    test('executes webhook command when signature is valid', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      // Create webhook
      let createWebhookResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookId = createWebhookResponse.body.data.id;
      let webhookPath = createWebhookResponse.body.data.attributes.webhookPath;
      let signingSecret =
        createWebhookResponse.body.data.attributes.signingSecret;

      // Register webhook command
      await context.request
        .post('/_webhook-commands')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'webhook-command',
            attributes: {
              incomingWebhookId: webhookId,
              command: `http://test-realm/commands/process-github-event`,
              filter: null,
            },
          },
        });

      // Send webhook with valid signature
      let payload = JSON.stringify({
        action: 'opened',
        pull_request: { number: 123 },
      });
      let signature =
        'sha256=' +
        createHmac('sha256', signingSecret)
          .update(payload, 'utf8')
          .digest('hex');

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .set('X-GitHub-Event', 'pull_request')
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body.status,
        'received',
        'webhook was received',
      );
      assert.strictEqual(
        response.body.commandsExecuted,
        1,
        'command was enqueued for execution',
      );
    });

    test('filters commands by event type', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      // Create webhook
      let createWebhookResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookId = createWebhookResponse.body.data.id;
      let webhookPath = createWebhookResponse.body.data.attributes.webhookPath;
      let signingSecret =
        createWebhookResponse.body.data.attributes.signingSecret;

      // Register command filtered to 'push' events only
      await context.request
        .post('/_webhook-commands')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'webhook-command',
            attributes: {
              incomingWebhookId: webhookId,
              command: `http://test-realm/commands/process-github-event`,
              filter: { type: 'github-event', eventType: 'push' },
            },
          },
        });

      // Send 'pull_request' event (should NOT execute command)
      let payload = JSON.stringify({
        action: 'opened',
        pull_request: { number: 123 },
      });
      let signature =
        'sha256=' +
        createHmac('sha256', signingSecret)
          .update(payload, 'utf8')
          .digest('hex');

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .set('X-GitHub-Event', 'pull_request')
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body.commandsExecuted,
        0,
        'command was filtered out by event type',
      );
    });

    test('command matched by eventType filter is pending execution', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let jwt = `Bearer ${createRealmServerJWT(
        { user: matrixUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      )}`;

      let createWebhookResponse = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwt)
        .send({
          data: {
            type: 'incoming-webhook',
            attributes: {
              verificationType: 'HMAC_SHA256_HEADER',
              verificationConfig: {
                header: 'X-Hub-Signature-256',
                encoding: 'hex',
              },
            },
          },
        });

      let webhookId = createWebhookResponse.body.data.id;
      let webhookPath = createWebhookResponse.body.data.attributes.webhookPath;
      let signingSecret =
        createWebhookResponse.body.data.attributes.signingSecret;

      // Register command with roomId and realm in filter
      await context.request
        .post('/_webhook-commands')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwt)
        .send({
          data: {
            type: 'webhook-command',
            attributes: {
              incomingWebhookId: webhookId,
              command: `http://test-realm/commands/process-github-event`,
              filter: {
                type: 'github-event',
                eventType: 'pull_request',
                roomId: '!room:localhost',
                realm: 'http://localhost:4201/submissions/',
              },
            },
          },
        });

      let payload = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: 42,
          html_url: 'https://github.com/test/repo/pull/42',
        },
        sender: { login: 'testuser' },
      });
      let signature =
        'sha256=' +
        createHmac('sha256', signingSecret)
          .update(payload, 'utf8')
          .digest('hex');

      let response = await context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .set('X-GitHub-Event', 'pull_request')
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.body.commandsExecuted,
        1,
        'command was enqueued for execution',
      );
    });
  });

  module('extractRealmFromPrBody', function () {
    test('extracts realm from production Submission Card URL', function (assert) {
      let body = [
        '## Summary',
        'Some description',
        '---',
        '- Listing Name: Recipe Card Definition',
        '- Room ID: `!IUlOGgAWjwfwemOykG:boxel.ai`',
        '- User ID: `@richard.tan:boxel.ai`',
        '- Number of Files: 1',
        '- Submission Card: [https://app.boxel.ai/richard.tan/ric-test-1/SubmissionCard/f0028a1c-777a-4d34-9f93-8f02667484d5](https://app.boxel.ai/richard.tan/ric-test-1/SubmissionCard/f0028a1c-777a-4d34-9f93-8f02667484d5)',
      ].join('\n');

      assert.strictEqual(
        extractRealmFromPrBody(body),
        'https://app.boxel.ai/richard.tan/ric-test-1/',
      );
    });

    test('extracts realm from staging Submission Card URL', function (assert) {
      let body = [
        '## Summary',
        '- Submission Card: [https://realms-staging.stack.cards/chuan16/pure-creativity/SubmissionCard/01166122-d67f-4950-a708-b451564b30cb](https://realms-staging.stack.cards/chuan16/pure-creativity/SubmissionCard/01166122-d67f-4950-a708-b451564b30cb)',
      ].join('\n');

      assert.strictEqual(
        extractRealmFromPrBody(body),
        'https://realms-staging.stack.cards/chuan16/pure-creativity/',
      );
    });

    test('extracts realm from local Submission Card URL', function (assert) {
      let body = [
        '## Summary',
        '- Submission Card: [http://localhost:4201/experiments/SubmissionCard/5e3c8a93-24b1-4143-958a-a65270110c52](http://localhost:4201/experiments/SubmissionCard/5e3c8a93-24b1-4143-958a-a65270110c52)',
      ].join('\n');

      assert.strictEqual(
        extractRealmFromPrBody(body),
        'http://localhost:4201/experiments/',
      );
    });

    test('returns null when no Submission Card line exists', function (assert) {
      let body = '## Summary\nSome PR description without submission card';
      assert.strictEqual(extractRealmFromPrBody(body), null);
    });

    test('returns null for null/undefined body', function (assert) {
      assert.strictEqual(extractRealmFromPrBody(null), null);
      assert.strictEqual(extractRealmFromPrBody(undefined), null);
    });
  });

  module('extractPrNumberFromPayload', function () {
    test('extracts PR number from pull_request event', function (assert) {
      assert.strictEqual(
        extractPrNumberFromPayload({
          action: 'opened',
          pull_request: { number: 296, body: '...' },
        }),
        296,
      );
    });

    test('extracts PR number from check_run event', function (assert) {
      assert.strictEqual(
        extractPrNumberFromPayload({
          action: 'completed',
          check_run: {
            pull_requests: [{ number: 42 }],
          },
        }),
        42,
      );
    });

    test('extracts PR number from check_suite event', function (assert) {
      assert.strictEqual(
        extractPrNumberFromPayload({
          action: 'completed',
          check_suite: {
            pull_requests: [{ number: 99 }],
          },
        }),
        99,
      );
    });

    test('returns null when no PR number found', function (assert) {
      assert.strictEqual(
        extractPrNumberFromPayload({ action: 'created', comment: {} }),
        null,
      );
    });
  });
});
