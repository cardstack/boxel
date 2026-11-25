import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRouteLinkTests from '@cardstack/runtime-common/tests/host-route-link-test';

module(basename(import.meta.filename), function () {
  test('hostRouteLink: a card id gets the routed path on the realm URL', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });

  test('hostRouteLink: a card id no route fits keeps the card URL', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });

  test('hostRouteLink: a link into another realm keeps the card URL', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });

  test('hostRouteLink: a realm with no routes, or routes that are not known, keeps card URLs', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });

  test('hostRouteLink: a route name', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });

  test('hostRouteLink: a lookup that throws gives the fallback', async function (assert) {
    await runSharedTest(hostRouteLinkTests, assert, {});
  });
});
