import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRoutesTests from '@cardstack/runtime-common/tests/host-routes-test';

module(basename(import.meta.filename), function () {
  test('projectHostRoutes: hrefs in either syntax give each card a path', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: an alias answers for its card at the card path', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: where keeps cards a filter cannot exclude off the site', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: a contested path goes to the earlier page type, and the loser is reported', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: the older claim keeps a path, whatever the page type order', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: a page that is no longer served is gone, until it is claimed again', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: an href outside the route profile is refused', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('projectHostRoutes: an href that gives no usable path is reported', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });
});
