import RealmPermissions from '../../lib/realm-permissions';
import { module, test } from 'qunit';

module('user-permissions', function (_hooks) {
  test('can read user permissions for specified realm', function (assert) {
    let permissionsConfig = {
      'https://cardstack.com/base/': {
        users: {
          '*': ['read', 'write'],
        },
      },
      'https://realms.boxel.ai/drafts/': {
        users: {
          '@hassan:boxel.ai': ['read', 'write'],
        },
      },
    };

    process.env.REALM_USER_PERMISSIONS = JSON.stringify(permissionsConfig);

    let permissions = new RealmPermissions();

    // TODO For the time being realms without configs default to being wide open. we need to change
    // this once we get our infra established for this
    assert.ok(permissions.can('user_x', 'read', 'nonexistent realm'));
    assert.ok(permissions.can('user_x', 'write', 'nonexistent realm'));

    assert.ok(
      permissions.can('any_user', 'read', 'https://cardstack.com/base/'),
    );
    assert.ok(
      permissions.can('any_user', 'write', 'https://cardstack.com/base/'),
    );
    assert.ok(
      permissions.can(
        '@fadhlan:boxel.ai',
        'read',
        'https://cardstack.com/base/',
      ),
    );
    assert.ok(
      permissions.can(
        '@fadhlan:boxel.ai',
        'write',
        'https://cardstack.com/base/',
      ),
    );

    assert.notOk(
      permissions.can('any_user', 'read', 'https://realms.boxel.ai/drafts/'),
    );
    assert.notOk(
      permissions.can('any_user', 'write', 'https://realms.boxel.ai/drafts/'),
    );
    assert.notOk(
      permissions.can(
        '@fadhlan:boxel.ai',
        'read',
        'https://realms.boxel.ai/drafts/',
      ),
    );
    assert.notOk(
      permissions.can(
        '@fadhlan:boxel.ai',
        'write',
        'https://realms.boxel.ai/drafts/',
      ),
    );
    assert.ok(
      permissions.can(
        '@hassan:boxel.ai',
        'write',
        'https://realms.boxel.ai/drafts/',
      ),
    );
    assert.ok(
      permissions.can(
        '@hassan:boxel.ai',
        'write',
        'https://realms.boxel.ai/drafts/',
      ),
    );
  });
});
