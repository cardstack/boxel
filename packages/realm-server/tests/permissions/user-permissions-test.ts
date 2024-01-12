import RealmPermissions from '../../lib/realm-permissions';
import { module, test } from 'qunit';

module('user-permissions', function (_hooks) {
  test('can read user permissions for specified realm', function (assert) {
    let permissionsConfig = {
      'public-realm': {
        users: {
          '*': ['read', 'write'],
        },
      },
      'hassans-realm': {
        users: {
          '@hassan:boxel.ai': ['read', 'write'],
        },
      },
    };

    process.env.REALM_USER_PERMISSIONS = JSON.stringify(permissionsConfig);

    let permissions = new RealmPermissions();

    assert.throws(() => {
      permissions.can('user_x', 'read', 'nonexistent realm');
    }, /Realm nonexistent realm does not exist in the permissions config/);

    assert.ok(permissions.can('any_user', 'read', 'public-realm'));
    assert.ok(permissions.can('any_user', 'write', 'public-realm'));
    assert.ok(permissions.can('@fadhlan:boxel.ai', 'read', 'public-realm'));
    assert.ok(permissions.can('@fadhlan:boxel.ai', 'write', 'public-realm'));

    assert.notOk(permissions.can('any_user', 'read', 'hassans-realm'));
    assert.notOk(permissions.can('any_user', 'write', 'hassans-realm'));
    assert.notOk(permissions.can('@fadhlan:boxel.ai', 'read', 'hassans-realm'));
    assert.notOk(
      permissions.can('@fadhlan:boxel.ai', 'write', 'hassans-realm'),
    );
    assert.ok(permissions.can('@hassan:boxel.ai', 'write', 'hassans-realm'));
    assert.ok(permissions.can('@hassan:boxel.ai', 'write', 'hassans-realm'));
  });
});
