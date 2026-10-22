import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import realmServerAuthorizationMiddlewareTests from '@cardstack/runtime-common/tests/realm-server-authorization-middleware-test';

module(basename(import.meta.filename), function () {
  module('realmServerAuthorizationMiddleware', function () {
    test('attaches the session token for the request realms', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('sends no authorization when the source has no usable token', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('reauthenticates a 401 and replays the request once', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('surfaces a 401 the fresh session is also refused', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('surfaces a 401 when no session can be minted', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('leaves a 403 alone', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('leaves a caller-supplied authorization header alone', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('hands the refused token to the reauthentication', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('replays with a session another caller already minted, without minting again', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });

    test('the replayed request still carries its body', async function (assert) {
      await runSharedTest(realmServerAuthorizationMiddlewareTests, assert, {});
    });
  });
});
