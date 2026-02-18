import { module, test } from 'qunit';
import { basename } from 'path';
import { createHmac } from 'crypto';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Webhook Receiver Endpoint', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('returns 404 for unknown webhook path', async function (assert) {
      let response = await context.request2
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

      let createResponse = await context.request2
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

      let response = await context.request2
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

      let createResponse = await context.request2
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

      let response = await context.request2
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        response.body,
        { status: 'received' },
        'response indicates receipt',
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

      let createResponse = await context.request2
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

      let response = await context.request2
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

      let response = await context.request2
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

      let createResponse = await context.request2
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
      let response = await context.request2
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
  });
});
