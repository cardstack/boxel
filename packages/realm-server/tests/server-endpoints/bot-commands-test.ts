import { module, test } from 'qunit';
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { param, query, uuidv4 } from '@cardstack/runtime-common';
import { setupServerEndpointsTest } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let context = setupServerEndpointsTest(hooks);

      test('requires auth to create bot commands', async function (assert) {
        let response = await context.request2.post('/_bot-command').send({});
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('requires auth to list bot commands', async function (assert) {
        let response = await context.request2.get('/_bot-commands');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('requires auth to delete bot commands', async function (assert) {
        let response = await context.request2
          .delete('/_bot-command')
          .send({
            data: {
              type: 'bot-command',
              id: 'bot-command-1',
              attributes: {
                botId: 'bot-reg-1',
              },
            },
          });
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('can create bot command for a bot', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let botId = await insertBotRegistration(context, matrixUserId);

        let response = await context.request2
          .post('/_bot-command')
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
                botId,
                command: 'app.boxel.search-google-images',
                filter: { type: 'app.boxel.search-google-images' },
              },
            },
          });

        assert.strictEqual(response.status, 201, 'HTTP 201 status');
        assert.strictEqual(
          response.body.data.attributes.botId,
          botId,
          'response includes botId',
        );
        assert.strictEqual(
          response.body.data.attributes.command,
          'app.boxel.search-google-images',
          'response includes command',
        );
        assert.strictEqual(
          response.body.data.attributes.filter?.type,
          'app.boxel.search-google-images',
          'response includes filter',
        );
        assert.ok(response.body.data.id, 'response includes id');
        assert.ok(
          response.body.data.attributes.createdAt,
          'response includes createdAt',
        );

        let rows = await context.dbAdapter.execute(
          `SELECT id, bot_id, command, filter, created_at FROM bot_commands`,
        );
        assert.strictEqual(rows.length, 1, 'one bot command is persisted');
        assert.ok(rows[0].id, 'id is persisted');
        assert.strictEqual(rows[0].bot_id, botId, 'bot_id is persisted');
        assert.strictEqual(
          rows[0].command,
          'app.boxel.search-google-images',
          'command is persisted',
        );
      });

      test('rejects creating command for a different user', async function (assert) {
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

        let botId = await insertBotRegistration(context, ownerUserId);

        let response = await context.request2
          .post('/_bot-command')
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
              type: 'bot-command',
              attributes: {
                botId,
                command: 'app.boxel.search-google-images',
                filter: { type: 'app.boxel.search-google-images' },
              },
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');

        let rows = await context.dbAdapter.execute(
          `SELECT id FROM bot_commands`,
        );
        assert.strictEqual(rows.length, 0, 'no bot command created');
      });

      test('lists bot commands for a bot', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let botId = await insertBotRegistration(context, matrixUserId);
        await insertBotCommand(context, botId, 'app.boxel.search-google-images');

        let response = await context.request2
          .get(`/_bot-commands?botId=${encodeURIComponent(botId)}`)
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: matrixUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.body.data.length, 1, 'returns one command');
        assert.strictEqual(
          response.body.data[0].attributes.command,
          'app.boxel.search-google-images',
          'returns command',
        );
      });

      test('rejects listing commands for a different user', async function (assert) {
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

        let botId = await insertBotRegistration(context, ownerUserId);

        let response = await context.request2
          .get(`/_bot-commands?botId=${encodeURIComponent(botId)}`)
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: otherUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('can delete bot command for a bot', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let botId = await insertBotRegistration(context, matrixUserId);
        let botCommandId = await insertBotCommand(
          context,
          botId,
          'app.boxel.search-google-images',
        );

        let response = await context.request2
          .delete('/_bot-command')
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
              id: botCommandId,
              attributes: {
                botId,
              },
            },
          });

        assert.strictEqual(response.status, 204, 'HTTP 204 status');

        let rows = await context.dbAdapter.execute(
          `SELECT id FROM bot_commands`,
        );
        assert.strictEqual(rows.length, 0, 'bot command removed');
      });
    },
  );
});

async function insertBotRegistration(
  context: ReturnType<typeof setupServerEndpointsTest>,
  username: string,
): Promise<string> {
  let id = uuidv4();
  await query(context.dbAdapter, [
    `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
    param(id),
    `,`,
    param(username),
    `,`,
    `CURRENT_TIMESTAMP`,
    `)`,
  ]);
  return id;
}

async function insertBotCommand(
  context: ReturnType<typeof setupServerEndpointsTest>,
  botId: string,
  command: string,
): Promise<string> {
  let id = uuidv4();
  await query(context.dbAdapter, [
    `INSERT INTO bot_commands (id, bot_id, command, filter, created_at) VALUES (`,
    param(id),
    `,`,
    param(botId),
    `,`,
    param(command),
    `,`,
    param(JSON.stringify({ type: command })),
    `,`,
    `CURRENT_TIMESTAMP`,
    `)`,
  ]);
  return id;
}
