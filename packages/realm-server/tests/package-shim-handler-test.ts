import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import packageShimHandlerTests from '@cardstack/runtime-common/tests/package-shim-handler-test';

module(basename(__filename), function () {
  module('Strict named-export check (CS-10860 follow-up)', function () {
    test('wrapWithStrictNamespace returns existing exports unchanged', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace throws ReferenceError on missing string-key access', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace allows `in` checks without throwing', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace allows Object.keys to enumerate present exports', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace passes Symbol gets through without throwing', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace honors the ALLOW_MISSING_NAMED_EXPORTS escape hatch', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace returns null/undefined namespaces unchanged', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('PackageShimHandler#handle wraps the served module with the strict Proxy', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('PackageShimHandler error message names the full requested URL — useful for cards that import from a typo URL', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
  });
});
