import QUnit from 'qunit';
import { basename } from 'path';
const { module, test } = QUnit;
import {
  ensureFullMatrixUserId,
  userIdFromUsername,
} from '@cardstack/runtime-common/matrix-client';

module(basename(import.meta.filename), function () {
  test('server identity is independent of its loopback connection URL', function (assert) {
    // A native runtime reaches its homeserver on a loopback URL; the user id
    // comes from the configured server name, never from that URL.
    assert.strictEqual(
      userIdFromUsername('realm_server', 'default.boxel.localhost'),
      '@realm_server:default.boxel.localhost',
    );
    assert.strictEqual(
      ensureFullMatrixUserId(
        '@alice:default.boxel.localhost',
        'default.boxel.localhost',
      ),
      '@alice:default.boxel.localhost',
    );
  });
});
