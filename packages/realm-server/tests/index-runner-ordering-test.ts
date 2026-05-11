import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import orderingTests from '@cardstack/runtime-common/tests/index-runner-ordering-test';

module(basename(__filename), function () {
  module('index-runner dependency ordering', function () {
    test('orderInvalidationsByDependencies: empty input', async function (assert) {
      await runSharedTest(orderingTests, assert, {});
    });

    test('orderInvalidationsByDependencies: single URL', async function (assert) {
      await runSharedTest(orderingTests, assert, {});
    });

    test('orderInvalidationsByDependencies: flat fan-out reports correct layer width', async function (assert) {
      await runSharedTest(orderingTests, assert, {});
    });

    test('orderInvalidationsByDependencies: linear chain reports width 1 and full depth', async function (assert) {
      await runSharedTest(orderingTests, assert, {});
    });

    test('orderInvalidationsByDependencies: diamond reports widest layer', async function (assert) {
      await runSharedTest(orderingTests, assert, {});
    });
  });
});
