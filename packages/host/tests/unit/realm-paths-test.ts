import { module, test } from 'qunit';

import { RealmPaths } from '@cardstack/runtime-common';

module('Unit | RealmPaths', function (hooks) {
  let realmPaths: RealmPaths;
  module('RealmPaths from a URL', function (hooks) {
    hooks.beforeEach(function () {
      realmPaths = new RealmPaths(new URL('https://cardstack.com/hümans'));
    });

    test('#local', function (assert) {
      assert.strictEqual(
        realmPaths.local(new URL('https://cardstack.com/hümans/example')),
        'example',
      );
      assert.strictEqual(
        realmPaths.local(new URL('https://cardstack.com/hümans/éxample')),
        'éxample',
      );
      assert.strictEqual(
        realmPaths.local(
          new URL('https://cardstack.com/hümans/éxample?stripped=true'),
        ),
        'éxample',
      );
      assert.strictEqual(
        realmPaths.local(
          new URL('https://cardstack.com/hümans/éxample?stripped=ü'),
          {
            preserveQuerystring: true,
          },
        ),
        'éxample?stripped=ü',
      );
    });

    test('#fileURL', function (assert) {
      assert.strictEqual(
        realmPaths.fileURL('example').href,
        'https://cardstack.com/h%C3%BCmans/example',
      );
      assert.strictEqual(
        realmPaths.fileURL('éxample').href,
        'https://cardstack.com/h%C3%BCmans/%C3%A9xample',
      );
    });

    test('#directoryURL', function (assert) {
      assert.strictEqual(
        realmPaths.directoryURL('').href,
        'https://cardstack.com/h%C3%BCmans/',
      );
      assert.strictEqual(
        realmPaths.directoryURL('example').href,
        'https://cardstack.com/h%C3%BCmans/example/',
      );
      assert.strictEqual(
        realmPaths.directoryURL('éxample').href,
        'https://cardstack.com/h%C3%BCmans/%C3%A9xample/',
      );
    });

    test('#inRealm', function (assert) {
      assert.true(
        realmPaths.inRealm(new URL('https://cardstack.com/hümans/example')),
      );
      assert.true(
        realmPaths.inRealm(new URL('https://cardstack.com/hümans/éxample')),
      );
      assert.false(
        realmPaths.inRealm(new URL('https://cardstack.com/humans/éxample')),
      );
    });
  });
});
