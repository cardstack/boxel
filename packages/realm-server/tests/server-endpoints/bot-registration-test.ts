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

      test('requires auth to register bot', async function (assert) {
        let response = await context.request2
          .post('/_bot-registration')
          .send({});
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('requires auth to list bot registrations', async function (assert) {
        let response = await context.request2.get('/_bot-registrations');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('requires auth to unregister bot', async function (assert) {
        let response = await context.request2
          .delete('/_bot-registration')
          .send({
            data: {
              type: 'bot-registration',
              id: 'bot-reg-1',
            },
          });
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('can register bot for user', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let response = await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: matrixUserId,
              },
            },
          });

        assert.strictEqual(response.status, 201, 'HTTP 201 status');
        assert.strictEqual(
          response.body.data.attributes.username,
          matrixUserId,
          'response includes username',
        );
        assert.ok(response.body.data.id, 'response includes id');
        assert.ok(
          response.body.data.attributes.username,
          'response includes username',
        );
        assert.ok(
          response.body.data.attributes.createdAt,
          'response includes createdAt',
        );

        let rows = await context.dbAdapter.execute(
          `SELECT id, username, created_at FROM bot_registrations`,
        );
        assert.strictEqual(rows.length, 1, 'one bot registration is persisted');
        assert.ok(rows[0].id, 'id is persisted');
        assert.ok(rows[0].username, 'username is persisted');
        assert.ok(rows[0].created_at, 'created_at is persisted');
      });

      test('can register more than one bot for a single user', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let firstResponse = await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: matrixUserId,
              },
            },
          });

        let secondResponse = await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: matrixUserId,
              },
            },
          });

        assert.strictEqual(firstResponse.status, 201, 'HTTP 201 status');
        assert.strictEqual(secondResponse.status, 201, 'HTTP 201 status');

        let rows = await query(context.dbAdapter, [
          `SELECT id FROM bot_registrations WHERE username = `,
          param(matrixUserId),
        ]);
        assert.strictEqual(rows.length, 2, 'two bot registrations exist');
      });

      test('rejects registration for a different matrix user', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let response = await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: '@other-user:localhost',
              },
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('can unregister bot registration', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let registerResponse = await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: matrixUserId,
              },
            },
          });
        let botRegistrationId = registerResponse.body.data.id;

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
          `SELECT id FROM bot_registrations`,
        );
        assert.strictEqual(rows.length, 0, 'bot registration removed');
      });

      test('unregistering a non-existent bot returns 204', async function (assert) {
        let matrixUserId = '@user:localhost';
        await insertUser(
          context.dbAdapter,
          matrixUserId,
          'cus_123',
          'user@example.com',
        );

        let response = await context.request2
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
              id: uuidv4(),
            },
          });

        assert.strictEqual(response.status, 204, 'HTTP 204 status');
      });

      test('rejects unregistration for a different user', async function (assert) {
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

        let registerResponse = await context.request2
          .post('/_bot-registration')
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
              type: 'bot-registration',
              attributes: {
                username: ownerUserId,
              },
            },
          });
        let botRegistrationId = registerResponse.body.data.id;

        let response = await context.request2
          .delete('/_bot-registration')
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
              type: 'bot-registration',
              id: botRegistrationId,
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');

        let rows = await context.dbAdapter.execute(
          `SELECT username FROM bot_registrations`,
        );
        assert.strictEqual(rows.length, 1, 'bot registration preserved');
        assert.ok(rows[0].username, 'username is preserved');
      });

      test('lists bot registrations for the authenticated user only', async function (assert) {
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
          `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
          param(uuidv4()),
          `,`,
          param(matrixUserId),
          `,`,
          `CURRENT_TIMESTAMP`,
          `)`,
        ]);
        await query(context.dbAdapter, [
          `INSERT INTO bot_registrations (id, username, created_at) VALUES (`,
          param(uuidv4()),
          `,`,
          param(otherMatrixUserId),
          `,`,
          `CURRENT_TIMESTAMP`,
          `)`,
        ]);

        let response = await context.request2
          .get('/_bot-registrations')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: matrixUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.body.data.length, 1, 'returns one row');
        let usernames = response.body.data.map(
          (entry: any) => entry.attributes.username,
        );
        assert.ok(
          usernames.includes(matrixUserId),
          'includes first username',
        );
        assert.notOk(
          usernames.includes(otherMatrixUserId),
          'does not include other username',
        );
      });

      test('lists bot registrations created via endpoint for the authenticated user', async function (assert) {
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

        await context.request2
          .post('/_bot-registration')
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
              attributes: {
                username: matrixUserId,
              },
            },
          });

        await context.request2
          .post('/_bot-registration')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: otherMatrixUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send({
            data: {
              type: 'bot-registration',
              attributes: {
                username: otherMatrixUserId,
              },
            },
          });

        let response = await context.request2
          .get('/_bot-registrations')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: matrixUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.body.data.length, 1, 'returns one row');
      });
    },
  );
});
