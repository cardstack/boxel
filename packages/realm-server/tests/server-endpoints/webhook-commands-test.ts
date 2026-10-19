import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('Webhook Command Endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('requires auth to add webhook command', async function (assert) {
      let response = await context.request.post('/_webhook-commands').send({});
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to list webhook commands', async function (assert) {
      let response = await context.request.get('/_webhook-commands');
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('requires auth to delete webhook command', async function (assert) {
      let response = await context.request.delete('/_webhook-commands').send({
        data: {
          type: 'webhook-command',
          id: uuidv4(),
        },
      });
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('can add webhook command for own webhook', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_test1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
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
              incomingWebhookId,
              command: 'https://example.com/webhook-handler',
              filter: {
                eventType: 'pull_request',
              },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      assert.ok(response.body.data.id, 'response includes id');
      assert.strictEqual(
        response.body.data.attributes.incomingWebhookId,
        incomingWebhookId,
        'response includes incomingWebhookId',
      );
      assert.strictEqual(
        response.body.data.attributes.command,
        'https://example.com/webhook-handler',
        'response includes command',
      );
      assert.deepEqual(
        response.body.data.attributes.filter,
        { eventType: 'pull_request' },
        'response includes filter',
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
        `SELECT id, incoming_webhook_id, command, command_filter, created_at, updated_at FROM webhook_commands`,
      );
      assert.strictEqual(rows.length, 1, 'one webhook command is persisted');
      assert.strictEqual(
        rows[0].incoming_webhook_id,
        incomingWebhookId,
        'incoming_webhook_id is persisted',
      );
      assert.strictEqual(
        rows[0].command,
        'https://example.com/webhook-handler',
        'command is persisted',
      );
    });

    test('can add webhook command with null filter', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_test2'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
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
              incomingWebhookId,
              command: 'https://example.com/webhook-handler',
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      assert.strictEqual(
        response.body.data.attributes.filter,
        null,
        'filter is null',
      );
    });

    test('rejects webhook command for another user webhook', async function (assert) {
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

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(otherMatrixUserId),
        `,`,
        param('whk_other1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
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
              incomingWebhookId,
              command: 'https://example.com/webhook-handler',
              filter: { eventType: 'push' },
            },
          },
        });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('rejects webhook command when webhook is not found', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request
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
              incomingWebhookId: uuidv4(),
              command: 'https://example.com/webhook-handler',
              filter: { eventType: 'push' },
            },
          },
        });

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });

    test('rejects webhook command with invalid incomingWebhookId', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request
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
              incomingWebhookId: 'not-a-uuid',
              command: 'https://example.com/webhook-handler',
              filter: { eventType: 'push' },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('rejects invalid command URL', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_test3'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
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
              incomingWebhookId,
              command: '   ',
              filter: { eventType: 'push' },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('lists webhook commands for authenticated user', async function (assert) {
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

      let incomingWebhookId = uuidv4();
      let otherIncomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_list1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(otherIncomingWebhookId),
        `,`,
        param(otherMatrixUserId),
        `,`,
        param('whk_list2'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(incomingWebhookId),
        `,`,
        param('https://example.com/handler-1'),
        `,`,
        `'{"eventType": "pull_request"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(otherIncomingWebhookId),
        `,`,
        param('https://example.com/handler-2'),
        `,`,
        `'{"eventType": "push"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
        .get('/_webhook-commands')
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
        response.body.data[0].attributes.incomingWebhookId,
        incomingWebhookId,
        'returns command for user webhook',
      );
    });

    test('can filter webhook commands by incomingWebhookId', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let webhookId1 = uuidv4();
      let webhookId2 = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(webhookId1),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_filter1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(webhookId2),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_filter2'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(webhookId1),
        `,`,
        param('https://example.com/handler-1'),
        `,`,
        `'{"eventType": "pull_request"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(webhookId2),
        `,`,
        param('https://example.com/handler-2'),
        `,`,
        `'{"eventType": "push"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
        .get(`/_webhook-commands?incomingWebhookId=${webhookId1}`)
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
        response.body.data[0].attributes.incomingWebhookId,
        webhookId1,
        'returns command for specified webhook',
      );
    });

    test('can delete own webhook command', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_del1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let webhookCommandId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(webhookCommandId),
        `,`,
        param(incomingWebhookId),
        `,`,
        param('https://example.com/handler'),
        `,`,
        `'{"eventType": "push"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
        .delete('/_webhook-commands')
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
            id: webhookCommandId,
          },
        });

      assert.strictEqual(response.status, 204, 'HTTP 204 status');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands WHERE id = '${webhookCommandId}'`,
      );
      assert.strictEqual(rows.length, 0, 'webhook command is deleted');
    });

    test('deleting a webhook command that does not exist succeeds', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request
        .delete('/_webhook-commands')
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
            id: uuidv4(),
          },
        });

      assert.strictEqual(response.status, 204, 'HTTP 204 status');
    });

    test('a retried delete of a webhook command answers the same as the first', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(matrixUserId),
        `,`,
        param('whk_delretry1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let webhookCommandId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(webhookCommandId),
        `,`,
        param(incomingWebhookId),
        `,`,
        param('https://example.com/handler'),
        `,`,
        `'{"eventType": "push"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let deleteCommand = () =>
        context.request
          .delete('/_webhook-commands')
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
              id: webhookCommandId,
            },
          });

      let first = await deleteCommand();
      assert.strictEqual(first.status, 204, 'first delete is HTTP 204');
      let retry = await deleteCommand();
      assert.strictEqual(retry.status, 204, 'retried delete is HTTP 204');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands WHERE id = '${webhookCommandId}'`,
      );
      assert.strictEqual(rows.length, 0, 'webhook command is deleted');
    });

    test('rejects deleting another user webhook command', async function (assert) {
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

      let incomingWebhookId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(incomingWebhookId),
        `,`,
        param(otherMatrixUserId),
        `,`,
        param('whk_delforbid1'),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let webhookCommandId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO webhook_commands (id, incoming_webhook_id, command, command_filter, created_at, updated_at) VALUES (`,
        param(webhookCommandId),
        `,`,
        param(incomingWebhookId),
        `,`,
        param('https://example.com/handler'),
        `,`,
        `'{"eventType": "push"}'::jsonb`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request
        .delete('/_webhook-commands')
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
            id: webhookCommandId,
          },
        });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands WHERE id = '${webhookCommandId}'`,
      );
      assert.strictEqual(rows.length, 1, 'webhook command preserved');
    });
  });

  // Every endpoint that names an incoming webhook by id gives the same answer
  // for the same id.
  module('Incoming webhook ids across endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);
    let matrixUserId = '@user:localhost';
    let otherMatrixUserId = '@other-user:localhost';

    function jwtFor(user: string) {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      )}`;
    }

    function send(
      request: ReturnType<typeof context.request.post>,
      body: Record<string, unknown>,
    ) {
      return request
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', jwtFor(matrixUserId))
        .send(body);
    }

    // Each endpoint, asked by `@user:localhost` about incoming webhook `id`.
    let endpoints: Record<string, (id: string) => ReturnType<typeof send>> = {
      'add a webhook command': (id) =>
        send(context.request.post('/_webhook-commands'), {
          data: {
            type: 'webhook-command',
            attributes: {
              incomingWebhookId: id,
              command: 'https://example.com/webhook-handler',
              filter: { eventType: 'push' },
            },
          },
        }),
      'delete the incoming webhook': (id) =>
        send(context.request.delete('/_incoming-webhooks'), {
          data: { type: 'incoming-webhook', id },
        }),
      "rotate the incoming webhook's signing secret": (id) =>
        send(
          context.request.post('/_incoming-webhooks/rotate-signing-secret'),
          {
            data: { type: 'incoming-webhook', id },
          },
        ),
    };

    function list(queryString: string) {
      return context.request
        .get(`/_webhook-commands${queryString ? `?${queryString}` : ''}`)
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', jwtFor(matrixUserId));
    }

    async function insertIncomingWebhook(username: string, path: string) {
      let id = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at) VALUES (`,
        param(id),
        `,`,
        param(username),
        `,`,
        param(path),
        `,`,
        param('HMAC_SHA256_HEADER'),
        `,`,
        `'{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb`,
        `,`,
        param('testsecret'),
        `,`,
        `CURRENT_TIMESTAMP`,
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);
      return id;
    }

    hooks.beforeEach(async function () {
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
    });

    test('a malformed id is a bad request to every endpoint', async function (assert) {
      let ownWebhookId = await insertIncomingWebhook(
        matrixUserId,
        'whk_malformed1',
      );

      for (let id of [
        'not-a-uuid',
        ' ',
        ` ${ownWebhookId}`,
        `${ownWebhookId} `,
      ]) {
        for (let [name, request] of Object.entries(endpoints)) {
          let response = await request(id);
          assert.strictEqual(
            response.status,
            400,
            `${name} answers 400 for id ${JSON.stringify(id)}`,
          );
          assert.deepEqual(
            response.body.errors,
            ['incomingWebhookId must be a UUID'],
            `${name} says why for id ${JSON.stringify(id)}`,
          );
        }
      }

      for (let name of Object.keys(endpoints)) {
        let response = await endpoints[name]('');
        assert.deepEqual(
          [response.status, response.body.errors],
          [400, ['incomingWebhookId is required']],
          `${name} answers 400 for an empty id`,
        );
      }

      for (let queryString of [
        `incomingWebhookId=%20${ownWebhookId}`,
        `incomingWebhookId=%20`,
        `incomingWebhookId=${ownWebhookId}&incomingWebhookId=${ownWebhookId}`,
      ]) {
        let listed = await list(queryString);
        assert.deepEqual(
          [listed.status, listed.body.errors],
          [400, ['incomingWebhookId must be a UUID']],
          `listing webhook commands answers 400 for ?${queryString}`,
        );
      }

      let webhooks = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks`,
      );
      assert.strictEqual(webhooks.length, 1, 'incoming webhook preserved');
      let commands = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands`,
      );
      assert.strictEqual(commands.length, 0, 'no webhook command added');
    });

    test('an empty incomingWebhookId lists every webhook command', async function (assert) {
      let firstWebhookId = await insertIncomingWebhook(
        matrixUserId,
        'whk_listall1',
      );
      let secondWebhookId = await insertIncomingWebhook(
        matrixUserId,
        'whk_listall2',
      );
      for (let webhookId of [firstWebhookId, secondWebhookId]) {
        let added = await endpoints['add a webhook command'](webhookId);
        assert.strictEqual(added.status, 201, 'webhook command added');
      }

      for (let queryString of ['', 'incomingWebhookId=']) {
        let listed = await list(queryString);
        assert.strictEqual(listed.status, 200, `?${queryString} is HTTP 200`);
        assert.deepEqual(
          listed.body.data
            .map((command: any) => command.attributes.incomingWebhookId)
            .sort(),
          [firstWebhookId, secondWebhookId].sort(),
          `?${queryString} lists the commands of every webhook`,
        );
      }
    });

    test("another user's webhook is forbidden to every endpoint", async function (assert) {
      let foreignWebhookId = await insertIncomingWebhook(
        otherMatrixUserId,
        'whk_foreign1',
      );

      for (let [name, request] of Object.entries(endpoints)) {
        let response = await request(foreignWebhookId);
        assert.strictEqual(response.status, 403, `${name} answers 403`);
        assert.deepEqual(
          response.body.errors,
          ['incoming webhook belongs to a different user'],
          `${name} says why`,
        );
      }

      let webhooks = await context.dbAdapter.execute(
        `SELECT id FROM incoming_webhooks WHERE id = '${foreignWebhookId}'`,
      );
      assert.strictEqual(webhooks.length, 1, 'incoming webhook preserved');
      let commands = await context.dbAdapter.execute(
        `SELECT id FROM webhook_commands`,
      );
      assert.strictEqual(commands.length, 0, 'no webhook command added');
    });

    test('a webhook that does not exist is not found the same way, except to a delete', async function (assert) {
      let missingWebhookId = uuidv4();

      for (let name of [
        'add a webhook command',
        "rotate the incoming webhook's signing secret",
      ]) {
        let response = await endpoints[name](missingWebhookId);
        assert.strictEqual(response.status, 404, `${name} answers 404`);
        assert.deepEqual(
          response.body.errors,
          ['incoming webhook is not found'],
          `${name} says why`,
        );
      }

      let deleted =
        await endpoints['delete the incoming webhook'](missingWebhookId);
      assert.strictEqual(deleted.status, 204, 'a delete succeeds');
    });
  });
});
