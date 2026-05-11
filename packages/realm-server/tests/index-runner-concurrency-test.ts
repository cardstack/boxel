import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import concurrencyTests from '@cardstack/runtime-common/tests/index-runner-concurrency-test';

module(basename(__filename), function () {
  module('index-runner concurrency helpers', function () {
    test('computeIndexVisitConcurrency: tiny batches stay serial', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('computeIndexVisitConcurrency: linear chains stay serial', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('computeIndexVisitConcurrency: wide batches respect the layer width', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('computeIndexVisitConcurrency: hard cap wins over generous envelopes', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('computeIndexVisitConcurrency: envelope wins when it is the tightest cap', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('computeIndexVisitConcurrency: malformed env vars fall back to defaults', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('runWithBoundedConcurrency: empty input', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('runWithBoundedConcurrency: collects fulfilled and rejected results in order', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('runWithBoundedConcurrency: never exceeds the concurrency cap', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('runWithBoundedConcurrency: concurrency=1 is sequential', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });

    test('runWithBoundedConcurrency: continues past rejections, finishes every item', async function (assert) {
      await runSharedTest(concurrencyTests, assert, {});
    });
  });
});
