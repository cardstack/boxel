import { module, test } from 'qunit';
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { realmSecretSeed, insertUser } from '../helpers';
import { setupServerEndpointsTest, testRealmURL } from './helpers';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('/_run-command endpoint', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('requires auth', async function (assert) {
      let response = await context.request
        .post('/_run-command')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command: '@cardstack/boxel-host/commands/serialize-card/default',
            },
          },
        });
      assert.strictEqual(response.status, 401, 'HTTP 401 without auth');
    });

    test('rejects missing realmURL', async function (assert) {
      let matrixUserId = '@run-cmd-test:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd1',
        'runcmd@example.com',
      );

      let response = await context.request
        .post('/_run-command')
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
            type: 'run-command',
            attributes: {
              command: '@cardstack/boxel-host/commands/serialize-card/default',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing realmURL');
    });

    test('rejects missing command', async function (assert) {
      let matrixUserId = '@run-cmd-test2:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd2',
        'runcmd2@example.com',
      );

      let response = await context.request
        .post('/_run-command')
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
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing command');
    });

    // Uses GetCardTypeSchemaCommand to verify end-to-end command execution
    test('can successfully run a command', async function (assert) {
      let matrixUserId = '@node-test_realm:localhost';

      let response = await context.request
        .post('/_run-command')
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
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command:
                '@cardstack/boxel-host/commands/get-card-type-schema/default',
              commandInput: {
                codeRef: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(attrs?.status, 'ready', 'command completed');
      assert.ok(attrs?.cardResultString, 'has result');

      let result = JSON.parse(attrs.cardResultString);
      let schema = result?.data?.attributes?.json ?? result;
      assert.ok(schema?.attributes, 'schema has attributes');
    });

    test('rejects invalid JSON body', async function (assert) {
      let matrixUserId = '@run-cmd-test3:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd3',
        'runcmd3@example.com',
      );

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send('not json');
      assert.strictEqual(response.status, 400, 'HTTP 400 for invalid body');
    });
  });
});
