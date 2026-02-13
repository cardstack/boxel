import { module, test } from 'qunit';
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Incoming Webhook Endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('requires auth to create incoming webhook', async function (assert) {
      let response = await context.request2
        .post('/_incoming-webhooks')
        .send({});
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to list incoming webhooks', async function (assert) {
      let response = await context.request2.get('/_incoming-webhooks');
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to delete incoming webhook', async function (assert) {
      let response = await context.request2.delete('/_incoming-webhooks').send({
        data: {
          type: 'incoming-webhook',
          id: uuidv4(),
        },
      });
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('can create incoming webhook', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request2
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

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      assert.ok(response.body.data.id, 'response includes id');
      assert.strictEqual(
        response.body.data.attributes.username,
        matrixUserId,
        'response includes username',
      );
      assert.ok(
        response.body.data.attributes.webhookPath,
        'response includes webhookPath',
      );
      assert.ok(
        response.body.data.attributes.webhookPath.startsWith('whk_'),
        'webhookPath starts with whk_',
      );
      assert.strictEqual(
        response.body.data.attributes.verificationType,
        'HMAC_SHA256_HEADER',
        'response includes verificationType',
      );
      assert.deepEqual(
        response.body.data.attributes.verificationConfig,
        { header: 'X-Hub-Signature-256', encoding: 'hex' },
        'response includes verificationConfig',
      );
      assert.ok(
        response.body.data.attributes.signingSecret,
        'response includes signingSecret',
      );
      assert.strictEqual(
        response.body.data.attributes.signingSecret.length,
        64,
        'signingSecret is 64 hex chars',
      );
      assert.ok(
        response.body.data.attributes.createdAt,
        'response includes createdAt',
      );
      assert.ok(
        response.body.data.attributes.updatedAt,
        'response includes updatedAt',
      );

      let rows = await context.dbAdapter.execute(
        `SELECT id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at FROM incoming_webhooks`,
      );
      assert.strictEqual(rows.length, 1, 'one incoming webhook is persisted');
      assert.ok(rows[0].id, 'id is persisted');
      assert.strictEqual(
        rows[0].username,
        matrixUserId,
        'username is persisted',
      );
      assert.ok(rows[0].webhook_path, 'webhook_path is persisted');
      assert.ok(rows[0].signing_secret, 'signing_secret is persisted');
    });

    test('rejects unsupported verificationType', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request2
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
              verificationType: 'UNSUPPORTED_TYPE',
              verificationConfig: {
                header: 'X-Custom-Header',
                encoding: 'hex',
              },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('rejects missing verificationConfig header', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request2
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
                encoding: 'hex',
              },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('rejects invalid verificationConfig encoding', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request2
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
                encoding: 'invalid',
              },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('lists incoming webhooks for authenticated user only', async function (assert) {
      let matrixUserId = '@user:localhost';
      let otherMatrixUserId = '@other-user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );
      await insertUser(
        context.dbAdapter,
        otherMatrixUserId,
        'cus_124',
        'other@example.com',
      );

      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_user1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('secret1'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(otherMatrixUserId),
        `,`,
        param('whk_other1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('secret2'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .get('/_incoming-webhooks')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'returns one row');
      assert.strictEqual(
        response.body.data[0].attributes.username,
        matrixUserId,
        'returns webhook for authenticated user',
      );
    });

    test('can delete own incoming webhook', async function (assert) {
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

      let webhookId = createResponse.body.data.id;

      let deleteResponse = await context.request2
        .delete('/_incoming-webhooks')
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
            id: webhookId,
          },
        });

      assert.strictEqual(deleteResponse.status, 204, 'HTTP 204 status');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks`,
      );
      assert.strictEqual(rows.length, 0, 'incoming webhook removed');
    });

    test('rejects deletion of another user incoming webhook', async function (assert) {
      let ownerUserId = '@user:localhost';
      let otherUserId = '@other-user:localhost';
      await insertUser(
        context.dbAdapter,
        ownerUserId,
        'cus_123',
        'user@example.com',
      );
      await insertUser(
        context.dbAdapter,
        otherUserId,
        'cus_124',
        'other@example.com',
      );

      let createResponse = await context.request2
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: ownerUserId, sessionRoom: 'session-room-test' },
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

      let webhookId = createResponse.body.data.id;

      let deleteResponse = await context.request2
        .delete('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: otherUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'incoming-webhook',
            id: webhookId,
          },
        });

      assert.strictEqual(deleteResponse.status, 403, 'HTTP 403 status');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks`,
      );
      assert.strictEqual(rows.length, 1, 'incoming webhook preserved');
    });

    test('deleting incoming webhook cascades to webhook commands', async function (assert) {
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

      let webhookId = createResponse.body.data.id;

      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(webhookId),
        `,`,
        param('https://example.com/webhook-handler'),
        `,`,
        `'{"eventType": "pull_request"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let deleteResponse = await context.request2
        .delete('/_incoming-webhooks')
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
            id: webhookId,
          },
        });

      assert.strictEqual(deleteResponse.status, 204, 'HTTP 204 status');

      let webhookRows = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks`,
      );
      assert.strictEqual(webhookRows.length, 0, 'incoming webhook removed');

      let commandRows = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands`,
      );
      assert.strictEqual(
        commandRows.length,
        0,
        'webhook commands cascaded on delete',
      );
    });
  });
});
