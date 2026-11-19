import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRouteCanonicalAddressTests from '@cardstack/runtime-common/tests/host-route-canonical-address-test';

module(basename(import.meta.filename), function () {
  test('hostRouteCanonicalAddress: id routes agree with the reverse lookup', async function (assert) {
    await runSharedTest(hostRouteCanonicalAddressTests, assert, {});
  });

  test('hostRouteCanonicalAddress: a field match reads its values from the index', async function (assert) {
    await runSharedTest(hostRouteCanonicalAddressTests, assert, {});
  });

  test('hostRouteCanonicalAddress: a nested route fills its parent from the link', async function (assert) {
    await runSharedTest(hostRouteCanonicalAddressTests, assert, {});
  });

  test('hostRouteCanonicalAddress: an alias is never canonical', async function (assert) {
    await runSharedTest(hostRouteCanonicalAddressTests, assert, {});
  });

  test('hostRouteCanonicalAddress: a failed lookup rejects', async function (assert) {
    await runSharedTest(hostRouteCanonicalAddressTests, assert, {});
  });
});
