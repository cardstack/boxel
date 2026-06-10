import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import realmOperationsTests from '@cardstack/runtime-common/tests/realm-operations-test';

module(basename(__filename), function () {
  module('realm-operations', function () {
    test('publishRealm POSTs normalized URLs and maps the 202 response', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('publishRealm throws a RealmOperationError carrying the conflict status', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('unpublishRealm POSTs and maps the response', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('unpublishRealm throws a RealmOperationError with status on failure', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('checkDomainAvailability builds the query and returns the result', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('fetchPublishabilityReport maps the report', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('fetchPublishabilityReport defaults violations to an empty array', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('waitForReady resolves once readiness returns ok', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });

    test('waitForReady throws after the timeout elapses', async function (assert) {
      await runSharedTest(realmOperationsTests, assert, {});
    });
  });
});
