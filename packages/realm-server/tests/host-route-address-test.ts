import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRouteAddressTests from '@cardstack/runtime-common/tests/host-route-address-test';

module(basename(import.meta.filename), function () {
  test('hostRouteAddress: a card id fills its card id template', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: a card id in prefix form', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: an undecided route ends the search', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: a fixed route gives its card its path', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: the canonical route is the first declared', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: one card or one per level fills a nested route', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: a route name and values', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: the reasons a route name gives no address', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: the reasons cards give no address', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });

  test('hostRouteAddress: addresses round-trip through the parser', async function (assert) {
    await runSharedTest(hostRouteAddressTests, assert, {});
  });
});
