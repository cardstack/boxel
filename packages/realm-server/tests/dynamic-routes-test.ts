import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import dynamicRoutesTests from '@cardstack/runtime-common/tests/dynamic-routes-test';

module(basename(import.meta.filename), function () {
  test('readDynamicRoutes: reads :name rules in order and leaves exact rules alone', async function (assert) {
    await runSharedTest(dynamicRoutesTests, assert, {});
  });

  test('readDynamicRoutes: refuses a bad pattern, a missing query, a card target and an unsafe query', async function (assert) {
    await runSharedTest(dynamicRoutesTests, assert, {});
  });

  test('matchDynamicRoute: one whole, non-empty segment per name, percent-decoded', async function (assert) {
    await runSharedTest(dynamicRoutesTests, assert, {});
  });

  test('dynamicRouteQuery: the spec example makes a query for one card, in no realm the author chose', async function (assert) {
    await runSharedTest(dynamicRoutesTests, assert, {});
  });

  test('dynamicRouteQuery: output that is not a query is no match', async function (assert) {
    await runSharedTest(dynamicRoutesTests, assert, {});
  });
});
