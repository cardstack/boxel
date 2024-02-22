import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { module, test } from 'qunit';

module('realm-user-permissions', function (_hooks) {
  module('world-readable realm', function () {
    let permissionsChecker = new RealmPermissionChecker({
      '*': ['read'],
    });

    test('anyone can read but not write', function (assert) {
      assert.ok(permissionsChecker.can('anyone', 'read'));
      assert.notOk(permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(permissionsChecker.for('anyone'), ['read']);
    });
  });

  module('world-writable realm', function () {
    let permissionsChecker = new RealmPermissionChecker({
      '*': ['read', 'write'],
    });

    test('anyone can read and write', function (assert) {
      assert.ok(permissionsChecker.can('anyone', 'read'));
      assert.ok(permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(permissionsChecker.for('anyone'), ['read', 'write']);
    });
  });

  module('users-readable realm', function () {
    let permissionsChecker = new RealmPermissionChecker({
      users: ['read'],
      '@matic:boxel-ai': ['read', 'write'],
    });

    test('user with permission can read but not write', function (assert) {
      assert.ok(permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(permissionsChecker.can('@matic:boxel-ai', 'write'));

      assert.deepEqual(permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      assert.ok(permissionsChecker.can('anyone', 'read'));
      assert.notOk(permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(permissionsChecker.for('anyone'), ['read']);
    });
  });

  module('user permissioned realm', function () {
    let permissionsChecker = new RealmPermissionChecker({
      '*': ['read'],
      '@matic:boxel-ai': ['read', 'write'],
    });

    test('user with permission can do permitted actions', function (assert) {
      assert.ok(permissionsChecker.can('@matic:boxel-ai', 'read'));
      assert.ok(permissionsChecker.can('anyone', 'read'));

      assert.ok(permissionsChecker.can('@matic:boxel-ai', 'write'));
      assert.notOk(permissionsChecker.can('anyone', 'write'));

      assert.deepEqual(permissionsChecker.for('@matic:boxel-ai'), [
        'read',
        'write',
      ]);

      assert.deepEqual(permissionsChecker.for('anyone'), ['read']);
    });
  });
});
