import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { SERVER_MATRIX_DEVICE_ID } from '@cardstack/runtime-common/matrix-client';
import {
  getMatrixAdminToken,
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
} from '../synapse.ts';
import { matrixURL } from './helpers/index.ts';

const admin = { matrixURL, adminUsername: 'admin', adminPassword: 'password' };
const userId = '@test_realm:localhost';

async function whoamiResponse(accessToken: string) {
  let response = await fetch(
    `${matrixURL.href}_matrix/client/v3/account/whoami`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.ok
    ? ((await response.json()) as { user_id: string; device_id?: string })
    : undefined;
}

async function whoami(accessToken: string) {
  return (await whoamiResponse(accessToken))?.user_id;
}

async function adminDeviceIds(accessToken: string) {
  let response = await fetch(`${matrixURL.href}_matrix/client/v3/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let { devices } = (await response.json()) as {
    devices: { device_id: string }[];
  };
  return devices.map((d) => d.device_id).sort();
}

module(basename(import.meta.filename), function () {
  module('matrix admin impersonation', function () {
    test('impersonations share one admin token and add no admin devices', async function (assert) {
      let firstUserToken = await impersonateAsMatrixAdmin({
        ...admin,
        userId,
      });
      let adminToken = await getMatrixAdminToken(admin);
      let devicesBefore = await adminDeviceIds(adminToken);

      let secondUserToken = await impersonateAsMatrixAdmin({
        ...admin,
        userId,
      });

      assert.strictEqual(
        await getMatrixAdminToken(admin),
        adminToken,
        'the admin token is reused',
      );
      assert.strictEqual(
        (await whoamiResponse(adminToken))?.device_id,
        SERVER_MATRIX_DEVICE_ID,
        'the admin token is on the server device',
      );
      assert.deepEqual(
        await adminDeviceIds(adminToken),
        devicesBefore,
        'a later impersonation adds no admin device',
      );
      assert.strictEqual(
        await whoami(firstUserToken),
        userId,
        'the first impersonation acts as the user',
      );
      assert.strictEqual(
        await whoami(secondUserToken),
        userId,
        'the second impersonation acts as the user',
      );

      await logoutMatrixAccessToken({ matrixURL, accessToken: firstUserToken });
      assert.strictEqual(
        await whoami(firstUserToken),
        undefined,
        'logging out an impersonation revokes it',
      );
      assert.strictEqual(
        await whoami(adminToken),
        '@admin:localhost',
        'logging out an impersonation leaves the admin token valid',
      );
      assert.strictEqual(
        await whoami(secondUserToken),
        userId,
        'logging out an impersonation leaves other impersonations valid',
      );
    });

    test('impersonation logs the admin in again once its token is revoked', async function (assert) {
      let revokedToken = await getMatrixAdminToken(admin);
      await logoutMatrixAccessToken({ matrixURL, accessToken: revokedToken });

      let userToken = await impersonateAsMatrixAdmin({ ...admin, userId });

      assert.strictEqual(
        await whoami(userToken),
        userId,
        'the impersonation succeeds',
      );
      assert.notStrictEqual(
        await getMatrixAdminToken(admin),
        revokedToken,
        'the shared admin token was replaced',
      );
    });
  });
});
