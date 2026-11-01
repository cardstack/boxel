import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import prefixRealmNetworkTests from '@cardstack/runtime-common/tests/prefix-realm-network-test';

module(basename(import.meta.filename), function () {
  module('PrefixRealmNetwork', function () {
    test('resolves a prefix-form identifier through its registered mapping', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('passes a URL-form identifier through and refuses an unregistered prefix', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('normalizes trailing slashes on registration', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('places a reference in its realm by prefix or by served URL, longest match first', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('reads the path below the namespace from the spelling alone', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('folds a served URL back onto its prefix', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('the served document round-trips through the client parser', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('rejects a document that is not a prefix realm map', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('fetches the map from the endpoint below the server URL', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('builds one network per server, and asks again after a failed read', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('gives up on a server that never answers, and asks again next time', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });

    test('names the server, and the cause, when the request fails', async function (assert) {
      await runSharedTest(prefixRealmNetworkTests, assert, {});
    });
  });
});
