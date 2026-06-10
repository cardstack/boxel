import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import resolvePublishedRealmUrlTests from '@cardstack/runtime-common/tests/resolve-published-realm-url-test';

module(basename(__filename), function () {
  module('resolve-published-realm-url', function () {
    test('deriveRealmName returns the last path segment, lowercased', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('deriveRealmName ignores a missing trailing slash', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('deriveRealmName throws when there is no path segment', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('deriveRealmName throws on an unparseable URL', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory builds a Boxel Space URL from username, domain, and name', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory lowercases the provided name', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory derives the name from sourceRealmURL when blank', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory honors a custom protocol', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory throws when name is blank and no sourceRealmURL is given', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory throws when matrixUsername is missing', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('subdirectory throws when spaceDomain is missing', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom builds a URL from a bare hostname', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom preserves a port in the hostname', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom strips a leading protocol and trailing slash', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom throws when the hostname is blank', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom rejects a hostname that includes a path', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom rejects a hostname that includes credentials', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom rejects a hostname that includes a query or fragment', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('custom normalizes an accidental protocol passed in ctx', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });

    test('throws on an unknown target type', async function (assert) {
      await runSharedTest(resolvePublishedRealmUrlTests, assert, {});
    });
  });
});
