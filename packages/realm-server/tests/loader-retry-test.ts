import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import loaderRetryTests from '@cardstack/runtime-common/tests/loader-retry-test';

module(basename(__filename), function () {
  module('Loader transient 5xx retry (CS-10820)', function () {
    test('returns the first response when status is 2xx', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('retries once after a 502 then succeeds on 200', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('retries on 503 and 504 (both transient)', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('surfaces last 5xx response after exhausting retry attempts', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('does not retry on 500 (not transient)', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('does not retry on 4xx (404, 401, 403)', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('does not retry when the fetch call throws', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });

    test('honors custom backoff delays and passes them to onRetry', async function (assert) {
      await runSharedTest(loaderRetryTests, assert, {});
    });
  });
});
