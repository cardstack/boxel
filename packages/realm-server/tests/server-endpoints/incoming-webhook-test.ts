import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { createHmac } from 'crypto';
import {
  realmSecretSeed,
  insertUser,
  setupSecretsKeyring,
} from '../helpers/index.ts';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers.ts';
import {
  INCOMING_WEBHOOK_SECRET_COLUMNS,
  incomingWebhookSecretBinding,
} from '../../lib/incoming-webhook-secrets.ts';
import {
  sealedFromColumns,
  secretsKeyring,
} from '../../lib/secrets-at-rest/index.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('Incoming Webhook Endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);
    setupSecretsKeyring(hooks);

    function jwtFor(user: string) {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      )}`;
    }

    async function createWebhook(user: string) {
      let response = await context.request
        .post('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwtFor(user))
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
      return response.body.data;
    }

    function rotate(user: string, id: string) {
      return context.request
        .post('/_incoming-webhooks/rotate-signing-secret')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwtFor(user))
        .send({ data: { type: 'incoming-webhook', id } });
    }

    function deleteWebhook(user: string, id: string) {
      return context.request
        .delete('/_incoming-webhooks')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwtFor(user))
        .send({ data: { type: 'incoming-webhook', id } });
    }

    function deliver(webhookPath: string, signingSecret: string) {
      let payload = JSON.stringify({ event: 'push' });
      return context.request
        .post(`/_webhooks/${webhookPath}`)
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          'sha256=' +
            createHmac('sha256', signingSecret)
              .update(payload, 'utf8')
              .digest('hex'),
        )
        .send(payload);
    }

    test('requires auth to create incoming webhook', async function (assert) {
      let response = await context.request.post('/_incoming-webhooks').send({});
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to list incoming webhooks', async function (assert) {
      let response = await context.request.get('/_incoming-webhooks');
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to delete incoming webhook', async function (assert) {
      let response = await context.request.delete('/_incoming-webhooks').send({
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

      let response = await context.request
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
        response.body.data.attributes.signingSecretCreatedAt,
        'response includes when the secret was issued',
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
        `SELECT id, username, webhook_path, verification_type, verification_config, created_at, updated_at FROM incoming_webhooks`,
      );
      assert.strictEqual(rows.length, 1, 'one incoming webhook is persisted');
      assert.ok(rows[0].id, 'id is persisted');
      assert.strictEqual(
        rows[0].username,
        matrixUserId,
        'username is persisted',
      );
      assert.ok(rows[0].webhook_path, 'webhook_path is persisted');

      let [secretRow] = await context.dbAdapter.execute(
        `SELECT id, username, ${INCOMING_WEBHOOK_SECRET_COLUMNS} FROM incoming_webhooks`,
      );
      assert.strictEqual(
        secretsKeyring().open(
          sealedFromColumns(secretRow, 'signing_secret')!,
          incomingWebhookSecretBinding({
            id: String(secretRow.id),
            username: matrixUserId,
          }),
        ),
        response.body.data.attributes.signingSecret,
        'the secret is sealed under its field, its owner and its id',
      );
    });

    test('rejects unsupported verificationType', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request
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

      let response = await context.request
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

      let response = await context.request
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
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, created_at, updated_at) VALUES (`,
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
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, created_at, updated_at) VALUES (`,
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
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
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
      assert.false(
        'signingSecret' in response.body.data[0].attributes,
        'a read never returns the secret',
      );
      assert.ok(
        response.body.data[0].attributes.signingSecretCreatedAt,
        'a read reports when the secret was issued',
      );
    });

    test('a webhook created through the API is listed without its secret', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );
      let created = await createWebhook(matrixUserId);

      let response = await context.request
        .get('/_incoming-webhooks')
        .set('Authorization', jwtFor(matrixUserId));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let [listed] = response.body.data;
      assert.strictEqual(listed.id, created.id);
      assert.false('signingSecret' in listed.attributes);
      assert.strictEqual(
        listed.attributes.signingSecretCreatedAt,
        created.attributes.signingSecretCreatedAt,
      );
      assert.false(
        JSON.stringify(response.body).includes(
          created.attributes.signingSecret,
        ),
        'the secret appears nowhere in the response',
      );
    });

    test('rotating a signing secret returns a new one once, and the old one stops verifying', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );
      let created = await createWebhook(matrixUserId);
      let { webhookPath, signingSecret: oldSecret } = created.attributes;
      assert.strictEqual(
        (await deliver(webhookPath, oldSecret)).status,
        200,
        'the issued secret verifies',
      );

      let response = await rotate(matrixUserId, created.id);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let rotated = response.body.data;
      assert.strictEqual(rotated.id, created.id);
      assert.strictEqual(rotated.attributes.webhookPath, webhookPath);
      let newSecret = rotated.attributes.signingSecret;
      assert.strictEqual(newSecret.length, 64, 'a new 64-hex-char secret');
      assert.notStrictEqual(newSecret, oldSecret);
      assert.ok(rotated.attributes.signingSecretCreatedAt);

      assert.strictEqual(
        (await deliver(webhookPath, oldSecret)).status,
        401,
        'the old secret stops verifying',
      );
      assert.strictEqual(
        (await deliver(webhookPath, newSecret)).status,
        200,
        'the new secret verifies',
      );

      let listed = await context.request
        .get('/_incoming-webhooks')
        .set('Authorization', jwtFor(matrixUserId));
      assert.false('signingSecret' in listed.body.data[0].attributes);
      assert.strictEqual(
        listed.body.data[0].attributes.signingSecretCreatedAt,
        rotated.attributes.signingSecretCreatedAt,
        'reads report when the rotated secret was issued',
      );

      let [row] = await context.dbAdapter.execute(
        `SELECT id, username, ${INCOMING_WEBHOOK_SECRET_COLUMNS} FROM incoming_webhooks`,
      );
      assert.strictEqual(
        secretsKeyring().open(
          sealedFromColumns(row, 'signing_secret')!,
          incomingWebhookSecretBinding({
            id: created.id,
            username: matrixUserId,
          }),
        ),
        newSecret,
        'the new secret is sealed',
      );
    });

    test('requires auth to rotate a signing secret', async function (assert) {
      let response = await context.request
        .post('/_incoming-webhooks/rotate-signing-secret')
        .send({ data: { type: 'incoming-webhook', id: uuidv4() } });
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test("rejects rotating another user's signing secret", async function (assert) {
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
      let created = await createWebhook(matrixUserId);

      let response = await rotate(otherMatrixUserId, created.id);

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.strictEqual(
        (
          await deliver(
            created.attributes.webhookPath,
            created.attributes.signingSecret,
          )
        ).status,
        200,
        "the owner's secret still verifies",
      );
    });

    test('rotating the secret of a webhook that does not exist is not found', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await rotate(matrixUserId, uuidv4());
      assert.strictEqual(response.status, 404, 'HTTP 404 status');

      let invalid = await rotate(matrixUserId, 'not-a-uuid');
      assert.strictEqual(invalid.status, 400, 'HTTP 400 for a non-UUID id');
    });

    test('can delete own incoming webhook', async function (assert) {
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

      let webhookId = createResponse.body.data.id;

      let deleteResponse = await context.request
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

      let createResponse = await context.request
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

      let deleteResponse = await context.request
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

    test('a webhook id that is not a UUID is a bad request to delete and to rotate', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );
      await createWebhook(matrixUserId);

      for (let id of ['not-a-uuid', ' ']) {
        let deleted = await deleteWebhook(matrixUserId, id);
        assert.strictEqual(
          deleted.status,
          400,
          `delete answers 400 for id ${JSON.stringify(id)}`,
        );

        let rotated = await rotate(matrixUserId, id);
        assert.strictEqual(
          rotated.status,
          400,
          `rotate answers 400 for id ${JSON.stringify(id)}`,
        );
      }

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks`,
      );
      assert.strictEqual(rows.length, 1, 'incoming webhook preserved');
    });

    test('deleting a webhook that does not exist succeeds', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await deleteWebhook(matrixUserId, uuidv4());
      assert.strictEqual(response.status, 204, 'HTTP 204 status');
    });

    test('deleting incoming webhook cascades to webhook commands', async function (assert) {
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

      let deleteResponse = await context.request
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
