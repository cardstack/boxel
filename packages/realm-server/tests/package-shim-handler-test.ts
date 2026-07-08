import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import packageShimHandlerTests from '@cardstack/runtime-common/tests/package-shim-handler-test';

module(basename(import.meta.filename), function () {
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
    test('wrapWithStrictNamespace allows runtime-probe `then` (await thenable detection)', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('wrapWithStrictNamespace allows runtime-probe `__esModule`, `toJSON`, and Object.prototype methods', async function (assert) {
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
    test('PackageShimHandler error message names the correct subpath when the symbol is exported from another shim', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('PackageShimHandler error message lists every shim that owns the symbol when more than one matches', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('PackageShimHandler error message falls back to the verbatim message for a typo no shim owns', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('PackageShimHandler suggests an async-shimmed module once it has been served', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
  });

  module('shimAsyncModule retry (CS-10860 follow-up)', function () {
    test('returns the resolved module on first attempt when there is no failure', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('retries a transient ChunkLoadError up to the configured budget', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('fails fast on a non-retryable error without burning the retry budget', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('after exhausting all retries, throws the last error from the resolver', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches webpack ChunkLoadError', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches generic chunk-load message', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches native dynamic-import network failure', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches Chrome ERR_CONNECTION_RESET', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches Node ECONNRESET via err.code', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError matches HTTP 502/503/504 — aligned with loader.ts policy', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError does NOT match SyntaxError', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError does NOT match TypeError from module evaluation', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('isRetryableShimResolveError handles non-error inputs without throwing', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('shimAsyncModule retries on transient resolver failure and ultimately serves the module', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('shimAsyncModule returns null from handle() when the resolver throws permanently', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('describeShimError surfaces the transient signature from an Error message', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('describeShimError appends a Node socket error code when present', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
    test('describeShimError handles non-Error values without throwing', async function (assert) {
      await runSharedTest(packageShimHandlerTests, assert, {});
    });
  });
});
