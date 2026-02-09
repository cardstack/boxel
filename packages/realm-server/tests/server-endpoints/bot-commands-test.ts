import { module, test } from 'qunit';
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm Server Endpoints', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('requires auth to add bot command', async function (assert) {
      let response = await context.request2.post('/_bot-commands').send({});
      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('can add bot command for registered bot', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: botRegistrationId,
              command: 'https://example.com/bot/command/default',
              filter: {
                type: 'matrix-event',
                event_type: 'app.boxel.bot-trigger',
                content_type: 'create-listing-pr',
              },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      assert.strictEqual(
        response.body.data.attributes.botId,
        botRegistrationId,
        'response includes botId',
      );
      assert.strictEqual(
        response.body.data.attributes.command,
        'https://example.com/bot/command/default',
        'response includes command',
      );
      assert.deepEqual(
        response.body.data.attributes.filter,
        {
          type: 'matrix-event',
          event_type: 'app.boxel.bot-trigger',
          content_type: 'create-listing-pr',
        },
        'response includes filter',
      );
      assert.ok(response.body.data.id, 'response includes id');
      assert.ok(
        response.body.data.attributes.createdAt,
        'response includes createdAt',
      );

      let rows = await context.dbAdapter.execute(
        `SELECT id, bot_id, command, command_filter, created_at FROM bot_commands`,
      );
      assert.strictEqual(rows.length, 1, 'one bot command is persisted');
      assert.ok(rows[0].id, 'id is persisted');
      assert.strictEqual(
        rows[0].bot_id,
        botRegistrationId,
        'bot_id is persisted',
      );
      assert.strictEqual(
        rows[0].command,
        'https://example.com/bot/command/default',
        'command is persisted',
      );
      assert.deepEqual(
        rows[0].command_filter,
        {
          type: 'matrix-event',
          event_type: 'app.boxel.bot-trigger',
          content_type: 'create-listing-pr',
        },
        'filter is persisted',
      );
      assert.ok(rows[0].created_at, 'created_at is persisted');
    });

    test('rejects bot command for a different user', async function (assert) {
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

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(otherMatrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: botRegistrationId,
              command: 'https://example.com/bot/command/default',
              filter: {
                type: 'matrix-event',
                event_type: 'app.boxel.bot-trigger',
                content_type: 'create-listing-pr',
              },
            },
          },
        });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('rejects bot command when bot registration is missing', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: uuidv4(),
              command: 'https://example.com/bot/command/default',
              filter: {
                type: 'matrix-event',
                event_type: 'app.boxel.bot-trigger',
                content_type: 'create-listing-pr',
              },
            },
          },
        });

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });

    test('rejects invalid command', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: botRegistrationId,
              command: '   ',
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('rejects missing command or filter', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let baseRequest = context.request2
        .post('/_bot-commands')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        );

      let missingCommandResponse = await baseRequest.send({
        data: {
          type: 'bot-command',
          attributes: {
            botId: botRegistrationId,
            filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'create-listing-pr',
            },
          },
        },
      });
      assert.strictEqual(
        missingCommandResponse.status,
        400,
        'HTTP 400 status for missing command',
      );

      let missingFilterResponse = await baseRequest.send({
        data: {
          type: 'bot-command',
          attributes: {
            botId: botRegistrationId,
            command: 'https://example.com/bot/command/default',
          },
        },
      });
      assert.strictEqual(
        missingFilterResponse.status,
        400,
        'HTTP 400 status for missing filter',
      );
    });

    test('rejects unsupported filter', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: botRegistrationId,
              command: 'https://example.com/bot/command/default',
              filter: {
                type: 'matrix-event',
                event_type: 'app.boxel.bot-trigger',
                content_type: 'unsupported',
              },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('rejects non-matrix filter type', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let response = await context.request2
        .post('/_bot-commands')
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
            type: 'bot-command',
            attributes: {
              botId: botRegistrationId,
              command: 'https://example.com/bot/command/default',
              filter: {
                type: 'http-event',
                event_type: 'app.boxel.bot-trigger',
                content_type: 'create-listing-pr',
              },
            },
          },
        });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('deletes bot commands when bot registration is removed', async function (assert) {
      let matrixUserId = '@user:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_123',
        'user@example.com',
      );

      let botRegistrationId = uuidv4();
      await query(context.dbAdapter, [
        `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
        param(botRegistrationId),
        `,`,
        param(matrixUserId),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      await query(context.dbAdapter, [
        `INSERT INTO bot_commands (id, bot_id, command, command_filter, created_at) VALUES (`,
        param(uuidv4()),
        `,`,
        param(botRegistrationId),
        `,`,
        param('https://example.com/bot/command/default'),
        `,`,
        param({
          type: 'matrix-event',
          event_type: 'app.boxel.bot-trigger',
          content_type: 'create-listing-pr',
        }),
        `,`,
        `CURRENT_TIMESTAMP`,
        `)`,
      ]);

      let deleteResponse = await context.request2
        .delete('/_bot-registration')
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
            type: 'bot-registration',
            id: botRegistrationId,
          },
        });

      assert.strictEqual(deleteResponse.status, 204, 'HTTP 204 status');

      let rows = await context.dbAdapter.execute(
        `SELECT id FROM bot_commands WHERE bot_id = '${botRegistrationId}'`,
      );
      assert.strictEqual(
        rows.length,
        0,
        'bot commands are deleted with registration',
      );
    });
  });
});
