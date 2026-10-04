import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  MatrixClient,
  SERVER_MATRIX_DEVICE_ID,
} from '@cardstack/runtime-common/matrix-client';
import { matrixURL, realmSecretSeed } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('MatrixClient login', function () {
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
  });
});
