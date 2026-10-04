import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  MatrixClient,
  SERVER_MATRIX_DEVICE_ID,
} from '@cardstack/runtime-common/matrix-client';
import { v4 as uuidv4 } from 'uuid';
import { getMatrixAdminToken, registerUser } from '../synapse.ts';
import {
  ensureMatrixAdminUser,
  matrixRegistrationSecret,
  matrixURL,
  realmSecretSeed,
} from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('MatrixClient login', function (hooks) {
    hooks.before(ensureMatrixAdminUser);

    function makeClient() {
      return new MatrixClient({
        matrixURL,
        username: 'test_realm',
        seed: realmSecretSeed,
      });
    }

    test('repeated logins share one device and keep earlier sessions valid', async function (assert) {
      let first = makeClient();
      await first.login();
      let second = makeClient();
      await second.login();

      assert.strictEqual(
        first.getDeviceId(),
        SERVER_MATRIX_DEVICE_ID,
        'the first login uses the server device',
      );
      assert.strictEqual(
        second.getDeviceId(),
        SERVER_MATRIX_DEVICE_ID,
        'a later login reuses the same device',
      );
      assert.strictEqual(
        await first.whoami(),
        first.getUserId(),
        "the first login's access token still works after the second login",
      );
      assert.strictEqual(
        await second.whoami(),
        second.getUserId(),
        "the second login's access token works",
      );
    });

    test('a client logs in again after its device is deleted', async function (assert) {
      // A user of its own, so deleting its device revokes no other session.
      let username = `device-relogin-${uuidv4().slice(0, 8)}`;
      await registerUser({
        matrixURL,
        displayname: username,
        username,
        password: 'password',
        registrationSecret: matrixRegistrationSecret,
      });
      let client = new MatrixClient({
        matrixURL,
        username,
        password: 'password',
      });
      await client.login();
      let userId = client.getUserId()!;

      let adminToken = await getMatrixAdminToken({
        matrixURL,
        adminUsername: 'admin',
        adminPassword: 'password',
      });
      let deleted = await fetch(
        `${matrixURL.href}_synapse/admin/v2/users/${encodeURIComponent(
          userId,
        )}/devices/${SERVER_MATRIX_DEVICE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      );
      assert.strictEqual(deleted.status, 200, 'the device was deleted');

      assert.strictEqual(
        await client.whoami(),
        userId,
        'a request after the deletion succeeds',
      );
      assert.strictEqual(
        client.getDeviceId(),
        SERVER_MATRIX_DEVICE_ID,
        'the client is back on the server device',
      );
    });
  });
});
