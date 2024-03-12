import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { module, test } from 'qunit';

let matrixUserProfile: { displayname: string } | undefined = undefined;
let mockMatrixClient = {
  async getProfile(_userId) {
    return matrixUserProfile;
  },
} as MatrixClient;
module('realm-user-permissions', function (_hooks) {
  module('world-readable realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        '*': ['read'],
      },
      mockMatrixClient,
    );

    test('anyone can read but not write', async function (assert) {
      assert.ok(await permissionsChecker.can('anyone', 'read'));
      assert.notOk(await permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(await permissionsChecker.for('anyone'), ['read']);
    });
  });

  module('world-writable realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        '*': ['read', 'write'],
      },
      mockMatrixClient,
    );

    test('anyone can read and write', async function (assert) {
      assert.ok(await permissionsChecker.can('anyone', 'read'));
      assert.ok(await permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(await permissionsChecker.for('anyone'), [
        'read',
        'write',
      ]);
    });
  });

  module('users-readable realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        users: ['read'],
        '@matic:boxel-ai': ['read', 'write'],
      },
      mockMatrixClient,
    );

    test('matrix user can read but not write', async function (assert) {
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      matrixUserProfile = { displayname: 'Not Matic' };
      assert.ok(await permissionsChecker.can('@not-matic:boxel-ai', 'read'));
      assert.notOk(
        await permissionsChecker.can('@not-matic:boxel-ai', 'write'),
      );

      assert.deepEqual(await permissionsChecker.for('@not-matic:boxel-ai'), [
        'read',
      ]);
    });

    test('non-matrix user can not read and write', async function (assert) {
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      matrixUserProfile = undefined;
      assert.notOk(await permissionsChecker.can('anyone', 'read'));
      assert.notOk(await permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(await permissionsChecker.for('anyone'), []);
    });
  });

  module('user permissioned realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        '*': ['read'],
        '@matic:boxel-ai': ['read', 'write'],
      },
      mockMatrixClient,
    );

    test('user with permission can do permitted actions', async function (assert) {
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('anyone', 'read'));

      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));
      assert.notOk(await permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      assert.deepEqual(await permissionsChecker.for('anyone'), ['read']);
    });
  });
});
