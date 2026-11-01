import { module, test } from 'qunit';

import { effectiveRealmPermissions } from '@cardstack/runtime-common/realm-permission-checker';

const PAIRED = 'example.test';

module('Unit | effective realm permissions', function () {
  test('the users row grants to a registered user of the paired homeserver', async function (assert) {
    let asked = 0;
    assert.deepEqual(
      await effectiveRealmPermissions(
        { users: ['read'], '*': [] },
        '@someone:example.test',
        PAIRED,
        async () => {
          asked++;
          return true;
        },
      ),
      ['read'],
    );
    assert.strictEqual(asked, 1, 'the homeserver was asked about the account');
  });

  test('the users row is refused to a user of another homeserver, without asking the homeserver', async function (assert) {
    let asked = 0;
    assert.deepEqual(
      await effectiveRealmPermissions(
        { users: ['read', 'write'] },
        '@someone:other.example',
        PAIRED,
        async () => {
          asked++;
          return true;
        },
      ),
      [],
    );
    assert.strictEqual(
      asked,
      0,
      'the paired homeserver is never asked about another server’s user',
    );
  });

  test('a user of another homeserver still gets the * row and their own row', async function (assert) {
    assert.deepEqual(
      await effectiveRealmPermissions(
        {
          users: ['write'],
          '*': ['read'],
          '@someone:other.example': ['realm-owner'],
        },
        '@someone:other.example',
        PAIRED,
        async () => true,
      ),
      ['read', 'realm-owner'],
    );
  });

  test('the users row is refused to a paired-homeserver user with no account', async function (assert) {
    assert.deepEqual(
      await effectiveRealmPermissions(
        { users: ['read'] },
        '@nobody:example.test',
        PAIRED,
        async () => false,
      ),
      [],
    );
  });

  test('a caller that is not a Matrix user id gets no users row', async function (assert) {
    let asked = 0;
    assert.deepEqual(
      await effectiveRealmPermissions(
        { users: ['read'], '*': ['read'] },
        'anyone',
        PAIRED,
        async () => {
          asked++;
          return true;
        },
      ),
      ['read'],
    );
    assert.strictEqual(asked, 0);
  });

  test('a realm without a users row never asks the homeserver', async function (assert) {
    let asked = 0;
    assert.deepEqual(
      await effectiveRealmPermissions(
        { '@someone:example.test': ['read', 'write'] },
        '@someone:example.test',
        PAIRED,
        async () => {
          asked++;
          return true;
        },
      ),
      ['read', 'write'],
    );
    assert.strictEqual(asked, 0);
  });
});
