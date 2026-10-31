import type { DBAdapter } from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { basename } from 'path';
import QUnit from 'qunit';
const { module, test } = QUnit;

// Whether the `users` table holds a row for whoever the checker asks about:
// the one question the checker puts to the database.
let hasAccount = false;
let mockDBAdapter = {
  async execute(sql: string) {
    if (!/FROM users/i.test(sql)) {
      throw new Error(`unexpected query: ${sql}`);
    }
    return [{ user_exists: hasAccount }];
  },
} as unknown as DBAdapter;
// The paired homeserver is named `boxel-ai`.
const SERVER_NAME = 'boxel-ai';

module(`permissions/${basename(import.meta.filename)}`, function () {
  module('world-readable realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        '*': ['read'],
      },
      mockDBAdapter,
      SERVER_NAME,
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
      mockDBAdapter,
      SERVER_NAME,
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
      mockDBAdapter,
      SERVER_NAME,
    );

    test('a user with an account can read but not write', async function (assert) {
      hasAccount = true;
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      assert.ok(await permissionsChecker.can('@not-matic:boxel-ai', 'read'));
      assert.notOk(
        await permissionsChecker.can('@not-matic:boxel-ai', 'write'),
      );

      assert.deepEqual(await permissionsChecker.for('@not-matic:boxel-ai'), [
        'read',
      ]);
    });

    test('a user without an account can neither read nor write', async function (assert) {
      hasAccount = false;
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      assert.notOk(await permissionsChecker.can('anyone', 'read'));
      assert.notOk(await permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(await permissionsChecker.for('anyone'), []);
    });

    test('a user of another homeserver is not granted the users row', async function (assert) {
      hasAccount = true;
      assert.notOk(
        await permissionsChecker.can('@someone:other.example', 'read'),
      );
      assert.deepEqual(
        await permissionsChecker.for('@someone:other.example'),
        [],
      );
    });
  });

  module('user permissioned realm', function () {
    let permissionsChecker = new RealmPermissionChecker(
      {
        '*': ['read'],
        '@matic:boxel-ai': ['read', 'write', 'realm-owner'],
      },
      mockDBAdapter,
      SERVER_NAME,
    );

    test('user with permission can do permitted actions', async function (assert) {
      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(await permissionsChecker.can('anyone', 'read'));

      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'write'));
      assert.notOk(await permissionsChecker.can('anyone', 'write'));

      assert.ok(await permissionsChecker.can('@matic:boxel-ai', 'realm-owner'));
      assert.notOk(await permissionsChecker.can('anyone', 'realm-owner'));

      assert.deepEqual(await permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
        'realm-owner',
      ]);

      assert.deepEqual(await permissionsChecker.for('anyone'), ['read']);
    });
  });
});
