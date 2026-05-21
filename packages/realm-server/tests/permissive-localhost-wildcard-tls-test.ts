import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import permissiveLocalhostWildcardTlsTests from '@cardstack/runtime-common/tests/permissive-localhost-wildcard-tls-test';

module(basename(__filename), function () {
  module('permissiveLocalhostWildcardCheckServerIdentity', function () {
    test('accepts user.localhost when cert has DNS:*.localhost SAN', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });

    test('accepts user.localhost. (FQDN trailing-dot form) when cert has DNS:*.localhost SAN', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });

    test('rejects user.localhost when cert lacks DNS:*.localhost SAN', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });

    test('rejects multi-label foo.bar.localhost even when cert has DNS:*.localhost SAN', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });

    test('leaves the exact-match localhost case alone (defers to default check)', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });

    test('does not relax checks for non-localhost hosts even when SAN is permissive', async function (assert) {
      await runSharedTest(permissiveLocalhostWildcardTlsTests, assert, {});
    });
  });
});
